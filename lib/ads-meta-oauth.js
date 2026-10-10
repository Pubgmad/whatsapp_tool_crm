import crypto from 'crypto';
import { requireSession } from './auth.js';
import { AppError, errorJson, id, json, query, transaction } from './db.js';
import { encryptSecret, decryptSecret } from './meta.js';
import { metaGraphApiVersion } from './operational-policy.js';
import { assertWorkspaceFeature } from './feature-controls.js';
import { readTextBodyLimited } from './security.js';

const clean = (value) => String(value || '').trim();
const metaId = (value) => /^\d{1,32}$/.test(String(value || ''));

/** Permissions required for production Ads & Growth (CTWA, insights, leadgen). */
export const ADS_REQUIRED_SCOPES = Object.freeze([
  'ads_management',
  'ads_read',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_manage_ads',
  'leads_retrieval',
  'business_management'
]);

export function adsOAuthRedirectUri(requestUrl) {
  const base = clean(process.env.APP_URL) || clean(process.env.META_ADS_OAUTH_REDIRECT_BASE);
  if (base) return new URL('/api/whatsapp/ads/oauth/callback', base).toString();
  return new URL('/api/whatsapp/ads/oauth/callback', requestUrl).toString();
}

function adsAppConfig() {
  const appId = clean(process.env.META_APP_ID);
  const appSecret = clean(process.env.META_APP_SECRET);
  if (!appId || !appSecret || !/^\d+$/.test(appId)) {
    throw new AppError('META_APP_ID and META_APP_SECRET must be configured for Facebook Login ads OAuth.', 503, 'META_APP_NOT_CONFIGURED');
  }
  const appUrl = clean(process.env.APP_URL);
  if (process.env.NODE_ENV === 'production' && (!appUrl || new URL(appUrl).protocol !== 'https:')) {
    throw new AppError('APP_URL must be the public HTTPS URL for Meta ads OAuth callbacks.', 503, 'META_HTTPS_REQUIRED');
  }
  return { appId, appSecret };
}

function digest(state) {
  return crypto.createHash('sha256').update(state).digest('hex');
}

async function graphGet(token, path) {
  const response = await fetch(`https://graph.facebook.com/${metaGraphApiVersion()}/${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(20000)
  });
  const result = JSON.parse(await readTextBodyLimited(response, 2_000_000));
  if (!response.ok) throw new AppError(result.error?.message || 'Meta request failed.', response.status >= 500 ? 502 : 400, 'META_REQUEST_FAILED');
  return result;
}

async function graphPost(token, path, body) {
  const response = await fetch(`https://graph.facebook.com/${metaGraphApiVersion()}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(20000)
  });
  const result = JSON.parse(await readTextBodyLimited(response, 2_000_000));
  if (!response.ok) throw new AppError(result.error?.message || 'Meta request failed.', response.status >= 500 ? 502 : 400, 'META_REQUEST_FAILED');
  return result;
}

export function permissionReportFromScopes(scopes = []) {
  const granted = new Set(scopes.map(String));
  const missing = ADS_REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
  return {
    required: [...ADS_REQUIRED_SCOPES],
    granted: [...granted],
    missing,
    complete: missing.length === 0,
    appReviewNote:
      'Production access beyond development/test assets requires Meta App Review for ads and lead retrieval permissions.',
    liveVerification: missing.length ? 'awaiting_scopes' : 'awaiting_live_traffic'
  };
}

export async function debugAdsToken(accessToken) {
  const { appId, appSecret } = adsAppConfig();
  const payload = await graphGet(`${appId}|${appSecret}`, `debug_token?input_token=${encodeURIComponent(accessToken)}`);
  const data = payload.data || {};
  if (!data.is_valid || String(data.app_id) !== appId) {
    throw new AppError('Meta returned an invalid advertising token for this application.', 401, 'META_TOKEN_INVALID');
  }
  const report = permissionReportFromScopes(data.scopes || []);
  return {
    scopes: data.scopes || [],
    expiresAt: Number(data.expires_at || 0) > 0 ? new Date(Number(data.expires_at) * 1000) : null,
    report,
    userId: data.user_id || null
  };
}

export async function subscribePageLeadgen(userToken, pageId) {
  if (!metaId(pageId)) throw new AppError('Invalid Facebook Page id.', 400, 'ADS_PAYLOAD_INVALID');
  const accounts = await graphGet(userToken, 'me/accounts?fields=id,name,access_token&limit=100');
  const page = (accounts.data || []).find((row) => String(row.id) === String(pageId));
  if (!page?.access_token) {
    throw new AppError('This Facebook Page is not available with the granted token. Reauthorize with pages permissions.', 403, 'ADS_PAGE_TOKEN_MISSING');
  }
  await graphPost(page.access_token, `${pageId}/subscribed_apps`, { subscribed_fields: ['leadgen'] });
  return { pageId, leadgenSubscribed: true, pageName: page.name || '' };
}

export async function listAdsOAuthAssets(userToken) {
  const [adAccounts, pages] = await Promise.all([
    graphGet(userToken, 'me/adaccounts?fields=id,account_id,name,account_status,currency&limit=50'),
    graphGet(userToken, 'me/accounts?fields=id,name,access_token&limit=50')
  ]);
  return {
    adAccounts: (adAccounts.data || [])
      .filter((row) => metaId(String(row.account_id || '').replace(/^act_/, '')) || metaId(String(row.id || '').replace(/^act_/, '')))
      .map((row) => ({
        id: String(row.account_id || String(row.id || '').replace(/^act_/, '')),
        name: row.name || '',
        currency: row.currency || '',
        accountStatus: row.account_status
      })),
    pages: (pages.data || [])
      .filter((row) => metaId(row.id))
      .map((row) => ({ id: String(row.id), name: row.name || '' }))
  };
}

export async function startAdsOAuth(request) {
  try {
    const session = await requireSession(request);
    if (session.role !== 'Owner') throw new AppError('Only the owner can connect Meta advertising via Facebook Login.', 403, 'FORBIDDEN');
    await assertWorkspaceFeature('ads', session.businessId);
    const { appId } = adsAppConfig();
    const state = crypto.randomBytes(24).toString('hex');
    await query(
      `INSERT INTO ads_oauth_states (state_hash, business_id, user_id, expires_at)
       VALUES ($1,$2,$3,NOW()+INTERVAL '10 minutes')`,
      [digest(state), session.businessId, session.userId]
    );
    const redirectUri = adsOAuthRedirectUri(request.url);
    const url = new URL(`https://www.facebook.com/${metaGraphApiVersion()}/dialog/oauth`);
    url.search = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: ADS_REQUIRED_SCOPES.join(',')
    }).toString();
    return json({ url: url.toString(), redirectUri, scopes: ADS_REQUIRED_SCOPES });
  } catch (error) {
    return errorJson(error);
  }
}

export async function handleAdsOAuthCallback(request) {
  try {
    const { appId, appSecret } = adsAppConfig();
    const params = new URL(request.url).searchParams;
    const code = clean(params.get('code'));
    const state = clean(params.get('state'));
    const oauthError = clean(params.get('error_description') || params.get('error'));
    const appOrigin = new URL(process.env.APP_URL || request.url).origin;
    if (oauthError) {
      return Response.redirect(`${appOrigin}/app?section=ads&adsOAuthError=${encodeURIComponent(oauthError.slice(0, 200))}`, 302);
    }
    if (!code || !state) throw new AppError('Meta OAuth callback is missing code or state.', 400, 'META_OAUTH_INVALID');
    const used = (
      await query(
        `DELETE FROM ads_oauth_states WHERE state_hash=$1 AND expires_at>NOW() RETURNING business_id, user_id`,
        [digest(state)]
      )
    ).rows[0];
    if (!used) throw new AppError('Ads OAuth state expired or is invalid. Start Facebook Login again.', 400, 'META_OAUTH_STATE');
    const redirectUri = adsOAuthRedirectUri(request.url);
    const form = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code
    });
    const exchangeResponse = await fetch(`https://graph.facebook.com/${metaGraphApiVersion()}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(30000)
    });
    const exchange = JSON.parse(await readTextBodyLimited(exchangeResponse, 200_000));
    if (!exchangeResponse.ok || !exchange.access_token) {
      throw new AppError(exchange.error?.message || 'Meta authorization-code exchange failed.', 400, 'META_CODE_EXCHANGE_FAILED');
    }
    const debug = await debugAdsToken(exchange.access_token);
    await query(
      `INSERT INTO ads_oauth_pending (business_id, user_id, access_token_encrypted, token_scopes, token_expires_at, permission_report, expires_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,NOW()+INTERVAL '30 minutes')
       ON CONFLICT (business_id) DO UPDATE SET
         user_id=EXCLUDED.user_id,
         access_token_encrypted=EXCLUDED.access_token_encrypted,
         token_scopes=EXCLUDED.token_scopes,
         token_expires_at=EXCLUDED.token_expires_at,
         permission_report=EXCLUDED.permission_report,
         expires_at=EXCLUDED.expires_at,
         updated_at=NOW()`,
      [
        used.business_id,
        used.user_id,
        encryptSecret(exchange.access_token),
        JSON.stringify(debug.scopes),
        debug.expiresAt,
        JSON.stringify(debug.report)
      ]
    );
    await query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)', [
      id('a'),
      used.business_id,
      used.user_id,
      'whatsapp_ads_oauth_authorized',
      JSON.stringify({ scopesComplete: debug.report.complete, missing: debug.report.missing })
    ]);
    return Response.redirect(`${appOrigin}/app?section=ads&adsOAuth=1`, 302);
  } catch (error) {
    const appOrigin = new URL(process.env.APP_URL || request.url).origin;
    const message = encodeURIComponent((error?.message || 'OAuth failed').slice(0, 200));
    return Response.redirect(`${appOrigin}/app?section=ads&adsOAuthError=${message}`, 302);
  }
}

export async function getAdsOAuthPending(request) {
  try {
    const session = await requireSession(request);
    if (session.role !== 'Owner') throw new AppError('Only the owner can finish ads OAuth.', 403, 'FORBIDDEN');
    await assertWorkspaceFeature('ads', session.businessId);
    const pending = (
      await query(
        `SELECT token_scopes, token_expires_at, permission_report, expires_at
         FROM ads_oauth_pending WHERE business_id=$1 AND expires_at>NOW()`,
        [session.businessId]
      )
    ).rows[0];
    if (!pending) return json({ pending: false });
    const token = decryptSecret(
      (
        await query('SELECT access_token_encrypted FROM ads_oauth_pending WHERE business_id=$1', [session.businessId])
      ).rows[0].access_token_encrypted
    );
    const assets = await listAdsOAuthAssets(token);
    return json({
      pending: true,
      scopes: pending.token_scopes,
      permissionReport: pending.permission_report,
      tokenExpiresAt: pending.token_expires_at,
      ...assets
    });
  } catch (error) {
    return errorJson(error);
  }
}

export async function completeAdsOAuth(session, body) {
  if (session.role !== 'Owner') throw new AppError('Only the owner can finish ads OAuth.', 403, 'FORBIDDEN');
  if (!metaId(body.adAccountId) || !metaId(body.pageId) || !metaId(body.phoneId)) {
    throw new AppError('Select an ad account, Facebook Page, and WhatsApp number.', 400, 'ADS_PAYLOAD_INVALID');
  }
  const pending = (
    await query(
      `SELECT access_token_encrypted, token_scopes, token_expires_at, permission_report
       FROM ads_oauth_pending WHERE business_id=$1 AND expires_at>NOW()`,
      [session.businessId]
    )
  ).rows[0];
  if (!pending) throw new AppError('Facebook Login session expired. Start Continue with Facebook again.', 409, 'ADS_OAUTH_EXPIRED');
  const token = decryptSecret(pending.access_token_encrypted);
  const debug = await debugAdsToken(token);
  if (!debug.report.complete) {
    throw new AppError(
      `Meta did not grant required ads permissions: ${debug.report.missing.join(', ')}. Reauthorize and approve all scopes.`,
      403,
      'META_SCOPE_MISSING'
    );
  }
  const pageClaim = (
    await query('SELECT business_id FROM whatsapp_ads_connections WHERE page_id=$1 AND business_id<>$2 LIMIT 1', [
      body.pageId,
      session.businessId
    ])
  ).rows[0];
  if (pageClaim) throw new AppError('This Facebook Page is already linked to another workspace for ads.', 409, 'ADS_PAGE_IN_USE');

  const phone = (
    await query(
      `SELECT p.display_phone_number FROM whatsapp_phone_numbers p
       JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id
       WHERE p.business_id=$1 AND p.phone_number_id=$2 AND p.registration_state='registered' AND a.status='connected'`,
      [session.businessId, body.phoneId]
    )
  ).rows[0];
  if (!phone) throw new AppError('Connect and register the selected WhatsApp number first.', 409, 'ADS_PHONE_INELIGIBLE');
  const number = phone.display_phone_number.replace(/\D/g, '');
  const account = await graphGet(token, `act_${body.adAccountId}?fields=id,account_status,currency`);
  const page = await graphGet(token, `${body.pageId}?fields=id,whatsapp_number`);
  if (
    String(account.id) !== `act_${body.adAccountId}` ||
    account.account_status !== 1 ||
    String(page.id) !== body.pageId ||
    String(page.whatsapp_number || '').replace(/\D/g, '') !== number
  ) {
    throw new AppError('Meta must grant access to an active ad account and a Page linked to this exact WhatsApp number.', 403, 'ADS_ASSET_MISMATCH');
  }
  const leadgen = await subscribePageLeadgen(token, body.pageId);
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO whatsapp_ads_connections (
         business_id, ad_account_id, page_id, phone_number_id, currency, access_token_encrypted,
         token_scopes, token_expires_at, leadgen_subscribed, permissions_checked_at, connection_method, last_permission_report
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,NOW(),'facebook_login',$10::jsonb)
       ON CONFLICT (business_id) DO UPDATE SET
         ad_account_id=EXCLUDED.ad_account_id,
         page_id=EXCLUDED.page_id,
         phone_number_id=EXCLUDED.phone_number_id,
         currency=EXCLUDED.currency,
         access_token_encrypted=EXCLUDED.access_token_encrypted,
         token_scopes=EXCLUDED.token_scopes,
         token_expires_at=EXCLUDED.token_expires_at,
         leadgen_subscribed=EXCLUDED.leadgen_subscribed,
         permissions_checked_at=NOW(),
         connection_method=EXCLUDED.connection_method,
         last_permission_report=EXCLUDED.last_permission_report,
         updated_at=NOW()`,
      [
        session.businessId,
        body.adAccountId,
        body.pageId,
        body.phoneId,
        account.currency,
        encryptSecret(token),
        JSON.stringify(debug.scopes),
        debug.expiresAt,
        leadgen.leadgenSubscribed,
        JSON.stringify(debug.report)
      ]
    );
    await client.query('DELETE FROM ads_oauth_pending WHERE business_id=$1', [session.businessId]);
  });
  await query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)', [
    id('a'),
    session.businessId,
    session.userId,
    'whatsapp_ads_oauth_connected',
    JSON.stringify({ adAccountId: body.adAccountId, pageId: body.pageId, phoneId: body.phoneId, leadgen: true })
  ]);
  return { ok: true, leadgenSubscribed: true, permissionReport: debug.report };
}

export async function recheckAdsPermissions(businessId, token) {
  const debug = await debugAdsToken(token);
  await query(
    `UPDATE whatsapp_ads_connections
     SET token_scopes=$2::jsonb, token_expires_at=$3, last_permission_report=$4::jsonb, permissions_checked_at=NOW(), updated_at=NOW()
     WHERE business_id=$1`,
    [businessId, JSON.stringify(debug.scopes), debug.expiresAt, JSON.stringify(debug.report)]
  );
  return debug.report;
}
