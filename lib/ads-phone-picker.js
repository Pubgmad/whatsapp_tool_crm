import { enterSystemContext, enterTenantContext, query } from './db.js';

const phoneSql = `SELECT p.phone_number_id, p.display_phone_number, p.verified_name
     FROM whatsapp_phone_numbers p
     JOIN whatsapp_accounts a ON a.id = p.whatsapp_account_id AND a.business_id = p.business_id
    WHERE p.business_id = $1
      AND LOWER(COALESCE(a.status, '')) = 'connected'
      AND COALESCE(a.access_token_encrypted, '') <> ''
      AND COALESCE(p.phone_number_id, '') <> ''
    ORDER BY p.is_default DESC NULLS LAST, p.created_at`;

/**
 * WhatsApp numbers connected in this CRM workspace (Setup → Numbers), not from the Facebook ad account.
 * Only registered whatsapp_phone_numbers rows — legacy businesses.phone_number_id cannot satisfy the ads FK.
 */
export async function listAdsPhonePickerRows(businessId, run = query) {
  const fetch = async () => (await run(phoneSql, [businessId])).rows;
  let out = await fetch();
  if (!out.length && businessId) {
    enterSystemContext();
    try {
      out = await fetch();
    } finally {
      enterTenantContext(businessId);
    }
  }
  return out;
}

export async function adsPhoneDisplayNumber(businessId, phoneNumberId, run = query) {
  const row = (await listAdsPhonePickerRows(businessId, run)).find(
    (item) => String(item.phone_number_id) === String(phoneNumberId)
  );
  return row?.display_phone_number || '';
}

/** True only when the phone exists on whatsapp_phone_numbers (required FK for ads connections). */
export async function adsPhoneIsRegisteredRow(businessId, phoneNumberId, run = query) {
  const id = String(phoneNumberId || '');
  if (!id) return false;
  const lookup = async () =>
    (
      await run(
        `SELECT 1 FROM whatsapp_phone_numbers WHERE business_id=$1 AND phone_number_id=$2 LIMIT 1`,
        [businessId, id]
      )
    ).rows[0];
  let row = await lookup();
  if (!row && businessId) {
    enterSystemContext();
    try {
      row = await lookup();
    } finally {
      enterTenantContext(businessId);
    }
  }
  return Boolean(row);
}
