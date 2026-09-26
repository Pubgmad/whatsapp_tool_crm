import crypto from 'crypto';
import { isIP } from 'node:net';
import { AppError, id, transaction } from './db.js';

export const CSRF_COOKIE_NAME = 'wcrm_csrf';
const clean = (value) => String(value || '').trim();
const csrfSeconds = 7200;

export function secureCookieAttribute() {
  const configured = clean(process.env.APP_URL);
  if (!configured) return process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const url = new URL(configured);
  if (url.protocol === 'https:') return '; Secure';
  if (process.env.NODE_ENV === 'production' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new AppError('APP_URL must use HTTPS in production.', 503, 'APP_URL_HTTPS_REQUIRED');
  }
  return '';
}

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
  return `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=Strict; Max-Age=${csrfSeconds}${secureCookieAttribute()}`;
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

export async function readBodyLimited(request, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new AppError('Invalid request size limit.', 500, 'INVALID_BODY_LIMIT');
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new AppError('Upload is too large.', 413, 'UPLOAD_TOO_LARGE');
  if (!request.body) throw new AppError('Request body is required.', 400, 'BODY_REQUIRED');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new AppError('Upload is too large.', 413, 'UPLOAD_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function readTextBodyLimited(request, maxBytes) {
  return (await readBodyLimited(request, maxBytes)).toString('utf8');
}

export async function readJsonBodyLimited(request, maxBytes) {
  const text = await readTextBodyLimited(request, maxBytes);
  return parseJsonObject(text);
}

export async function readOptionalJsonBodyLimited(request, maxBytes) {
  if (!request.body) return {};
  const text = await readTextBodyLimited(request, maxBytes);
  if (!text.trim()) return {};
  return parseJsonObject(text);
}

function parseJsonObject(text) {
  let body;
  try { body = JSON.parse(text); }
  catch { throw new AppError('Upload contains invalid JSON.', 400, 'INVALID_JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('JSON body must be an object.', 400, 'INVALID_JSON');
  }
  return body;
}

export async function readMultipartFormLimited(request, maxBytes) {
  const contentType = String(request.headers.get('content-type') || '');
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) {
    throw new AppError('A multipart form is required.', 415, 'MULTIPART_REQUIRED');
  }
  const body = await readBodyLimited(request, maxBytes);
  try {
    return await new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body
    }).formData();
  } catch {
    throw new AppError('Upload form is invalid.', 400, 'INVALID_MULTIPART');
  }
}

export function requestIp(request) {
  const realIp = clean(request.headers.get('x-real-ip'));
  if (isIP(realIp)) return realIp;
  const forwarded = clean(request.headers.get('x-forwarded-for')).split(',').at(-1)?.trim();
  return isIP(forwarded) ? forwarded : 'unknown';
}

export async function enforceRequestRateLimit(request, identity = 'anonymous', profile = 'api') {
  const profiles = { login: [Number(process.env.LOGIN_RATE_LIMIT) || 10, 900], password: [Number(process.env.PASSWORD_RATE_LIMIT) || 5, 3600], api: [Number(process.env.API_RATE_LIMIT) || 300, 60] };
  const [limit, seconds] = profiles[profile] || profiles.api;
  const path = new URL(request.url).pathname;
  const ip = requestIp(request);
  const normalizedIdentity = String(identity || 'anonymous').trim().toLowerCase();
  const buckets = profile === 'api' && normalizedIdentity === 'csrf'
    ? [`${profile}:ip:${ip}:${path}`]
    : [`${profile}:identity:${normalizedIdentity}:${path}`, ...(ip === 'unknown' ? [] : [`${profile}:ip:${ip}:${path}`])];
  for (const raw of buckets) {
    const key = crypto.createHash('sha256').update(raw).digest('hex');
    const result = await transaction(async (client) => {
      return (await client.query(
        `INSERT INTO rate_limits (id,bucket_key,hits,reset_at) VALUES ($1,$2,1,$3)
         ON CONFLICT (bucket_key) DO UPDATE SET
           hits=CASE WHEN rate_limits.reset_at <= NOW() THEN 1 ELSE rate_limits.hits+1 END,
           reset_at=CASE WHEN rate_limits.reset_at <= NOW() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END,
           updated_at=NOW()
         RETURNING hits,reset_at`,
        [id('rl'), key, new Date(Date.now() + seconds * 1000)]
      )).rows[0];
    });
    if (Number(result.hits) > limit) {
      const error = new AppError('Too many requests. Please wait and try again.', 429, 'RATE_LIMITED');
      error.retryAfter = Math.max(1, Math.ceil((new Date(result.reset_at).getTime() - Date.now()) / 1000));
      throw error;
    }
  }
}
