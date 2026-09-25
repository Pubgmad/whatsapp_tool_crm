import crypto from 'crypto';
import { AppError, id, query, transaction } from './db.js';
import { decryptSecret, encryptSecret } from './meta.js';
import { hashPassword, normalizeEmail, verifyPassword } from './auth.js';

const clean = (value) => String(value || '').trim();
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

async function createToken(client, userId, type, hours) {
  const raw = crypto.randomBytes(32).toString('base64url');
  await client.query('UPDATE auth_tokens SET used_at=NOW() WHERE user_id=$1 AND token_type=$2 AND used_at IS NULL', [userId, type]);
  await client.query('INSERT INTO auth_tokens (id,user_id,token_type,token_hash,expires_at) VALUES ($1,$2,$3,$4,NOW()+($5 || \' hours\')::interval)', [id('at'), userId, type, hash(raw), String(hours)]);
  return raw;
}

async function sendEmail({ to, subject, html }) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  const from = clean(process.env.EMAIL_FROM);
  if (!apiKey || !from) {
    if (process.env.NODE_ENV === 'production') throw new AppError('Production email delivery is not configured.', 503, 'EMAIL_NOT_CONFIGURED');
    return false;
  }
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, html }) });
  if (!response.ok) throw new AppError('Security email could not be delivered.', 503, 'EMAIL_DELIVERY_FAILED');
  return true;
}

function link(path, token) {
  const base = clean(process.env.APP_URL);
  if (!base) throw new AppError('APP_URL is required for security emails.', 503, 'APP_URL_REQUIRED');
  return `${base.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;
}

export async function issueVerification(userId) {
  const user = (await query('SELECT id,name,email,email_verified_at FROM users WHERE id=$1', [userId])).rows[0];
  if (!user || user.email_verified_at) return { sent: false };
  const token = await transaction((client) => createToken(client, user.id, 'email_verification', 24));
  const url = link('/verify-email', token);
  const sent = await sendEmail({ to: user.email, subject: 'Verify your email', html: `<p>Hello ${escapeHtml(user.name)},</p><p>Verify your account using the secure link below.</p><p><a href='${url}'>Verify email</a></p><p>This link expires in 24 hours.</p>` });
  return { sent, developmentUrl: process.env.NODE_ENV === 'production' ? '' : url };
}

export async function requestVerification(email) {
  const user = (await query('SELECT id FROM users WHERE email=$1', [normalizeEmail(email)])).rows[0];
  if (user) await issueVerification(user.id);
  return { ok: true };
}

export async function verifyEmail(rawToken) {
  return transaction(async (client) => {
    const token = (await client.query('SELECT * FROM auth_tokens WHERE token_hash=$1 AND token_type=\'email_verification\' AND used_at IS NULL AND expires_at>NOW() FOR UPDATE', [hash(rawToken)])).rows[0];
    if (!token) throw new AppError('Verification link is invalid or expired.', 400, 'TOKEN_INVALID');
    await client.query('UPDATE users SET email_verified_at=NOW(),updated_at=NOW() WHERE id=$1', [token.user_id]);
    await client.query('UPDATE auth_tokens SET used_at=NOW() WHERE id=$1', [token.id]);
    return { ok: true };
  });
}

const escapeHtml = (value) => String(value || '').replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);

export async function requestPasswordReset(email) {
  const user = (await query('SELECT id,name,email FROM users WHERE email=$1', [normalizeEmail(email)])).rows[0];
  if (!user) return { ok: true };
  const token = await transaction((client) => createToken(client, user.id, 'password_reset', 1));
  const url = link('/reset-password', token);
  const sent = await sendEmail({ to: user.email, subject: 'Reset your password', html: `<p>Hello ${escapeHtml(user.name)},</p><p>A password reset was requested for your account.</p><p><a href='${url}'>Reset password</a></p><p>This link expires in one hour. Ignore this email if you did not request it.</p>` });
  return { ok: true, sent, developmentUrl: process.env.NODE_ENV === 'production' ? '' : url };
}

export async function resetPassword(rawToken, password) {
  if (String(password || '').length < 12) throw new AppError('Password must be at least 12 characters.', 400, 'VALIDATION_ERROR');
  return transaction(async (client) => {
    const token = (await client.query('SELECT * FROM auth_tokens WHERE token_hash=$1 AND token_type=\'password_reset\' AND used_at IS NULL AND expires_at>NOW() FOR UPDATE', [hash(rawToken)])).rows[0];
    if (!token) throw new AppError('Password reset link is invalid or expired.', 400, 'TOKEN_INVALID');
    await client.query('UPDATE users SET password_hash=$1,session_version=session_version+1,updated_at=NOW() WHERE id=$2', [hashPassword(password), token.user_id]);
    await client.query('UPDATE auth_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL', [token.user_id]);
    return { ok: true };
  });
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  return bits.match(/.{1,5}/g).map((part) => alphabet[parseInt(part.padEnd(5, '0'), 2)]).join('');
}

function base32Decode(value) {
  const bits = clean(value).replace(/=+$/g, '').toUpperCase().split('').map((item) => alphabet.indexOf(item).toString(2).padStart(5, '0')).join('');
  return Buffer.from((bits.match(/.{8}/g) || []).map((item) => parseInt(item, 2)));
}

function totp(secret, step = Math.floor(Date.now() / 30000)) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

export function verifyTotp(secret, code) {
  const value = clean(code);
  return /^\d{6}$/.test(value) && [-1, 0, 1].some((offset) => equal(totp(secret, Math.floor(Date.now() / 30000) + offset), value));
}

export async function beginMfa(userId) {
  const user = (await query('SELECT email,mfa_enabled FROM users WHERE id=$1', [userId])).rows[0];
  if (!user) throw new AppError('Account not found.', 404, 'ACCOUNT_NOT_FOUND');
  if (user.mfa_enabled) throw new AppError('MFA is already enabled.', 409, 'MFA_ALREADY_ENABLED');
  const secret = base32Encode(crypto.randomBytes(20));
  await query('UPDATE users SET mfa_secret_encrypted=$1,updated_at=NOW() WHERE id=$2', [encryptSecret(secret), userId]);
  const issuer = encodeURIComponent(clean(process.env.MFA_ISSUER) || 'WhatsApp CRM');
  return { secret, otpauthUrl: `otpauth://totp/${issuer}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` };
}

function recoveryCodes() {
  return Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').toUpperCase());
}

export async function enableMfa(userId, code) {
  const user = (await query('SELECT mfa_secret_encrypted,mfa_enabled FROM users WHERE id=$1', [userId])).rows[0];
  if (!user?.mfa_secret_encrypted || user.mfa_enabled) throw new AppError('Start MFA setup first.', 409, 'MFA_SETUP_REQUIRED');
  const secret = decryptSecret(user.mfa_secret_encrypted);
  if (!verifyTotp(secret, code)) throw new AppError('The authentication code is invalid.', 400, 'MFA_INVALID');
  const codes = recoveryCodes();
  await query('UPDATE users SET mfa_enabled=TRUE,mfa_recovery_codes=$1,updated_at=NOW() WHERE id=$2', [JSON.stringify(codes.map(hash)), userId]);
  return { enabled: true, recoveryCodes: codes };
}

export async function disableMfa(userId, password, code) {
  const user = (await query('SELECT password_hash,mfa_secret_encrypted,mfa_recovery_codes FROM users WHERE id=$1', [userId])).rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) throw new AppError('Password is incorrect.', 401, 'INVALID_CREDENTIALS');
  if (!await verifyMfaForUser(user, code, userId)) throw new AppError('The authentication code is invalid.', 401, 'MFA_INVALID');
  await query('UPDATE users SET mfa_enabled=FALSE,mfa_secret_encrypted=\'\',mfa_recovery_codes=\'[]\'::jsonb,updated_at=NOW() WHERE id=$1', [userId]);
  return { enabled: false };
}

export async function verifyMfaForUser(user, code, userId = user.id) {
  if (!user?.mfa_secret_encrypted) return false;
  if (verifyTotp(decryptSecret(user.mfa_secret_encrypted), code)) return true;
  const codeHash = hash(clean(code).replace(/\s+/g, '').toUpperCase());
  const recovery = Array.isArray(user.mfa_recovery_codes) ? user.mfa_recovery_codes : [];
  if (!recovery.includes(codeHash)) return false;
  await query('UPDATE users SET mfa_recovery_codes=$1,updated_at=NOW() WHERE id=$2', [JSON.stringify(recovery.filter((item) => item !== codeHash)), userId]);
  return true;
}

export async function mfaStatus(userId) {
  const user = (await query('SELECT mfa_enabled FROM users WHERE id=$1', [userId])).rows[0];
  return { enabled: Boolean(user?.mfa_enabled) };
}
