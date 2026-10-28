import { query } from './db.js';
import { encryptSecret, decryptSecret } from './meta.js';

const TURN_SETTING_KEY = 'whatsapp_calling_turn';
const URL_RE = /^turns?:[a-z0-9.-]+(?::\d+)?(?:\?transport=(?:udp|tcp))?$/i;

function splitUrls(raw) {
  if (Array.isArray(raw)) return raw.map((item) => String(item || '').trim()).filter(Boolean);
  return String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function validateTurnUrls(urls) {
  const list = splitUrls(urls);
  return list.length > 0 && list.every((url) => URL_RE.test(url));
}

export function normalizeCallingTurnSetting(value = {}) {
  const urls = splitUrls(value.urls ?? value.turnUrls ?? '');
  const secretPlain = String(value.secret ?? value.turnSecret ?? '').trim();
  const secretEncrypted = String(value.secretEncrypted ?? '').trim();
  return { urls, secretPlain, secretEncrypted };
}

export async function loadCallingTurnConfig(run = query) {
  const envUrls = splitUrls(process.env.WHATSAPP_CALL_TURN_URLS);
  const envSecret = String(process.env.WHATSAPP_CALL_TURN_SECRET || '').trim();
  if (validateTurnUrls(envUrls) && envSecret) {
    return { urls: envUrls, secret: envSecret, source: 'env' };
  }

  try {
    const row = (await run('SELECT value FROM platform_settings WHERE key=$1', [TURN_SETTING_KEY])).rows[0];
    const normalized = normalizeCallingTurnSetting(row?.value || {});
    let secret = '';
    if (normalized.secretEncrypted) {
      try {
        secret = decryptSecret(normalized.secretEncrypted);
      } catch {
        secret = '';
      }
    }
    if (!secret && normalized.secretPlain) secret = normalized.secretPlain;
    if (validateTurnUrls(normalized.urls) && secret) {
      return { urls: normalized.urls, secret, source: 'platform_settings' };
    }
  } catch {
    // Platform settings may be unavailable during early boot / tests.
  }

  return { urls: [], secret: '', source: 'none' };
}

export function callingTurnConfiguredSync() {
  const envUrls = splitUrls(process.env.WHATSAPP_CALL_TURN_URLS);
  const envSecret = String(process.env.WHATSAPP_CALL_TURN_SECRET || '').trim();
  return Boolean(validateTurnUrls(envUrls) && envSecret);
}

export async function callingTurnConfigured(run = query) {
  const config = await loadCallingTurnConfig(run);
  return Boolean(validateTurnUrls(config.urls) && config.secret);
}

/** Persist Super Admin TURN config. Encrypts plaintext secret when provided. */
export function prepareCallingTurnSettingValue(incoming = {}, previous = {}) {
  const urls = splitUrls(incoming.urls ?? incoming.turnUrls ?? previous.urls ?? '');
  const nextSecret = String(incoming.secret ?? incoming.turnSecret ?? '').trim();
  const keepEncrypted = String(previous.secretEncrypted || '').trim();
  if (!urls.length) {
    return { urls: [], secretEncrypted: '' };
  }
  if (!validateTurnUrls(urls)) {
    throw new Error('TURN URLs must be turn: or turns: hosts with optional port/transport.');
  }
  let secretEncrypted = keepEncrypted;
  if (nextSecret && nextSecret !== '[encrypted]') {
    if (nextSecret.startsWith('v1:')) secretEncrypted = nextSecret;
    else secretEncrypted = encryptSecret(nextSecret);
  }
  if (!secretEncrypted) {
    throw new Error('Provide a TURN shared secret (or keep the existing encrypted secret).');
  }
  return { urls, secretEncrypted };
}

export { TURN_SETTING_KEY };
