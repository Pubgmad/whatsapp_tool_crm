import { query } from './db.js';

/** Phones eligible for CTWA ads finish — aligned with connected Cloud API accounts (not only registration_state=registered). */
export async function listAdsPhonePickerRows(businessId, run = query) {
  const rows = (
    await run(
      `SELECT p.phone_number_id, p.display_phone_number, p.verified_name
         FROM whatsapp_phone_numbers p
         JOIN whatsapp_accounts a ON a.id = p.whatsapp_account_id AND a.business_id = p.business_id
        WHERE p.business_id = $1
          AND a.status = 'connected'
          AND COALESCE(a.access_token_encrypted, '') <> ''
          AND COALESCE(p.phone_number_id, '') <> ''
        ORDER BY p.is_default DESC NULLS LAST, p.created_at`,
      [businessId]
    )
  ).rows;
  if (rows.length) return rows;
  const legacy = (
    await run(
      `SELECT phone_number_id,
              COALESCE(whatsapp_number, '') AS display_phone_number,
              COALESCE(name, '') AS verified_name
         FROM businesses
        WHERE id = $1
          AND COALESCE(phone_number_id, '') <> ''
          AND COALESCE(access_token_encrypted, '') <> ''`,
      [businessId]
    )
  ).rows[0];
  return legacy ? [legacy] : [];
}

export async function adsPhoneDisplayNumber(businessId, phoneNumberId, run = query) {
  const row = (await listAdsPhonePickerRows(businessId, run)).find(
    (item) => String(item.phone_number_id) === String(phoneNumberId)
  );
  return row?.display_phone_number || '';
}
