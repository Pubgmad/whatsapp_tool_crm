import crypto from 'crypto';
import { AppError, id, transaction } from './db.js';

export const CSRF_COOKIE_NAME = 'wcrm_csrf';
const clean = (value) => String(value || '').trim();
const csrfSeconds = 7200;

function secret() {
  const value = clean(process.env.CSRF_SECRET || process.env.AUTH_SECRET);
  if (!value || value.startsWith('replace-with')) throw new AppError('CSRF_SECRET or AUTH_SECRET must be configured.', 503, 'SECURITY_NOT_CONFIGURED');
  return value;
}

const sign = (value) => crypto.createHmac('sha256', secret()).update(value).digest('base64url');
function equal(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createCsrfToken() {
  const payload = `${Math.floor(Date.now() / 1000)}.${crypto.randomBytes(24).toString('base64url')}`;
  return `${payload}.${sign(payload)}`;
}

export function csrfCookie(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=Strict; Max-Age=${csrfSeconds}${secure}`;
}

function cookies(request) {
  return Object.fromEntries(String(request.headers.get('cookie') || '').split(';').map((item) => item.trim()).filter(Boolean).map((item) => {
    const at = item.indexOf('=');
    return [item.slice(0, at), decodeURIComponent(item.slice(at + 1))];
  }));
}

export function assertRequestOrigin(request) {
  const origin = clean(request.headers.get('origin'));
  if (!origin) throw new AppError('Request origin is required.', 403, 'INVALID_ORIGIN');
  const allowed = new Set([new URL(request.url).origin]);
  if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).origin);
  clean(process.env.ALLOWED_ORIGINS).split(',').filter(Boolean).forEach((item) => allowed.add(new URL(item).origin));
  if (!allowed.has(new URL(origin).origin)) throw new AppError('Invalid request origin.', 403, 'INVALID_ORIGIN');
}

export function assertCsrf(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  assertRequestOrigin(request);
  const token = clean(request.headers.get('x-csrf-token'));
  const [time, nonce, signature, extra] = token.split('.');
  const age = Math.floor(Date.now() / 1000) - Number(time);
  if (extra || !token || !equal(token, cookies(request)[CSRF_COOKIE_NAME]) || !/^\d+$/.test(time) || !nonce || age < 0 || age > csrfSeconds || !equal(signature, sign(`${time}.${nonce}`))) {
    throw new AppError('Security token is missing or expired. Refresh and try again.', 403, 'CSRF_INVALID');
  }
}

export const requestIp = (request) => clean(request.headers.get('x-forwarded-for')).split(',')[0]?.trim() || clean(request.headers.get('x-real-ip')) || 'unknown';

export async function enforceRequestRateLimit(request, identity = 'anonymous', profile = 'api') {
  const profiles = { login: [Number(process.env.LOGIN_RATE_LIMIT) || 10, 900], password: [Number(process.env.PASSWORD_RATE_LIMIT) || 5, 3600], api: [Number(process.env.API_RATE_LIMIT) || 300, 60] };
  const [limit, seconds] = profiles[profile] || profiles.api;
  const raw = `${profile}:${requestIp(request)}:${identity}:${new URL(request.url).pathname}`;
  const key = crypto.createHash('sha256').update(raw).digest('hex');
  const result = await transaction(async (client) => {
    const row = (await client.query('SELECT * FROM rate_limits WHERE bucket_key=$1 FOR UPDATE', [key])).rows[0];
    if (!row || new Date(row.reset_at) <= new Date()) {
      const resetAt = new Date(Date.now() + seconds * 1000);
      await client.query('INSERT INTO rate_limits (id,bucket_key,hits,reset_at) VALUES ($1,$2,1,$3) ON CONFLICT (bucket_key) DO UPDATE SET hits=1,reset_at=EXCLUDED.reset_at,updated_at=NOW()', [id('rl'), key, resetAt]);
      return { hits: 1, resetAt };
    }
    return (await client.query('UPDATE rate_limits SET hits=hits+1,updated_at=NOW() WHERE bucket_key=$1 RETURNING hits,reset_at', [key])).rows[0];
  });
  if (Number(result.hits) > limit) {
    const error = new AppError('Too many requests. Please wait and try again.', 429, 'RATE_LIMITED');
    error.retryAfter = Math.max(1, Math.ceil((new Date(result.reset_at || result.resetAt).getTime() - Date.now()) / 1000));
    throw error;
  }
}
