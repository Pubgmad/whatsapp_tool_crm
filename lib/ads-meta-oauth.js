import crypto from 'crypto';
import { parseCookies, SESSION_COOKIE_NAME, verifySessionToken } from './auth.js';
import {
  ADS_DEFAULT_REQUESTED,
  ADS_REQUIRED_SCOPES,
  assertAdsCapability,
  nextGraphPath,
  parseRequestedCapabilities,
  permissionReportFromScopes,
  scopesForCapabilities
} from './ads-capabilities.js';
import { AppError, enterSystemContext, enterTenantContext, errorJson, id, json, query, transaction } from './db.js';
import { encryptSecret, decryptSecret } from './meta.js';
import { metaGraphApiVersion } from './operational-policy.js';
import { workspaceFeatureFlags } from './feature-controls.js';
import { ADS_OAUTH_BUILD } from './health.js';
import { readTextBodyLimited } from './security.js';
import { recordMetaAuthorization } from './meta-authorization.js';

const clean = (value) => String(value || '').trim();
const metaId = (value) => /^\d{1,32}$/.test(String(value || ''));
const MAX_GRAPH_PAGES = 20;

export { ADS_REQUIRED_SCOPES, permissionReportFromScopes, assertAdsCapability };

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

function oauthStateSecret() {
  const value = clean(process.env.META_ADS_OAUTH_STATE_SECRET || process.env.AUTH_SECRET || process.env.CSRF_SECRET);
  if (!value || value.startsWith('replace-with')) {
    throw new AppError('AUTH_SECRET must be configured for Facebook Login Ads OAuth state.', 503, 'SECURITY_NOT_CONFIGURED');
  }
  return value;
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createAdsOAuthState({
  businessId,
  userId,
  sessionVersion = 0,
  capabilities = ADS_DEFAULT_REQUESTED,
  redirectUri = '',
  ttlSeconds = 600
} = {}) {
  const body = Buffer.from(JSON.stringify({
    b: clean(businessId),
    u: clean(userId),
    sv: Number(sessionVersion) || 0,
    c: capabilities,
    r: digest(redirectUri).slice(0, 16),
    e: Math.floor(Date.now() / 1000) + Math.max(60, Number(ttlSeconds) || 600),
    n: crypto.randomBytes(16).toString('hex')
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', oauthStateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyAdsOAuthState(state) {
  const raw = clean(state);
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac('sha256', oauthStateSecret()).update(body).digest('base64url');
  if (!timingSafeEqualText(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.b || !payload?.u || !Number.isFinite(Number(payload.e))) return null;
    if (Number(payload.e) < Math.floor(Date.now() / 1000)) return null;
    return {
      businessId: clean(payload.b),
      userId: clean(payload.u),
      sessionVersion: Number(payload.sv) || 0,
      capabilities: Array.isArray(payload.c) ? payload.c : [...ADS_DEFAULT_REQUESTED],
      redirectFingerprint: clean(payload.r)
    };
  } catch {
    return null;
  }
}

export function oauthCompletionAllowed(attempt, session) {
  if (!attempt) return { ok: false, code: 'META_OAUTH_STATE' };
  const attemptUser = attempt.user_id || attempt.userId;
  const attemptBusiness = attempt.business_id || attempt.businessId;
  const attemptVersion = attempt.session_version ?? attempt.sessionVersion;
  const attemptLoginSession = attempt.login_session_id || attempt.loginSessionId || '';
  if (!session?.userId || session.userId !== attemptUser) return { ok: false, code: 'META_OAUTH_SESSION' };
  if (session.businessId !== attemptBusiness) return { ok: false, code: 'META_OAUTH_TENANT' };
  if (Number(session.sessionVersion || 0) !== Number(attemptVersion || 0)) return { ok: false, code: 'META_OAUTH_SESSION' };
  if (attemptLoginSession) {
    if (!session.loginSessionId || session.loginSessionId !== attemptLoginSession) {
      return { ok: false, code: 'META_OAUTH_SESSION' };
    }
  }
  return { ok: true };
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

async function graphCollect(token, path) {
  const rows = [];
  let next = path;
  let truncated = false;
  for (let page = 0; page < MAX_GRAPH_PAGES && next; page += 1) {
    const result = await graphGet(token, next);
    rows.push(...(result.data || []));
    const following = nextGraphPath(next, result.paging);
    if (!following) break;
    if (page === MAX_GRAPH_PAGES - 1) {
      truncated = true;
      break;
    }
    next = following;
  }
  return { rows, truncated };
}

export async function debugAdsToken(accessToken, requestedCapabilities = ADS_DEFAULT_REQUESTED) {
  const { appId, appSecret } = adsAppConfig();
  const payload = await graphGet(`${appId}|${appSecret}`, `debug_token?input_token=${encodeURIComponent(accessToken)}`);
  const data = payload.data || {};
  if (!data.is_valid || String(data.app_id) !== appId) {
    throw new AppError('Meta returned an invalid advertising token for this application.', 401, 'META_TOKEN_INVALID');
  }
  const report = permissionReportFromScopes(data.scopes || [], requestedCapabilities);
  const expiresAt = Number(data.expires_at || 0);
  if (expiresAt > 0 && expiresAt * 1000 <= Date.now()) {
    throw new AppError('The Meta advertising token is already expired. Start Facebook Login again.', 401, 'META_TOKEN_EXPIRED');
  }
  return {
    scopes: data.scopes || [],
    expiresAt: expiresAt > 0 ? new Date(expiresAt * 1000) : null,
    report,
    userId: data.user_id || null
  };
}

export async function subscribePageLeadgen(userToken, pageId) {
  if (!metaId(pageId)) throw new AppError('Invalid Facebook Page id.', 400, 'ADS_PAYLOAD_INVALID');
  const accounts = await graphCollect(userToken, 'me/accounts?fields=id,name,access_token&limit=100');
  const page = accounts.rows.find((row) => String(row.id) === String(pageId));
  if (!page?.access_token) {
    throw new AppError('This Facebook Page is not available with the granted token. Reauthorize with pages permissions.', 403, 'ADS_PAGE_TOKEN_MISSING');
  }
  await graphPost(page.access_token, `${pageId}/subscribed_apps`, { subscribed_fields: ['leadgen'] });
  return { pageId, leadgenSubscribed: true, pageName: page.name || '' };
}

export async function listAdsOAuthAssets(userToken) {
  const [adAccounts, pages] = await Promise.all([
    graphCollect(userToken, 'me/adaccounts?fields=id,account_id,name,account_status,currency&limit=50'),
    graphCollect(userToken, 'me/accounts?fields=id,name&limit=50')
  ]);
  return {
    adAccounts: adAccounts.rows
      .filter((row) => metaId(String(row.account_id || '').replace(/^act_/, '')) || metaId(String(row.id || '').replace(/^act_/, '')))
      .map((row) => ({
        id: String(row.account_id || String(row.id || '').replace(/^act_/, '')),
        name: row.name || '',
        currency: row.currency || '',
        accountStatus: row.account_status
      })),
    pages: pages.rows
      .filter((row) => metaId(row.id))
      .map((row) => ({ id: String(row.id), name: row.name || '' })),
    truncated: Boolean(adAccounts.truncated || pages.truncated)
  };
}

function mapAdsOAuthDbError(error) {
  if (error?.code === '42P01') {
    return new AppError('Ads OAuth tables are missing. Run npm run db:init on the production database.', 503, 'ADS_OAUTH_SCHEMA_MISSING');
  }
  if (error?.code === '42501') {
    return new AppError('Database denied the Ads OAuth write. Run npm run db:init so the app role can use ads OAuth tables.', 503, 'ADS_OAUTH_RLS_DENIED');
  }
  return error;
}

async function loadOwnerSessionForAdsOAuth(request) {
  const token = parseCookies(request)[SESSION_COOKIE_NAME];
  const session = verifySessionToken(token);
  if (!session?.businessId || !session?.userId) throw new AppError('Sign in required.', 401, 'AUTH_REQUIRED');

  return transaction(async (client) => {
    const run = (text, params = []) => client.query(text, params);
    await run("SELECT set_config('app.business_id',$1,true), set_config('app.system_access','false',true)", [session.businessId]);
    const membership = (
      await run(
        `SELECT m.role, b.account_status, u.session_version, u.email_verified_at, u.email_verification_required
         FROM memberships m
         JOIN businesses b ON b.id = m.business_id
         JOIN users u ON u.id = m.user_id
         WHERE m.user_id = $1 AND m.business_id = $2
         LIMIT 1`,
        [session.userId, session.businessId]
      )
    ).rows[0];
    if (!membership) throw new AppError('This workspace membership is no longer active.', 401, 'AUTH_REQUIRED');
    if (Number(session.sessionVersion || 0) !== Number(membership.session_version)) {
      throw new AppError('This session has expired. Sign in again.', 401, 'SESSION_REVOKED');
    }
    if ((membership.email_verification_required || process.env.EMAIL_VERIFICATION_REQUIRED === 'true') && !membership.email_verified_at) {
      throw new AppError('Verify your email before signing in.', 403, 'EMAIL_NOT_VERIFIED');
    }
    if (membership.account_status === 'suspended') {
      throw new AppError('This company workspace is suspended. Contact the platform administrator.', 403, 'ACCOUNT_SUSPENDED');
    }
    if (membership.role !== 'Owner') {
      throw new AppError('Only the owner can connect Meta advertising via Facebook Login.', 403, 'FORBIDDEN');
    }
    const flags = await workspaceFeatureFlags(session.businessId, run);
    if (!flags.ads) {
      throw new AppError('Click-to-WhatsApp ads is disabled by the platform administrator.', 403, 'FEATURE_DISABLED');
    }
    return {
      businessId: session.businessId,
      userId: session.userId,
      role: membership.role,
      sessionVersion: Number(membership.session_version) || 0,
      loginSessionId: session.loginSessionId || ''
    };
  });
}

function restartMessage(code) {
  const messages = {
    META_OAUTH_REPLAY: 'This Facebook Login attempt was already used. Start Continue with Facebook again.',
    META_OAUTH_SESSION: 'Finish Facebook Login in the same signed-in browser session that started it.',
    META_OAUTH_TENANT: 'This Facebook Login does not belong to the signed-in workspace.',
    META_OAUTH_ROLE: 'Only the workspace owner who started Facebook Login can finish it.',
    META_OAUTH_STATE: 'Ads OAuth state expired or is invalid. Start Facebook Login again.',
    ADS_OAUTH_PENDING_CONFLICT: 'Another owner already has a Facebook Login in progress for this workspace. Ask them to finish or wait for it to expire.'
  };
  return messages[code] || 'Start Facebook Login again.';
}

export async function claimAdsOAuthAttempt(client, stateHash) {
  const claimed = await client.query(
    `UPDATE ads_oauth_attempts
        SET status = 'claimed', claimed_at = NOW()
      WHERE state_hash = $1 AND status = 'pending' AND expires_at > NOW()
      RETURNING id, business_id, user_id, session_version, login_session_id, requested_capabilities, redirect_uri, expires_at, status`,
    [stateHash]
  );
  if (claimed.rows[0]) return { attempt: claimed.rows[0], code: '' };
  const existing = await client.query(
    'SELECT status, expires_at FROM ads_oauth_attempts WHERE state_hash = $1',
    [stateHash]
  );
  const row = existing.rows[0];
  if (!row) return { attempt: null, code: 'META_OAUTH_STATE' };
  if (row.status !== 'pending') return { attempt: null, code: 'META_OAUTH_REPLAY' };
  return { attempt: null, code: 'META_OAUTH_STATE' };
}

export async function startAdsOAuth(request) {
  const buildMarker = ADS_OAUTH_BUILD;
  let stage = 'init';
  try {
    stage = 'session';
    const session = await loadOwnerSessionForAdsOAuth(request);
    stage = 'config';
    const { appId } = adsAppConfig();
    const requested = parseRequestedCapabilities(new URL(request.url).searchParams.get('capabilities'));
    const scopes = scopesForCapabilities(requested);
    stage = 'state';
    const redirectUri = adsOAuthRedirectUri(request.url);
    if (process.env.NODE_ENV === 'production' && !redirectUri.startsWith('https://')) {
      throw new AppError('APP_URL must be HTTPS for Facebook Login. Set APP_URL to the public HTTPS origin.', 503, 'META_HTTPS_REQUIRED');
    }
    const loginSessionId = clean(session.loginSessionId);
    if (!loginSessionId) throw new AppError('Sign in again before connecting Facebook ads.', 401, 'META_OAUTH_SESSION');
    const state = createAdsOAuthState({
      businessId: session.businessId,
      userId: session.userId,
      sessionVersion: session.sessionVersion,
      capabilities: requested,
      redirectUri
    });
    stage = 'persist';
    enterTenantContext(session.businessId);
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO ads_oauth_attempts
          (id, state_hash, business_id, user_id, session_version, login_session_id, requested_capabilities, redirect_uri, status, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'pending',NOW()+INTERVAL '10 minutes')`,
        [id('aoa'), digest(state), session.businessId, session.userId, session.sessionVersion, loginSessionId, JSON.stringify(requested), redirectUri]
      );
    });
    stage = 'url';
    const url = new URL(`https://www.facebook.com/${metaGraphApiVersion()}/dialog/oauth`);
    url.search = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: scopes.join(',')
    }).toString();
    return json({
      url: url.toString(),
      redirectUri,
      scopes,
      requestedCapabilities: requested,
      stateMode: 'single_use',
      buildMarker
    });
  } catch (error) {
    const mapped = mapAdsOAuthDbError(error);
    const status = mapped?.status || 500;
    const code = mapped?.code || error?.code || 'SERVER_ERROR';
    const message = status === 500 ? 'Something went wrong.' : mapped.message;
    if (status >= 500) console.error('Ads OAuth start failed', { stage, code, message: error?.message, pg: error?.code });
    return json({ error: message, code, stage, buildMarker, pg: error?.code || null }, status === 500 ? 500 : status);
  }
}

async function failAttempt(businessId, stateHash) {
  enterTenantContext(businessId);
  await query(
    `UPDATE ads_oauth_attempts SET status = 'failed' WHERE state_hash = $1 AND status = 'claimed'`,
    [stateHash]
  ).catch(() => {});
}

export async function handleAdsOAuthCallback(request) {
  const appOrigin = new URL(process.env.APP_URL || request.url).origin;
  const fail = (message) => Response.redirect(`${appOrigin}/app/ads?adsOAuthError=${encodeURIComponent(String(message).slice(0, 200))}`, 302);
  try {
    const { appId, appSecret } = adsAppConfig();
    const params = new URL(request.url).searchParams;
    const code = clean(params.get('code'));
    const state = clean(params.get('state'));
    const oauthError = clean(params.get('error_description') || params.get('error'));
    if (oauthError) return fail(oauthError);
    if (!code || !state) throw new AppError('Meta OAuth callback is missing code or state.', 400, 'META_OAUTH_INVALID');
    const verified = verifyAdsOAuthState(state);
    if (!verified?.businessId || !verified?.userId) {
      enterSystemContext();
      const legacy = (
        await query(
          `DELETE FROM ads_oauth_states WHERE state_hash=$1 AND expires_at>NOW() RETURNING business_id, user_id`,
          [digest(state)]
        )
      ).rows[0];
      if (!legacy) throw new AppError(restartMessage('META_OAUTH_STATE'), 400, 'META_OAUTH_STATE');
      throw new AppError('This Facebook Login link used an older state format. Start Continue with Facebook again.', 400, 'META_OAUTH_RESTART');
    }
    const redirectUri = adsOAuthRedirectUri(request.url);
    if (verified.redirectFingerprint && verified.redirectFingerprint !== digest(redirectUri).slice(0, 16)) {
      throw new AppError('The Facebook Login callback URL does not match the one that started the attempt. Start again.', 400, 'META_OAUTH_REDIRECT');
    }
    const browser = verifySessionToken(parseCookies(request)[SESSION_COOKIE_NAME]);
    const stateHash = digest(state);
    enterTenantContext(verified.businessId);
    const claimed = await transaction(async (client) => {
      const result = await claimAdsOAuthAttempt(client, stateHash);
      if (!result.attempt) {
        throw new AppError(restartMessage(result.code), 400, result.code);
      }
      const allowed = oauthCompletionAllowed(result.attempt, browser);
      if (!allowed.ok) {
        await client.query(`UPDATE ads_oauth_attempts SET status = 'failed' WHERE id = $1`, [result.attempt.id]);
        throw new AppError(restartMessage(allowed.code), 403, allowed.code);
      }
      const membership = (await client.query(
        `SELECT role, u.session_version
           FROM memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.user_id = $1 AND m.business_id = $2`,
        [verified.userId, verified.businessId]
      )).rows[0];
      if (!membership || membership.role !== 'Owner' || Number(membership.session_version) !== Number(verified.sessionVersion)) {
        await client.query(`UPDATE ads_oauth_attempts SET status = 'failed' WHERE id = $1`, [result.attempt.id]);
        const reason = !membership ? 'META_OAUTH_ROLE' : membership.role !== 'Owner' ? 'META_OAUTH_ROLE' : 'META_OAUTH_SESSION';
        throw new AppError(restartMessage(reason), 403, reason);
      }
      return result.attempt;
    });
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
      await failAttempt(verified.businessId, stateHash);
      throw new AppError(exchange.error?.message || 'Meta authorization-code exchange failed. Start Facebook Login again.', 400, 'META_CODE_EXCHANGE_FAILED');
    }
    const requested = Array.isArray(claimed.requested_capabilities) ? claimed.requested_capabilities : verified.capabilities;
    const debug = await debugAdsToken(exchange.access_token, requested);
    if (!debug.report.capabilities?.ctwa?.enabled) {
      await failAttempt(verified.businessId, stateHash);
      throw new AppError(
        `Meta did not grant Click-to-WhatsApp permissions: ${debug.report.missing.join(', ') || 'ads_management'}. Start Facebook Login again and approve them.`,
        403,
        'META_SCOPE_MISSING'
      );
    }
    enterTenantContext(verified.businessId);
    try {
      const stored = await transaction(async (client) => {
        const pending = await client.query(
          `INSERT INTO ads_oauth_pending
            (business_id, user_id, access_token_encrypted, token_scopes, token_expires_at, permission_report, expires_at, session_version, login_session_id, requested_capabilities, attempt_id)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,NOW()+INTERVAL '30 minutes',$7,$8,$9::jsonb,$10)
           ON CONFLICT (business_id) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             access_token_encrypted = EXCLUDED.access_token_encrypted,
             token_scopes = EXCLUDED.token_scopes,
             token_expires_at = EXCLUDED.token_expires_at,
             permission_report = EXCLUDED.permission_report,
             expires_at = EXCLUDED.expires_at,
             session_version = EXCLUDED.session_version,
             login_session_id = EXCLUDED.login_session_id,
             requested_capabilities = EXCLUDED.requested_capabilities,
             attempt_id = EXCLUDED.attempt_id,
             updated_at = NOW()
           WHERE ads_oauth_pending.user_id = EXCLUDED.user_id OR ads_oauth_pending.expires_at <= NOW()
           RETURNING business_id`,
          [
            verified.businessId,
            verified.userId,
            encryptSecret(exchange.access_token),
            JSON.stringify(debug.scopes),
            debug.expiresAt,
            JSON.stringify(debug.report),
            verified.sessionVersion,
            claimed.login_session_id || browser?.loginSessionId || '',
            JSON.stringify(requested),
            claimed.id
          ]
        );
        if (!pending.rows[0]) {
          throw new AppError(restartMessage('ADS_OAUTH_PENDING_CONFLICT'), 409, 'ADS_OAUTH_PENDING_CONFLICT');
        }
        await client.query(
          `UPDATE ads_oauth_attempts SET status = 'consumed' WHERE id = $1`,
          [claimed.id]
        );
        await client.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)', [
          id('a'),
          verified.businessId,
          verified.userId,
          'whatsapp_ads_oauth_authorized',
          JSON.stringify({
            scopesComplete: debug.report.complete,
            missing: debug.report.missing,
            optionalUnavailable: debug.report.optionalUnavailable
          })
        ]);
        return true;
      });
      if (!stored) throw new AppError(restartMessage('META_OAUTH_STATE'), 400, 'META_OAUTH_STATE');
    } catch (error) {
      await failAttempt(verified.businessId, stateHash);
      throw mapAdsOAuthDbError(error);
    }
    return Response.redirect(
      `${appOrigin}/app/ads?adsOAuth=1&oauthBusinessId=${encodeURIComponent(verified.businessId)}`,
      302
    );
  } catch (error) {
    return fail(error?.message || 'OAuth failed');
  }
}

export async function getAdsOAuthPending(request) {
  try {
    const { requireSession } = await import('./auth.js');
    const session = await requireSession(request);
    if (session.role !== 'Owner') throw new AppError('Only the owner can finish ads OAuth.', 403, 'FORBIDDEN');
    const { assertWorkspaceFeature } = await import('./feature-controls.js');
    await assertWorkspaceFeature('ads', session.businessId);
    const connection = (
      await query(
        'SELECT ad_account_id, page_id, phone_number_id FROM whatsapp_ads_connections WHERE business_id=$1',
        [session.businessId]
      )
    ).rows[0];
    if (connection?.ad_account_id && connection?.page_id && connection?.phone_number_id) {
      return json({ pending: false, alreadyConnected: true });
    }
    enterSystemContext();
    const pending = (
      await query(
        `SELECT user_id, session_version, login_session_id, token_scopes, token_expires_at, permission_report, expires_at, requested_capabilities
         FROM ads_oauth_pending WHERE business_id=$1 AND expires_at>NOW()`,
        [session.businessId]
      )
    ).rows[0];
    if (!pending) {
      const diagnostic = (
        await query(
          `SELECT user_id, expires_at FROM ads_oauth_pending WHERE business_id=$1`,
          [session.businessId]
        )
      ).rows[0];
      if (!diagnostic) return json({ pending: false, reason: 'none' });
      if (diagnostic.expires_at && new Date(diagnostic.expires_at).getTime() <= Date.now()) {
        return json({ pending: false, reason: 'expired' });
      }
      if (diagnostic.user_id && diagnostic.user_id !== session.userId) {
        return json({
          pending: false,
          reason: 'other_owner',
          code: 'ADS_OAUTH_PENDING_CONFLICT',
          error: restartMessage('ADS_OAUTH_PENDING_CONFLICT')
        });
      }
      return json({ pending: false, reason: 'unavailable' });
    }
    enterTenantContext(session.businessId);
    const allowed = oauthCompletionAllowed(pending, session);
    if (!allowed.ok) {
      return json({ pending: false, code: allowed.code, error: restartMessage(allowed.code) }, 403);
    }
    const token = decryptSecret(
      (
        await query('SELECT access_token_encrypted FROM ads_oauth_pending WHERE business_id=$1 AND user_id=$2', [session.businessId, session.userId])
      ).rows[0].access_token_encrypted
    );
    const assets = await listAdsOAuthAssets(token);
    return json({
      pending: true,
      scopes: pending.token_scopes,
      permissionReport: pending.permission_report,
      requestedCapabilities: pending.requested_capabilities,
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
      `SELECT user_id, session_version, login_session_id, access_token_encrypted, token_scopes, token_expires_at, permission_report, requested_capabilities
       FROM ads_oauth_pending WHERE business_id=$1 AND expires_at>NOW()`,
      [session.businessId]
    )
  ).rows[0];
  if (!pending) throw new AppError('Facebook Login session expired. Start Continue with Facebook again.', 409, 'ADS_OAUTH_EXPIRED');
  const allowed = oauthCompletionAllowed(pending, session);
  if (!allowed.ok) throw new AppError(restartMessage(allowed.code), 403, allowed.code);
  const token = decryptSecret(pending.access_token_encrypted);
  const requested = Array.isArray(pending.requested_capabilities) && pending.requested_capabilities.length
    ? pending.requested_capabilities
    : [...ADS_DEFAULT_REQUESTED];
  const debug = await debugAdsToken(token, requested);
  if (!debug.report.capabilities?.ctwa?.enabled) {
    throw new AppError(
      `Meta did not grant Click-to-WhatsApp permissions: ${(debug.report.capabilities?.ctwa?.missing || debug.report.missing).join(', ')}. Start Facebook Login again and approve them.`,
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
  let leadgen = { leadgenSubscribed: false };
  const leadsRequested = requested.includes('leads') && debug.report.capabilities?.leads?.enabled;
  if (leadsRequested) {
    try {
      leadgen = await subscribePageLeadgen(token, body.pageId);
    } catch (error) {
      leadgen = {
        leadgenSubscribed: false,
        warning: error?.message || 'Lead subscription failed. The Click-to-WhatsApp connection was kept.'
      };
    }
  }
  const { appSecret } = adsAppConfig();
  if (!debug.userId) {
    throw new AppError('Meta did not identify the Facebook user for this advertising token. Start Facebook Login again.', 400, 'META_USER_MISSING');
  }
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO whatsapp_ads_connections (
         business_id, ad_account_id, page_id, phone_number_id, currency, access_token_encrypted,
         token_scopes, token_expires_at, leadgen_subscribed, permissions_checked_at, connection_method, last_permission_report, authorization_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,NOW(),'facebook_login',$10::jsonb,'active')
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
         authorization_status='active',
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
        Boolean(leadgen.leadgenSubscribed),
        JSON.stringify(debug.report)
      ]
    );
    await recordMetaAuthorization(client, {
      businessId: session.businessId,
      metaUserId: String(debug.userId),
      integration: 'ads',
      appSecret,
      assets: { adAccountId: body.adAccountId, pageId: body.pageId, phoneNumberId: body.phoneId }
    });
    await client.query('DELETE FROM ads_oauth_pending WHERE business_id=$1 AND user_id=$2', [session.businessId, session.userId]);
  });
  const starter = await import('./ad-credits.js')
    .then((mod) => mod.grantStarterAdCredits(session.businessId, { actorUserId: session.userId }))
    .catch(() => ({ granted: false }));
  await query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)', [
    id('a'),
    session.businessId,
    session.userId,
    'whatsapp_ads_oauth_connected',
    JSON.stringify({
      adAccountId: body.adAccountId,
      pageId: body.pageId,
      phoneId: body.phoneId,
      leadgen: Boolean(leadgen.leadgenSubscribed),
      leadWarning: leadgen.warning || '',
      starter
    })
  ]);
  return { ok: true, leadgenSubscribed: Boolean(leadgen.leadgenSubscribed), leadWarning: leadgen.warning || '', permissionReport: debug.report, starter };
}

export async function recheckAdsPermissions(businessId, token) {
  const debug = await debugAdsToken(token, ['ctwa', 'reporting', 'leads']);
  await query(
    `UPDATE whatsapp_ads_connections
     SET token_scopes=$2::jsonb, token_expires_at=$3, last_permission_report=$4::jsonb, permissions_checked_at=NOW(),
         authorization_status='active', updated_at=NOW()
     WHERE business_id=$1`,
    [businessId, JSON.stringify(debug.scopes), debug.expiresAt, JSON.stringify(debug.report)]
  );
  return debug.report;
}
