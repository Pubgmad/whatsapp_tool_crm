import { query, transaction } from './db.js';
import { createHubSpotCrmObject, patchHubSpotCrmObject } from './hubspot-contacts.js';

const hubspotProps = {
  company: { name: 'name', domain: 'domain', industry: 'industry' },
  deal: { name: 'dealname', stage: 'dealstage', amount: 'amount', currency: 'deal_currency_code', close_date: 'closedate' }
};

const salesforceFields = {
  company: { name: 'Name', domain: 'Website', industry: 'Industry' },
  deal: { name: 'Name', stage: 'StageName', amount: 'Amount', currency: 'CurrencyIsoCode', close_date: 'CloseDate' }
};

export async function enqueueCrmObjectPush(businessId, contactId, client = null) {
  const run = client?.query ? client.query.bind(client) : query;
  await run(
    `INSERT INTO crm_object_push_queue(business_id,contact_id,run_at,attempts,last_error,updated_at)
     VALUES($1,$2,NOW(),0,'',NOW())
     ON CONFLICT(business_id,contact_id) DO UPDATE SET run_at=NOW(),updated_at=NOW()`,
    [businessId, contactId]
  );
}

function buildHubSpotProperties(kind, attributes, mappings) {
  const properties = {};
  for (const mapping of mappings) {
    if (!mapping.push_enabled || mapping.kind !== kind) continue;
    const value = attributes[mapping.attribute_key];
    if (value === undefined || value === null || String(value).length > 512) continue;
    const key = hubspotProps[kind]?.[mapping.source_field];
    if (key) properties[key] = String(value);
  }
  return properties;
}

function buildSalesforceFields(kind, attributes, mappings) {
  const fields = {};
  for (const mapping of mappings) {
    if (!mapping.push_enabled || mapping.kind !== kind) continue;
    const value = attributes[mapping.attribute_key];
    if (value === undefined || value === null || String(value).length > 512) continue;
    const key = salesforceFields[kind]?.[mapping.source_field];
    if (key) fields[key] = String(value);
  }
  return fields;
}

function hubspotObjectName(kind, properties) {
  return String(kind === 'deal' ? properties.dealname : properties.name || '').trim();
}

async function persistCreatedObject(client, connection, contactId, kind, externalId, displayName, fields) {
  await client.query(
    `INSERT INTO crm_object_records(business_id,connection_id,kind,external_id,display_name,fields,external_updated_at,archived)
     VALUES($1,$2,$3,$4,$5,$6,NOW(),FALSE)
     ON CONFLICT(connection_id,kind,external_id) DO UPDATE SET display_name=EXCLUDED.display_name,fields=EXCLUDED.fields,updated_at=NOW()`,
    [connection.business_id, connection.id, kind, externalId, displayName, JSON.stringify(fields)]
  );
  await client.query(
    `INSERT INTO crm_object_contacts(business_id,connection_id,kind,external_id,contact_id)
     VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [connection.business_id, connection.id, kind, externalId, contactId]
  );
}

export async function pushContactCrmObjects(businessId, contactId) {
  const contact = (await query('SELECT custom_attributes FROM contacts WHERE business_id=$1 AND id=$2', [businessId, contactId])).rows[0];
  if (!contact) return { pushed: 0, created: 0 };
  const attributes = contact.custom_attributes || {};
  const connections = (
    await query(
      "SELECT * FROM crm_connections WHERE business_id=$1 AND enabled AND sync_objects_enabled AND sync_outbound_objects_enabled",
      [businessId]
    )
  ).rows;
  let pushed = 0;
  let created = 0;
  for (const connection of connections) {
    const mappings = (
      await query(
        'SELECT kind,source_field,attribute_key,push_enabled FROM crm_field_mappings WHERE business_id=$1 AND connection_id=$2 AND enabled AND push_enabled',
        [businessId, connection.id]
      )
    ).rows;
    if (!mappings.length) continue;
    const links = (
      await query(
        'SELECT kind,external_id FROM crm_object_contacts WHERE business_id=$1 AND connection_id=$2 AND contact_id=$3',
        [businessId, connection.id, contactId]
      )
    ).rows;
    const crmContact = (
      await query(
        "SELECT external_id FROM crm_contact_links WHERE business_id=$1 AND connection_id=$2 AND contact_id=$3 AND external_object_type='Contact' LIMIT 1",
        [businessId, connection.id, contactId]
      )
    ).rows[0];
    try {
      if (connection.provider === 'hubspot') {
        for (const kind of ['company', 'deal']) {
          let link = links.find((row) => row.kind === kind);
          const properties = buildHubSpotProperties(kind, attributes, mappings);
          if (!link && connection.sync_outbound_create_objects_enabled && hubspotObjectName(kind, properties)) {
            const externalId = await createHubSpotCrmObject(connection, kind, properties, crmContact?.external_id);
            if (externalId) {
              await transaction(async (client) => {
                await persistCreatedObject(client, connection, contactId, kind, externalId, hubspotObjectName(kind, properties), properties);
              });
              link = { kind, external_id: externalId };
              created += 1;
            }
          }
          if (link) {
            const patchProps = buildHubSpotProperties(link.kind, attributes, mappings);
            if (await patchHubSpotCrmObject(connection, link.kind, link.external_id, patchProps)) pushed += 1;
          }
        }
      } else if (connection.provider === 'salesforce') {
        const { patchSalesforceCrmObject, createSalesforceCrmObject } = await import('./salesforce-contacts.js');
        for (const kind of ['company', 'deal']) {
          let link = links.find((row) => row.kind === kind);
          const fields = buildSalesforceFields(kind, attributes, mappings);
          if (!link && connection.sync_outbound_create_objects_enabled && fields.Name) {
            const externalId = await createSalesforceCrmObject(connection, kind, fields, crmContact?.external_id);
            if (externalId) {
              await transaction(async (client) => {
                await persistCreatedObject(client, connection, contactId, kind, externalId, fields.Name, fields);
              });
              link = { kind, external_id: externalId };
              created += 1;
            }
          }
          if (link) {
            const patchFields = buildSalesforceFields(link.kind, attributes, mappings);
            if (await patchSalesforceCrmObject(connection, link.kind, link.external_id, patchFields)) pushed += 1;
          }
        }
      }
      await query('UPDATE crm_connections SET last_error=NULL,updated_at=NOW() WHERE id=$1 AND business_id=$2', [connection.id, businessId]);
    } catch (error) {
      await query('UPDATE crm_connections SET last_error=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3', [
        String(error.code || error.message || 'CRM_OBJECT_OUTBOUND_FAILED').slice(0, 120),
        connection.id,
        businessId
      ]);
    }
  }
  return { pushed, created };
}

export async function runDueCrmObjectPush({ limit = 10 } = {}) {
  return transaction(async (client) => {
    const rows = (
      await client.query(
        `SELECT business_id,contact_id,attempts FROM crm_object_push_queue
         WHERE run_at<=NOW() AND attempts<8 ORDER BY run_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [Math.min(25, Math.max(1, limit))]
      )
    ).rows;
    let pushed = 0;
    for (const row of rows) {
      try {
        const result = await pushContactCrmObjects(row.business_id, row.contact_id);
        pushed += result.pushed;
        await client.query('DELETE FROM crm_object_push_queue WHERE business_id=$1 AND contact_id=$2', [row.business_id, row.contact_id]);
      } catch (error) {
        const attempts = Number(row.attempts || 0) + 1;
        await client.query(
          `UPDATE crm_object_push_queue SET attempts=$1,last_error=$2,run_at=NOW()+($3::int*INTERVAL '1 minute'),updated_at=NOW()
           WHERE business_id=$4 AND contact_id=$5`,
          [attempts, String(error.code || error.message).slice(0, 200), Math.min(60, 2 ** Math.min(6, attempts)), row.business_id, row.contact_id]
        );
      }
    }
    return { attempted: rows.length, pushed };
  });
}
