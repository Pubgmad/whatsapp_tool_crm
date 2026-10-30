import { AppError, id, query } from './db.js';
import { decryptSecret } from './meta.js';
import { cleanPhone } from './workspace-mappers.js';

function zohoConfigured() {
  return Boolean(process.env.ZOHO_CLIENT_ID?.trim() && process.env.ZOHO_CLIENT_SECRET?.trim());
}

async function refreshZohoAccess(install) {
  if (!zohoConfigured()) throw new AppError('Zoho is not configured on this platform.', 503, 'ZOHO_NOT_CONFIGURED');
  const refreshToken = decryptSecret(install.secret_encrypted);
  if (!refreshToken) throw new AppError('Zoho credentials missing. Reconnect Zoho.', 409, 'ZOHO_TOKEN_MISSING');
  const tokenRes = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.ZOHO_CLIENT_ID.trim(),
      client_secret: process.env.ZOHO_CLIENT_SECRET.trim(),
      refresh_token: refreshToken
    }),
    signal: AbortSignal.timeout(15000)
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) {
    throw new AppError(token.error || 'Zoho token refresh failed.', 502, 'ZOHO_TOKEN_FAILED');
  }
  return {
    accessToken: token.access_token,
    apiDomain: String(install.config?.apiDomain || token.api_domain || 'https://www.zohoapis.com').replace(/\/$/, '')
  };
}

function pickPhone(record) {
  const raw = record.Phone || record.Mobile || record.Other_Phone || record.phone || '';
  return cleanPhone(String(raw));
}

function pickName(record) {
  return String(record.Full_Name || record.Last_Name || record.First_Name || record.Company || record.Email || 'Zoho contact').slice(0, 120);
}

async function upsertZohoContact(businessId, record, source) {
  const phone = pickPhone(record);
  if (!phone) return { skipped: true, reason: 'no_phone' };
  const name = pickName(record);
  const existing = (await query(
    'SELECT id FROM contacts WHERE business_id=$1 AND phone=$2',
    [businessId, phone]
  )).rows[0];
  if (existing) {
    await query(
      `UPDATE contacts SET name=COALESCE(NULLIF($3,''), name), source=COALESCE(NULLIF(source,''), $4), updated_at=NOW()
       WHERE id=$1 AND business_id=$2`,
      [existing.id, businessId, name, source]
    );
    return { contactId: existing.id, created: false };
  }
  const contactId = id('c');
  await query(
    `INSERT INTO contacts (id, business_id, name, phone, source, opt_in_source)
     VALUES ($1,$2,$3,$4,$5,'Zoho CRM sync')
     ON CONFLICT (business_id, phone) DO NOTHING`,
    [contactId, businessId, name, phone, source]
  );
  const row = (await query('SELECT id FROM contacts WHERE business_id=$1 AND phone=$2', [businessId, phone])).rows[0];
  return { contactId: row?.id || contactId, created: true };
}

async function fetchZohoModule({ apiDomain, accessToken, moduleName, sinceIso, page = 1 }) {
  const url = new URL(`${apiDomain}/crm/v2/${moduleName}`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', '200');
  if (sinceIso) {
    url.searchParams.set('modified_since', sinceIso);
  }
  const response = await fetch(url, {
    headers: {
      authorization: `Zoho-oauthtoken ${accessToken}`,
      ...(sinceIso ? { 'If-Modified-Since': new Date(sinceIso).toUTCString() } : {})
    },
    signal: AbortSignal.timeout(20000)
  });
  if (response.status === 204) return { data: [], more: false };
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AppError(payload.message || `Zoho ${moduleName} sync failed.`, 502, 'ZOHO_SYNC_FAILED');
  }
  return {
    data: Array.isArray(payload.data) ? payload.data : [],
    more: Boolean(payload.info?.more_records)
  };
}

/**
 * Incremental Zoho Contacts + Leads → MathStrat contacts (inbound only by default).
 * Does not write back to Zoho unless explicitly configured later.
 */
export async function syncZohoCrmForBusiness(businessId) {
  const install = (await query(
    `SELECT * FROM marketplace_connector_installs WHERE business_id=$1 AND provider='zoho_crm' AND status='connected'`,
    [businessId]
  )).rows[0];
  if (!install) return { skipped: true, reason: 'not_connected' };

  const { accessToken, apiDomain } = await refreshZohoAccess(install);
  const config = install.config && typeof install.config === 'object' ? { ...install.config } : {};
  const sinceIso = config.syncCursor || null;
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let newest = sinceIso;

  for (const moduleName of ['Contacts', 'Leads']) {
    let page = 1;
    let more = true;
    while (more && page <= 5) {
      const batch = await fetchZohoModule({ apiDomain, accessToken, moduleName, sinceIso, page });
      for (const record of batch.data) {
        const result = await upsertZohoContact(businessId, record, `zoho_${moduleName.toLowerCase()}`);
        if (result.skipped) skipped += 1;
        else if (result.created) imported += 1;
        else updated += 1;
        const modified = record.Modified_Time || record.Created_Time;
        if (modified && (!newest || new Date(modified) > new Date(newest))) newest = modified;
      }
      more = batch.more;
      page += 1;
    }
  }

  config.syncCursor = newest || new Date().toISOString();
  config.lastSyncAt = new Date().toISOString();
  config.lastSyncSummary = { imported, updated, skipped };
  await query(
    `UPDATE marketplace_connector_installs
     SET config=$3::jsonb, last_activity_at=NOW(), last_error='', updated_at=NOW()
     WHERE id=$1 AND business_id=$2`,
    [install.id, businessId, JSON.stringify(config)]
  );
  return { imported, updated, skipped, syncCursor: config.syncCursor };
}

export async function runZohoCrmSyncJobs({ limit = 10 } = {}) {
  const installs = (await query(
    `SELECT business_id FROM marketplace_connector_installs
     WHERE provider='zoho_crm' AND status='connected'
       AND (
         COALESCE(config->>'lastSyncAt','') = ''
         OR (config->>'lastSyncAt')::timestamptz < NOW() - INTERVAL '15 minutes'
       )
     ORDER BY COALESCE((config->>'lastSyncAt')::timestamptz, to_timestamp(0)) ASC
     LIMIT $1`,
    [Math.min(25, Math.max(1, Number(limit) || 10))]
  )).rows;
  let synced = 0;
  let failed = 0;
  for (const row of installs) {
    try {
      await syncZohoCrmForBusiness(row.business_id);
      synced += 1;
    } catch (error) {
      failed += 1;
      await query(
        `UPDATE marketplace_connector_installs SET last_error=$2, updated_at=NOW()
         WHERE business_id=$1 AND provider='zoho_crm'`,
        [row.business_id, String(error?.message || 'Zoho sync failed').slice(0, 500)]
      );
    }
  }
  return { attempted: installs.length, synced, failed };
}
