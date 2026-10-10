import { AppError, id } from './db.js';
import { cleanPhone } from './workspace-mappers.js';
import { metaGraphApiVersion } from './operational-policy.js';
import { readTextBodyLimited } from './security.js';

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

/**
 * Ingest a Meta leadgen submission into contacts + events.
 * Idempotent on (business_id, lead_id) via meta_leadgen_submissions.
 * marketing_permission is FALSE until explicit WhatsApp consent is recorded — lead form ≠ WA marketing opt-in.
 */
export async function ingestMetaLeadgenSubmission(client, businessId, submission) {
  const formId = String(submission?.formId || submission?.form_id || '').slice(0, 80);
  const leadId = String(submission?.leadId || submission?.id || '').slice(0, 80);
  const fields = Array.isArray(submission?.field_data) ? submission.field_data : submission?.fields || [];
  if (!businessId || !formId || !leadId) throw new AppError('Lead submission is incomplete.', 400, 'LEADGEN_INVALID');

  const existing = (
    await client.query('SELECT id, contact_id FROM meta_leadgen_submissions WHERE business_id=$1 AND lead_id=$2', [businessId, leadId])
  ).rows[0];
  if (existing) return { contactId: existing.contact_id, formId, leadId, duplicate: true };

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
       VALUES ($1,$2,$3,$4,'Meta lead ad','Lead form',FALSE,$5::jsonb)
       ON CONFLICT (business_id, phone) DO UPDATE SET name=EXCLUDED.name, custom_attributes=contacts.custom_attributes||EXCLUDED.custom_attributes, updated_at=NOW()`,
      [contactId, businessId, normalized.name, phoneForRow, attrs]
    );
    contactId = (await client.query('SELECT id FROM contacts WHERE business_id=$1 AND phone=$2', [businessId, phoneForRow])).rows[0]?.id || contactId;
  } else {
    await client.query(
      `UPDATE contacts SET custom_attributes=custom_attributes || $1::jsonb, updated_at=NOW()
       WHERE id=$2 AND business_id=$3`,
      [JSON.stringify({ ...(normalized.email ? { email: normalized.email } : {}), leadFormId: formId, metaLeadId: leadId }), contactId, businessId]
    );
  }

  await client.query(
    `INSERT INTO meta_leadgen_submissions (id, business_id, form_id, lead_id, contact_id, field_data)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT (business_id, lead_id) DO NOTHING`,
    [id('mlg'), businessId, formId, leadId, contactId, JSON.stringify(fields)]
  );

  await client.query(
    `INSERT INTO events (id, business_id, type, contact_id, metadata)
     VALUES ($1,$2,'meta_leadgen_ingested',$3,$4)`,
    [id('e'), businessId, contactId, JSON.stringify({ formId, leadId, fields: normalized.raw })]
  );
  await client.query(
    "INSERT INTO audit_logs (id, business_id, action, metadata) VALUES ($1,$2,'meta_leadgen_contact',$3)",
    [id('a'), businessId, JSON.stringify({ contactId, formId, leadId })]
  );
  return { contactId, formId, leadId, duplicate: false };
}

/**
 * Meta leadgen webhooks typically send leadgen_id + form_id without field_data.
 * Fetch the authorized lead payload from Graph before CRM ingest.
 */
export async function fetchLeadgenFieldData(token, leadId) {
  if (!token || !/^\d{1,32}$/.test(String(leadId || ''))) {
    throw new AppError('Lead retrieval requires a valid Meta lead id and page access token.', 400, 'LEADGEN_FETCH_INVALID');
  }
  const response = await fetch(
    `https://graph.facebook.com/${metaGraphApiVersion()}/${encodeURIComponent(leadId)}?fields=id,created_time,field_data,form_id`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000)
    }
  );
  const result = JSON.parse(await readTextBodyLimited(response, 2_000_000));
  if (!response.ok) {
    throw new AppError(result.error?.message || 'Could not load Meta lead details.', response.status >= 500 ? 502 : 400, 'LEADGEN_FETCH_FAILED');
  }
  return {
    leadId: String(result.id || leadId),
    formId: String(result.form_id || ''),
    field_data: Array.isArray(result.field_data) ? result.field_data : [],
    created_time: result.created_time || null
  };
}

/** Resolve tenant for a Meta Page used in ads/leadgen. Prefer WABA match when multiple (pre-unique-index) rows exist. */
export async function resolveLeadgenBusinessId(queryFn, pageId, webhookBusinessId = '') {
  if (!pageId) return webhookBusinessId || null;
  const rows = (
    await queryFn(
      `SELECT c.business_id, a.waba_id
       FROM whatsapp_ads_connections c
       LEFT JOIN whatsapp_accounts a ON a.business_id=c.business_id AND a.status='connected'
       WHERE c.page_id=$1`,
      [pageId]
    )
  ).rows;
  if (!rows.length) return webhookBusinessId || null;
  if (rows.length === 1) return rows[0].business_id;
  if (webhookBusinessId && rows.some((row) => row.business_id === webhookBusinessId)) return webhookBusinessId;
  throw new AppError('Multiple workspaces claim this Facebook Page for ads. Disconnect extras before ingesting leads.', 409, 'LEADGEN_PAGE_AMBIGUOUS');
}
