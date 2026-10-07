import { query } from './db.js';
import { exportOutboundHubSpotContact } from './hubspot-contacts.js';
import { exportOutboundSalesforceLead } from './salesforce-contacts.js';
import { loadContactCrmOutboundContext, shouldExportContactToCrm } from './crm-outbound-context.js';

export async function pushOutboundCrmContact(businessId, contactId) {
  const ctx = await loadContactCrmOutboundContext(businessId, contactId);
  if (!ctx || !shouldExportContactToCrm(ctx)) return { pushed: 0 };
  const connections = (await query(
    "SELECT * FROM crm_connections WHERE business_id=$1 AND enabled AND COALESCE(sync_outbound_enabled,TRUE)",
    [businessId]
  )).rows;
  let pushed = 0;
  for (const connection of connections) {
    const linked = (await query(
      'SELECT 1 FROM crm_contact_links WHERE business_id=$1 AND connection_id=$2 AND contact_id=$3',
      [businessId, connection.id, ctx.id]
    )).rowCount;
    if (linked) continue;
    try {
      const externalId =
        connection.provider === 'hubspot'
          ? await exportOutboundHubSpotContact(connection, ctx)
          : connection.provider === 'salesforce'
            ? await exportOutboundSalesforceLead(connection, ctx)
            : null;
      if (externalId) pushed += 1;
    } catch {
      await query('UPDATE crm_connections SET last_error=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3', [
        'CRM_OUTBOUND_FAILED',
        connection.id,
        businessId
      ]);
    }
  }
  return { pushed };
}

export async function runDueCrmOutboundPush({ limit = 5 } = {}) {
  const rows = (await query(
    `SELECT DISTINCT c.business_id,c.id AS contact_id FROM contacts c
     JOIN crm_connections r ON r.business_id=c.business_id AND r.enabled AND COALESCE(r.sync_outbound_enabled,TRUE)
     WHERE c.source NOT IN ('HubSpot','Salesforce')
       AND (
         EXISTS (
           SELECT 1 FROM conversations cv
           WHERE cv.business_id=c.business_id AND cv.contact_id=c.id AND cv.whatsapp_phone_number_id<>''
         )
         OR c.source='Meta webhook'
         OR c.source='WhatsApp Business App'
         OR c.opt_in_source='Customer initiated'
       )
       AND NOT EXISTS (
         SELECT 1 FROM crm_contact_links l
         WHERE l.business_id=c.business_id AND l.connection_id=r.id AND l.contact_id=c.id
       )
     ORDER BY c.created_at LIMIT $1`,
    [Math.min(20, Math.max(1, limit))]
  )).rows;
  let pushed = 0;
  for (const row of rows) {
    const result = await pushOutboundCrmContact(row.business_id, row.contact_id);
    pushed += result.pushed;
  }
  return { attempted: rows.length, pushed };
}
