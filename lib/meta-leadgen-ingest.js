import { AppError, id } from './db.js';
import { cleanPhone } from './workspace-mappers.js';

export function normalizeLeadgenFields(fields = []) {
  const map = {};
  for (const field of fields) {
    const name = String(field?.name || field?.key || '').toLowerCase();
    const value = String(field?.values?.[0] || field?.value || '').trim();
    if (!name || !value) continue;
    map[name] = value;
  }
  const phone = cleanPhone(map.phone || map.phone_number || map.mobile || map.whatsapp || '');
  const email = String(map.email || map.email_address || '').slice(0, 320).toLowerCase();
  const name = String(map.full_name || map.name || map.first_name || phone || email || 'Lead').slice(0, 120);
  return { phone, email, name, raw: map };
}

export async function ingestMetaLeadgenSubmission(client, businessId, submission) {
  const formId = String(submission?.formId || submission?.form_id || '').slice(0, 80);
  const leadId = String(submission?.leadId || submission?.id || '').slice(0, 80);
  const fields = Array.isArray(submission?.field_data) ? submission.field_data : submission?.fields || [];
  if (!businessId || !formId || !leadId) throw new AppError('Lead submission is incomplete.', 400, 'LEADGEN_INVALID');
  const normalized = normalizeLeadgenFields(fields);
  if (!normalized.phone && !normalized.email) {
    throw new AppError('Lead must include a phone number or email.', 400, 'LEADGEN_CONTACT_MISSING');
  }
  let contact = null;
  if (normalized.phone) {
    contact = (await client.query('SELECT id FROM contacts WHERE business_id=$1 AND phone=$2', [businessId, normalized.phone])).rows[0];
  }
  if (!contact && normalized.email) {
    contact = (
      await client.query(
        `SELECT id FROM contacts WHERE business_id=$1 AND custom_attributes->>'email' ILIKE $2 LIMIT 1`,
        [businessId, normalized.email]
      )
    ).rows[0];
  }
  let contactId = contact?.id;
  const phoneForRow = normalized.phone || `lead:${leadId}`;
  if (!contactId) {
    contactId = id('c');
    const attrs = JSON.stringify({ ...(normalized.email ? { email: normalized.email } : {}), leadFormId: formId, metaLeadId: leadId });
    await client.query(
      `INSERT INTO contacts (id, business_id, name, phone, source, opt_in_source, marketing_permission, custom_attributes)
       VALUES ($1,$2,$3,$4,'Meta lead ad','Lead form',TRUE,$5::jsonb)
       ON CONFLICT (business_id, phone) DO UPDATE SET name=EXCLUDED.name, custom_attributes=contacts.custom_attributes||EXCLUDED.custom_attributes, updated_at=NOW()`,
      [contactId, businessId, normalized.name, phoneForRow, attrs]
    );
    contactId = (await client.query('SELECT id FROM contacts WHERE business_id=$1 AND phone=$2', [businessId, phoneForRow])).rows[0]?.id || contactId;
  }
  await client.query(
    `INSERT INTO events (id, business_id, type, contact_id, metadata)
     VALUES ($1,$2,'meta_leadgen_ingested',$3,$4)`,
    [id('e'), businessId, contactId, JSON.stringify({ formId, leadId, fields: normalized.raw })]
  );
  await client.query(
    "INSERT INTO audit_logs (id, business_id, action, metadata) VALUES ($1,$2,'meta_leadgen_contact',$3)",
    [id('a'), businessId, JSON.stringify({ contactId, formId, leadId })]
  );
  return { contactId, formId, leadId };
}
