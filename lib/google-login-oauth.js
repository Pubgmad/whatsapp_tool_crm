import crypto from 'crypto';
import { AppError, enterSystemContext, id, query, transaction } from './db.js';
import { createSessionToken, normalizeEmail, sessionCookie, slugify } from './auth.js';
import { encryptSecret, decryptSecret } from './meta.js';
import { secureCookieAttribute } from './security.js';

const PROVIDER = 'google';
const OAUTH_ONLY_PASSWORD = 'oauth:google:unusable';
export const OAUTH_PASSWORD_SENTINEL = OAUTH_ONLY_PASSWORD;
const MFA_PENDING_TTL_SECONDS = 300;
const STATE_SECRET = () => String(process.env.AUTH_SECRET || process.env.CSRF_SECRET || '').trim();

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** HMAC-signed OAuth metadata (unit-tested); PKCE + DB state_hash handle the live OAuth flow. */
export function createGoogleLoginState({ mode = 'signin', ttlSeconds = 600 } = {}) {
  const normalizedMode = mode === 'signup' ? 'signup' : 'signin';
  const secret = STATE_SECRET();
  if (!secret || secret.startsWith('replace-with')) {
    throw new AppError('AUTH_SECRET must be configured for Google sign-in.', 503, 'SECURITY_NOT_CONFIGURED');
  }
  const body = Buffer.from(JSON.stringify({
    m: normalizedMode,
    e: Math.floor(Date.now() / 1000) + Math.max(60, Number(ttlSeconds) || 600),
    n: crypto.randomBytes(16).toString('hex')
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyGoogleLoginState(state) {
  const raw = String(state || '').trim();
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const secret = STATE_SECRET();
  if (!secret) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!timingSafeEqualText(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const mode = payload?.m === 'signup' ? 'signup' : payload?.m === 'signin' ? 'signin' : null;
    if (!mode || !Number.isFinite(Number(payload.e))) return null;
    if (Number(payload.e) < Math.floor(Date.now() / 1000)) return null;
    return { mode, nonce: String(payload.n || '') };
  } catch {
    return null;
  }
}

export function digestOAuthState(state) {
  return digest(state);
}

export function googleLoginConfigured() {
  return Boolean(
    process.env.GOOGLE_LOGIN_CLIENT_ID?.trim()
    && process.env.GOOGLE_LOGIN_CLIENT_SECRET?.trim()
    && process.env.APP_URL?.trim()
  );
}

export function googleLoginRedirectUri() {
  const base = String(process.env.APP_URL || '').replace(/\/$/, '');
  return `${base}/api/auth/google/callback`;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function safeGoogleNextPath(input) {
  const path = String(input || '/app/dashboard').trim() || '/app/dashboard';
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/app/dashboard';
  if (path.startsWith('/super-admin') || path.startsWith('/api/')) return '/app/dashboard';
  return path.slice(0, 240);
}

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export async function startGoogleLogin({ mode = 'signin', nextPath = '/app/dashboard' } = {}) {
  if (!googleLoginConfigured()) {
    throw new AppError('Continue with Google is not configured.', 503, 'GOOGLE_LOGIN_NOT_CONFIGURED');
  }
  const normalizedMode = mode === 'signup' ? 'signup' : 'signin';
  const state = crypto.randomBytes(24).toString('hex');
  const { verifier, challenge } = pkcePair();
  enterSystemContext();
  await query(`DELETE FROM oauth_login_states WHERE expires_at < NOW()`);
  await query(
    `INSERT INTO oauth_login_states(state_hash, mode, next_path, code_verifier_encrypted, expires_at)
     VALUES ($1,$2,$3,$4,NOW() + INTERVAL '10 minutes')`,
    [digest(state), normalizedMode, safeGoogleNextPath(nextPath), encryptSecret(verifier)]
  );
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_LOGIN_CLIENT_ID.trim());
  url.searchParams.set('redirect_uri', googleLoginRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');
  return { url: url.toString() };
}

async function exchangeCode(code, verifier) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_LOGIN_CLIENT_ID.trim(),
    client_secret: process.env.GOOGLE_LOGIN_CLIENT_SECRET.trim(),
    redirect_uri: googleLoginRedirectUri(),
    grant_type: 'authorization_code',
    code_verifier: verifier
  });
  let response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(12000)
    });
  } catch {
    throw new AppError('Google authorization is temporarily unreachable.', 503, 'GOOGLE_LOGIN_UNREACHABLE');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new AppError('Google authorization failed. Try again.', 401, 'GOOGLE_LOGIN_FAILED');
  }
  return payload;
}

async function fetchGoogleProfile(accessToken) {
  let response;
  try {
    response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(12000)
    });
  } catch {
    throw new AppError('Google profile lookup is temporarily unreachable.', 503, 'GOOGLE_LOGIN_UNREACHABLE');
  }
  const profile = await response.json().catch(() => ({}));
  if (!response.ok || !profile.sub) {
    throw new AppError('Could not read the Google profile.', 401, 'GOOGLE_LOGIN_FAILED');
  }
  return profile;
}

async function upsertIdentity(client, userId, providerUserId, email) {
  await client.query(
    `INSERT INTO oauth_identities (id, provider, provider_user_id, user_id, email)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (provider, provider_user_id) DO UPDATE
       SET user_id = EXCLUDED.user_id, email = EXCLUDED.email, updated_at = NOW()`,
    [id('oi'), PROVIDER, providerUserId, userId, email]
  );
}

async function createWorkspace(client, { name, email }) {
  const userId = id('u');
  const businessId = id('b');
  const membershipId = id('mb');
  const businessName = `${name}'s workspace`.slice(0, 120);
  const slug = `${slugify(businessName)}-${crypto.randomBytes(2).toString('hex')}`;
  await client.query("SELECT set_config('app.business_id',$1,true),set_config('app.system_access','false',true)", [businessId]);
  await client.query(
    `INSERT INTO users (id, name, email, password_hash, email_verified_at, email_verification_required)
     VALUES ($1,$2,$3,$4,NOW(),FALSE)`,
    [userId, name, email, OAUTH_ONLY_PASSWORD]
  );
  await client.query(
    `INSERT INTO businesses (id, name, slug, webhook_url, mode, status, account_status)
     VALUES ($1,$2,$3,$4,'Live Meta','Needs setup','pending')`,
    [businessId, businessName, slug, process.env.WEBHOOK_URL || `${process.env.APP_URL || 'http://localhost:3000'}/api/webhooks/meta`]
  );
  await client.query("INSERT INTO memberships (id, user_id, business_id, role) VALUES ($1,$2,$3,'Owner')", [membershipId, userId, businessId]);
  const defaultPlanCode = String(process.env.DEFAULT_SUBSCRIPTION_PLAN_CODE || '').trim().toLowerCase();
  const plan = defaultPlanCode
    ? await client.query('SELECT id, trial_days FROM subscription_plans WHERE code = $1 AND is_active = TRUE AND visible = TRUE LIMIT 1', [defaultPlanCode])
    : { rows: [] };
  await client.query(
    `INSERT INTO business_subscriptions (id, business_id, plan_id, status, payment_status, starts_at, trial_ends_at, current_period_start, current_period_end, renews_at)
     VALUES ($1,$2,$3,$4,'none',NOW(),$5,NOW(),NOW() + INTERVAL '1 month',NOW() + INTERVAL '1 month')`,
    [
      id('sub'),
      businessId,
      plan.rows[0]?.id || null,
      plan.rows[0] ? 'trialing' : 'pending',
      plan.rows[0] ? new Date(Date.now() + Number(plan.rows[0].trial_days || 0) * 24 * 60 * 60 * 1000) : null
    ]
  );
  await client.query("INSERT INTO audit_logs (id, business_id, user_id, action) VALUES ($1,$2,$3,'account_registered_google')", [id('a'), businessId, userId]);
  return { userId, businessId, role: 'Owner', sessionVersion: 0 };
}

export async function completeGoogleLogin({ code, state }) {
  if (!googleLoginConfigured()) {
    throw new AppError('Continue with Google is not configured.', 503, 'GOOGLE_LOGIN_NOT_CONFIGURED');
  }
  if (!code || !state || !/^[a-f0-9]{32,128}$/.test(String(state))) {
    throw new AppError('Google sign-in was cancelled or incomplete.', 400, 'GOOGLE_LOGIN_INVALID');
  }
  enterSystemContext();
  const used = await query(
    `DELETE FROM oauth_login_states
      WHERE state_hash = $1 AND expires_at > NOW()
      RETURNING mode, next_path, code_verifier_encrypted`,
    [digest(state)]
  );
  const row = used.rows[0];
  if (!row) throw new AppError('Google sign-in expired. Try again.', 401, 'GOOGLE_LOGIN_EXPIRED');
  const verifier = decryptSecret(row.code_verifier_encrypted);
  const tokenPayload = await exchangeCode(code, verifier);
  const profile = await fetchGoogleProfile(tokenPayload.access_token);
  const email = normalizeEmail(profile.email);
  const emailVerified = profile.email_verified === true || profile.email_verified === 'true';
  const name = String(profile.name || profile.given_name || email.split('@')[0] || 'Workspace owner').trim().slice(0, 120);
  if (!email || !emailVerified) {
    throw new AppError('Google did not provide a verified email address.', 403, 'GOOGLE_EMAIL_UNVERIFIED');
  }

  return transaction(async (client) => {
    await client.query("SELECT set_config('app.system_access','true',true), set_config('app.business_id','',true)");
    const byIdentity = await client.query(
      'SELECT user_id FROM oauth_identities WHERE provider = $1 AND provider_user_id = $2 LIMIT 1',
      [PROVIDER, String(profile.sub)]
    );
    let userId = byIdentity.rows[0]?.user_id || null;
    if (!userId) {
      const existing = await client.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
      if (existing.rows[0]) {
        userId = existing.rows[0].id;
        await client.query(
          `UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()), email_verification_required = FALSE WHERE id = $1`,
          [userId]
        );
        await upsertIdentity(client, userId, String(profile.sub), email);
      } else if (row.mode === 'signin') {
        throw new AppError('No workspace matches this Google account. Create a workspace first.', 404, 'GOOGLE_ACCOUNT_NOT_FOUND');
      } else {
        const created = await createWorkspace(client, { name, email });
        await upsertIdentity(client, created.userId, String(profile.sub), email);
        return {
          kind: 'session',
          nextPath: safeGoogleNextPath(row.next_path),
          cookie: sessionCookie(createSessionToken(created))
        };
      }
    } else {
      await upsertIdentity(client, userId, String(profile.sub), email);
    }

    const membership = await client.query(
      `SELECT m.business_id, m.role, b.account_status, u.session_version, u.mfa_enabled, u.email
         FROM memberships m
         JOIN businesses b ON b.id = m.business_id
         JOIN users u ON u.id = m.user_id
        WHERE m.user_id = $1
        ORDER BY CASE WHEN b.account_status = 'suspended' THEN 1 ELSE 0 END, m.created_at ASC
        LIMIT 1`,
      [userId]
    );
    const member = membership.rows[0];
    if (!member) throw new AppError('No business workspace is linked to this account.', 403, 'NO_WORKSPACE');
    if (member.account_status === 'suspended') throw new AppError('This company workspace is suspended.', 403, 'ACCOUNT_SUSPENDED');
    if (member.mfa_enabled) {
      const pendingToken = crypto.randomBytes(24).toString('hex');
      await client.query(`DELETE FROM oauth_mfa_pending WHERE expires_at < NOW()`);
      await client.query(
        `INSERT INTO oauth_mfa_pending (token_hash, user_id, business_id, role, session_version, expires_at)
         VALUES ($1,$2,$3,$4,$5,NOW() + INTERVAL '5 minutes')`,
        [digest(pendingToken), userId, member.business_id, member.role, Number(member.session_version || 0)]
      );
      return {
        kind: 'mfa',
        nextPath: `/login?mfa_required=1&email=${encodeURIComponent(member.email)}`,
        pendingCookie: googleMfaPendingCookie(pendingToken)
      };
    }
    return {
      kind: 'session',
      nextPath: safeGoogleNextPath(row.next_path),
      cookie: sessionCookie(createSessionToken({
        userId,
        businessId: member.business_id,
        role: member.role,
        sessionVersion: member.session_version
      }))
    };
  });
}

export async function completeGoogleMfa({ pendingToken, mfaCode }) {
  if (!pendingToken || !mfaCode) throw new AppError('Enter your authenticator or recovery code.', 401, 'MFA_REQUIRED');
  enterSystemContext();
  const pending = await query(
    `DELETE FROM oauth_mfa_pending WHERE token_hash = $1 AND expires_at > NOW()
     RETURNING user_id, business_id, role, session_version`,
    [digest(pendingToken)]
  );
  const row = pending.rows[0];
  if (!row) throw new AppError('Google sign-in expired. Try again.', 401, 'GOOGLE_LOGIN_EXPIRED');
  const user = await query(
    'SELECT id, mfa_enabled, mfa_secret_encrypted, mfa_recovery_codes FROM users WHERE id = $1',
    [row.user_id]
  );
  const account = user.rows[0];
  if (account?.mfa_enabled) {
    const { verifyMfaForUser } = await import('./account-security.js');
    if (!await verifyMfaForUser(account, mfaCode, account.id)) {
      throw new AppError('The authentication code is invalid.', 401, 'MFA_INVALID');
    }
  }
  return sessionCookie(createSessionToken({
    userId: row.user_id,
    businessId: row.business_id,
    role: row.role,
    sessionVersion: row.session_version
  }));
}

export function googleMfaPendingCookie(token) {
  return `wcrm_google_mfa=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MFA_PENDING_TTL_SECONDS}${secureCookieAttribute()}`;
}

export function clearGoogleMfaPendingCookie() {
  return `wcrm_google_mfa=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookieAttribute()}`;
}
