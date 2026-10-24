function step(store, count, note = '') {
  return { store, count, note, at: new Date().toISOString() };
}

async function adsPrincipalCount(client, businessId) {
  const row = await client.query(
    `SELECT COUNT(DISTINCT meta_user_id)::int AS total
       FROM meta_authorizations
      WHERE business_id = $1 AND integration = 'ads'`,
    [businessId]
  );
  return Number(row.rows[0]?.total || 0);
}

async function legacySubmissionsResolvable(client, businessId, metaUserId) {
  const principals = await adsPrincipalCount(client, businessId);
  if (principals <= 1) return true;
  const ambiguous = await client.query(
    `SELECT 1 FROM meta_leadgen_submissions
      WHERE business_id = $1 AND meta_user_id = '' LIMIT 1`,
    [businessId]
  );
  if (!ambiguous.rowCount) return true;
  const onlyThis = await client.query(
    `SELECT 1 FROM meta_authorizations
      WHERE business_id = $1 AND integration = 'ads' AND meta_user_id = $2
      LIMIT 1`,
    [businessId, metaUserId]
  );
  return principals === 1 || onlyThis.rowCount > 0;
}

function lineageKeys(lineage = {}) {
  return Object.keys(lineage || {});
}

function stripMetaFromContact(contact, leadLineage) {
  const attrs = { ...(contact.custom_attributes || {}) };
  delete attrs.leadFormId;
  delete attrs.metaLeadId;
  if (leadLineage['custom_attributes.email']) delete attrs.email;
  const keys = lineageKeys(leadLineage);
  let name = contact.name;
  let phone = contact.phone;
  for (const key of keys) {
    if (key === 'name') name = '';
    if (key === 'phone') phone = '';
    if (key.startsWith('custom_attributes.')) {
      const attrKey = key.slice('custom_attributes.'.length);
      delete attrs[attrKey];
    }
  }
  return { name, phone, attrs, clearedLineage: keys.length > 0 };
}

/**
 * Remove Meta lead copies for a principal within one business.
 * Does not delete unrelated tenants or another principal's credentials.
 */
export async function purgeMetaLeadCopiesForPrincipal(client, { businessId, metaUserId }) {
  const log = [];
  const legacyOk = await legacySubmissionsResolvable(client, businessId, metaUserId);
  const submissionFilter = legacyOk
    ? `(meta_user_id = $2 OR meta_user_id = '')`
    : `meta_user_id = $2`;
  const submissions = (
    await client.query(
      `SELECT id, lead_id, contact_id, form_id
         FROM meta_leadgen_submissions
        WHERE business_id = $1 AND ${submissionFilter}`,
      [businessId, metaUserId]
    )
  ).rows;

  if (!legacyOk) {
    const unresolved = await client.query(
      `SELECT COUNT(*)::int AS total FROM meta_leadgen_submissions
        WHERE business_id = $1 AND meta_user_id = ''`,
      [businessId]
    );
    if (Number(unresolved.rows[0]?.total || 0) > 0) {
      log.push(step('meta_leadgen_legacy', 0, 'legacy_provenance_unresolved'));
    }
  }

  let contactsDeleted = 0;
  let contactsStripped = 0;
  let eventsRedacted = 0;
  let auditsRedacted = 0;

  for (const submission of submissions) {
    const leadId = submission.lead_id;
    const contactId = submission.contact_id;
    if (contactId) {
      const contact = (
        await client.query(
          `SELECT id, name, phone, source, meta_lead_only, meta_lead_lineage, custom_attributes
             FROM contacts WHERE id = $1 AND business_id = $2`,
          [contactId, businessId]
        )
      ).rows[0];
      if (contact?.meta_lead_only) {
        await client.query('DELETE FROM contacts WHERE id = $1 AND business_id = $2', [contactId, businessId]);
        contactsDeleted += 1;
      } else if (contact) {
        const lineage = contact.meta_lead_lineage || {};
        const leadLineage = Object.fromEntries(
          Object.entries(lineage).filter(([, value]) => value?.leadId === leadId)
        );
        if (Object.keys(leadLineage).length) {
          const remaining = { ...lineage };
          for (const key of Object.keys(leadLineage)) delete remaining[key];
          const stripped = stripMetaFromContact(contact, leadLineage, [leadId]);
          await client.query(
            `UPDATE contacts
                SET name = $4,
                    phone = $5,
                    custom_attributes = $6::jsonb,
                    meta_lead_lineage = $3::jsonb,
                    meta_lead_only = FALSE,
                    updated_at = NOW()
              WHERE id = $1 AND business_id = $2`,
            [
              contactId,
              businessId,
              JSON.stringify(remaining),
              leadLineage.name ? stripped.name : contact.name,
              leadLineage.phone ? stripped.phone : contact.phone,
              JSON.stringify(stripped.attrs)
            ]
          );
          contactsStripped += 1;
        }
      }
    }
    const ev = await client.query(
      `UPDATE events
          SET metadata = metadata - 'fields' || jsonb_build_object('leadId', '', 'formId', '', 'redacted', true)
        WHERE business_id = $1 AND type = 'meta_leadgen_ingested'
          AND metadata->>'leadId' = $2`,
      [businessId, leadId]
    );
    eventsRedacted += ev.rowCount;
    const au = await client.query(
      `UPDATE audit_logs
          SET metadata = jsonb_build_object('contactId', metadata->>'contactId', 'formId', '', 'leadId', '', 'redacted', true)
        WHERE business_id = $1 AND action = 'meta_leadgen_contact'
          AND metadata->>'leadId' = $2`,
      [businessId, leadId]
    );
    auditsRedacted += au.rowCount;
  }

  const removed = await client.query(
    `DELETE FROM meta_leadgen_submissions
      WHERE business_id = $1 AND ${submissionFilter}`,
    [businessId, metaUserId]
  );

  log.push(step('meta_leadgen_submissions', removed.rowCount));
  log.push(step('contacts_meta_only_deleted', contactsDeleted));
  log.push(step('contacts_meta_fields_stripped', contactsStripped));
  log.push(step('events_meta_lead_redacted', eventsRedacted));
  log.push(step('audit_meta_lead_redacted', auditsRedacted));
  return log;
}
