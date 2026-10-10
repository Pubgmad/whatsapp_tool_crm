import crypto from 'node:crypto';
import { AppError } from './db.js';
import { readTextBodyLimited } from './security.js';

function clean(value) {
  return String(value || '').trim();
}

export function dialogflowPlatformConfigured() {
  const project = clean(process.env.DIALOGFLOW_PROJECT_ID);
  const raw = clean(process.env.GOOGLE_DIALOGFLOW_SERVICE_ACCOUNT_JSON);
  return Boolean(project && raw && raw.startsWith('{'));
}

function parseServiceAccount() {
  if (!dialogflowPlatformConfigured()) throw new AppError('Dialogflow is not configured on the platform.', 503, 'DIALOGFLOW_NOT_CONFIGURED');
  let value;
  try {
    value = JSON.parse(process.env.GOOGLE_DIALOGFLOW_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new AppError('Dialogflow service account JSON is invalid.', 503, 'DIALOGFLOW_NOT_CONFIGURED');
  }
  if (!value?.client_email || !value?.private_key || !value?.token_uri) {
    throw new AppError('Dialogflow service account JSON is incomplete.', 503, 'DIALOGFLOW_NOT_CONFIGURED');
  }
  return value;
}

async function googleAccessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(
    JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: account.token_uri,
      iat: now,
      exp: now + 3600
    })
  ).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  signer.end();
  const signature = signer.sign(account.private_key).toString('base64url');
  const assertion = `${header}.${claim}.${signature}`;
  const response = await fetch(account.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    }),
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new AppError('Dialogflow authorization failed.', 503, 'DIALOGFLOW_AUTH_FAILED');
  return payload.access_token;
}

export async function detectDialogflowReply({ agentId, location, sessionId, text, languageCode = 'en' }) {
  const project = clean(process.env.DIALOGFLOW_PROJECT_ID);
  const agent = clean(agentId);
  const loc = clean(location) || 'global';
  if (!/^[a-zA-Z0-9_-]{10,80}$/.test(agent)) throw new AppError('Configure a valid Dialogflow CX agent ID.', 409, 'DIALOGFLOW_AGENT_INVALID');
  const input = clean(text).slice(0, 256);
  if (!input) return null;
  const account = parseServiceAccount();
  const token = await googleAccessToken(account);
  const session = encodeURIComponent(`wa-${clean(sessionId).slice(0, 120)}`);
  const url = `https://${loc}-dialogflow.googleapis.com/v3/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(loc)}/agents/${encodeURIComponent(agent)}/sessions/${session}:detectIntent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      queryInput: {
        text: { text: input },
        languageCode: clean(languageCode) || 'en'
      }
    }),
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(20000)
  });
  const payload = JSON.parse(await readTextBodyLimited(response, 500000));
  if (!response.ok) throw new AppError(payload.error?.message || 'Dialogflow rejected the request.', response.status >= 500 ? 502 : 409, 'DIALOGFLOW_REQUEST_FAILED');
  return mapDialogflowResponse(payload);
}

/** Map Dialogflow CX detectIntent payload to WhatsApp-safe text (+ optional suggestion chips metadata). */
export function mapDialogflowResponse(payload) {
  const messages = payload?.queryResult?.responseMessages || [];
  const texts = [];
  const suggestions = [];
  for (const item of messages) {
    if (Array.isArray(item?.text?.text)) {
      for (const part of item.text.text) {
        const value = clean(part);
        if (value) texts.push(value);
      }
    }
    const chips = item?.payload?.suggestions || item?.payload?.quickReplies || item?.payload?.buttons;
    if (Array.isArray(chips)) {
      for (const chip of chips.slice(0, 3)) {
        const label = clean(chip?.text || chip?.title || chip?.label || chip);
        if (label && label.length <= 20) suggestions.push(label);
      }
    }
  }
  const reply = texts.join('\n').slice(0, 4096);
  if (!reply) return null;
  return suggestions.length ? { text: reply, suggestions: [...new Set(suggestions)].slice(0, 3) } : reply;
}
