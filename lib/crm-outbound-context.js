import { query } from './db.js';

const CRM_IMPORTED_SOURCES = new Set(['HubSpot', 'Salesforce']);

function clean(value) {
  return String(value || '').trim();
}

export function tenantDisplayName(ctx) {
  return clean(ctx?.business_name) || clean(ctx?.verified_name) || clean(ctx?.display_phone_number);
}

export function shouldExportContactToCrm(ctx) {
  if (!ctx?.phone) return false;
  if (CRM_IMPORTED_SOURCES.has(clean(ctx.source))) return false;
  if (clean(ctx.whatsapp_phone_number_id)) return true;
  if (clean(ctx.opt_in_source) === 'Customer initiated') return true;
  if (clean(ctx.source) === 'Meta webhook') return true;
  if (clean(ctx.source) === 'WhatsApp Business App') return true;
  return false;
}

export function crmLeadDescription(ctx) {
  const parts = [];
  const line = clean(ctx.display_phone_number);
  const verified = clean(ctx.verified_name);
  if (verified) parts.push(`WABA display: ${verified}`);
  if (line) parts.push(`WhatsApp line: ${line}`);
  const optIn = clean(ctx.opt_in_source);
  if (optIn) parts.push(`Opt-in: ${optIn}`);
  const channel = clean(ctx.source);
  if (channel) parts.push(`Channel: ${channel}`);
  return parts.join(' | ').slice(0, 32000);
}

export async function loadContactCrmOutboundContext(businessId, contactId) {
  return (
    await query(
      `SELECT c.id,c.name,c.phone,c.source,c.opt_in_source,
        b.name AS business_name,
        cv.whatsapp_phone_number_id,
        p.verified_name,p.display_phone_number
       FROM contacts c
       JOIN businesses b ON b.id=c.business_id
       LEFT JOIN LATERAL (
         SELECT whatsapp_phone_number_id FROM conversations
         WHERE business_id=c.business_id AND contact_id=c.id AND whatsapp_phone_number_id<>'' 
         ORDER BY updated_at DESC LIMIT 1
       ) cv ON TRUE
       LEFT JOIN whatsapp_phone_numbers p ON p.business_id=c.business_id AND p.phone_number_id=cv.whatsapp_phone_number_id
       WHERE c.business_id=$1 AND c.id=$2`,
      [businessId, contactId]
    )
  ).rows[0];
}
