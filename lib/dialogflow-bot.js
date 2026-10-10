import crypto from 'node:crypto';
import { AppError } from './db.js';
import { readTextBodyLimited } from './security.js';
import { sendCtaUrlMessage, sendInteractiveMessage, sendTextMessage } from './meta.js';

function clean(value) {
  return String(value || '').trim();
}

function publicHttpsUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
  return url.href;
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

function mapPayloadMedia(payload) {
  const typeRaw = clean(payload?.fileType || payload?.mediaType || payload?.type).toUpperCase();
  const mediaHint = Boolean(payload?.fileUrl || payload?.mediaUrl || payload?.image?.url || ['IMAGE', 'VIDEO', 'FILE', 'DOCUMENT', 'PDF', 'AUDIO'].includes(typeRaw));
  if (!mediaHint) return null;
  // CTA payloads use url + displayText; do not treat those as media.
  if (payload?.displayText || payload?.cta || payload?.ctaUrl) return null;
  const link = publicHttpsUrl(payload?.fileUrl || payload?.mediaUrl || payload?.image?.url || (['IMAGE', 'VIDEO', 'FILE', 'DOCUMENT', 'PDF', 'AUDIO'].includes(typeRaw) ? payload?.url : null));
  if (!link) return null;
  const mapped = typeRaw === 'VIDEO' || typeRaw === 'VIDEO_URL' ? 'video'
    : typeRaw === 'FILE' || typeRaw === 'DOCUMENT' || typeRaw === 'PDF' ? 'document'
    : typeRaw === 'AUDIO' ? 'audio'
    : 'image';
  return {
    type: mapped,
    link,
    caption: clean(payload?.altText || payload?.caption || payload?.title || '').slice(0, 1024),
    filename: clean(payload?.filename || payload?.fileName || '').slice(0, 240) || undefined
  };
}

function mapPayloadList(payload) {
  const sectionsRaw = payload?.sections || payload?.list?.sections;
  if (!Array.isArray(sectionsRaw) || !sectionsRaw.length) return null;
  const sections = [];
  for (const section of sectionsRaw.slice(0, 10)) {
    const title = clean(section?.title || 'Options').slice(0, 24) || 'Options';
    const rows = [];
    for (const row of (section?.rows || section?.items || []).slice(0, 10)) {
      const id = clean(row?.id || row?.payload || row?.title).slice(0, 200);
      const rowTitle = clean(row?.title || row?.text || row?.label).slice(0, 20);
      if (!id || !rowTitle) continue;
      rows.push({ id, title: rowTitle, description: clean(row?.description || '').slice(0, 72), section: title });
    }
    if (rows.length) sections.push(...rows);
  }
  if (!sections.length) return null;
  return {
    buttonText: clean(payload?.buttonText || payload?.list?.button || 'Choose').slice(0, 20) || 'Choose',
    options: sections
  };
}

function mapPayloadCta(payload) {
  const url = publicHttpsUrl(payload?.url || payload?.ctaUrl || payload?.link);
  const displayText = clean(payload?.displayText || payload?.cta || payload?.buttonText).slice(0, 20);
  if (!url || !displayText) return null;
  return { url, displayText, header: clean(payload?.header || payload?.title || '').slice(0, 60) };
}

/** Map Dialogflow CX / AiSensy-style payloads to WhatsApp-safe send plans. */
export function mapDialogflowResponse(payload) {
  const messages = payload?.queryResult?.responseMessages || [];
  const texts = [];
  const suggestions = [];
  let media = null;
  let list = null;
  let cta = null;

  for (const item of messages) {
    if (Array.isArray(item?.text?.text)) {
      for (const part of item.text.text) {
        const value = clean(part);
        if (value) texts.push(value);
      }
    }

    // Dialogflow CX payload custom responses (AiSensy-compatible shapes)
    const body = item?.payload || item?.payload?.fields || null;
    const plain = body && typeof body === 'object' ? body : null;
    if (plain) {
      const chips = plain.suggestions || plain.quickReplies || plain.buttons;
      if (Array.isArray(chips)) {
        for (const chip of chips.slice(0, 10)) {
          const label = clean(chip?.text || chip?.title || chip?.label || chip);
          if (label && label.length <= 20) suggestions.push(label);
        }
      }
      media = media || mapPayloadMedia(plain);
      list = list || mapPayloadList(plain);
      cta = cta || mapPayloadCta(plain);
    }

    // Basic card / content info style (Google Assistant → AiSensy media convention)
    const card = item?.payload?.basicCard || item?.basicCard || item?.card;
    if (card) {
      media = media || mapPayloadMedia({
        fileUrl: card.image?.url || card.buttons?.[0]?.openUriAction?.url,
        fileType: card.image?.url ? 'IMAGE' : 'FILE',
        altText: card.title || card.formattedText || card.subtitle,
        filename: card.title
      });
      const cardText = clean(card.formattedText || card.title || card.subtitle);
      if (cardText) texts.push(cardText);
    }
  }

  const reply = texts.join('\n').slice(0, 4096);
  const uniqueSuggestions = [...new Set(suggestions)].slice(0, 3);

  if (media) {
    return { kind: 'media', text: reply || media.caption || ' ', media, suggestions: uniqueSuggestions };
  }
  if (cta && reply) {
    return { kind: 'cta', text: reply, cta, suggestions: uniqueSuggestions };
  }
  if (list?.options?.length && reply) {
    return {
      kind: 'list',
      text: reply,
      list,
      suggestions: uniqueSuggestions
    };
  }
  if (uniqueSuggestions.length && reply) {
    return {
      kind: 'buttons',
      text: reply,
      suggestions: uniqueSuggestions,
      options: uniqueSuggestions.map((title, index) => ({ id: `df_${index + 1}`, title, label: title }))
    };
  }
  if (!reply) return null;
  return { kind: 'text', text: reply, suggestions: uniqueSuggestions };
}

export async function sendDialogflowWhatsAppReply({ setup, to, reply }) {
  const plan = typeof reply === 'string' ? { kind: 'text', text: reply } : reply;
  if (!plan?.text && plan?.kind !== 'media') return null;

  if (plan.kind === 'media' && plan.media?.link) {
    const { sendMediaLinkMessage } = await import('./meta.js');
    return sendMediaLinkMessage({
      setup,
      to,
      type: plan.media.type,
      link: plan.media.link,
      caption: plan.media.caption || plan.text || '',
      filename: plan.media.filename
    });
  }
  if (plan.kind === 'cta' && plan.cta?.url) {
    return sendCtaUrlMessage({
      setup,
      to,
      body: plan.text,
      cta: plan.cta.displayText,
      url: plan.cta.url,
      headerText: plan.cta.header || ''
    });
  }
  if (plan.kind === 'list' && plan.list?.options?.length) {
    return sendInteractiveMessage({
      setup,
      to,
      body: plan.text,
      options: plan.list.options,
      mode: 'list',
      buttonText: plan.list.buttonText || 'Choose'
    });
  }
  if (plan.kind === 'buttons' && (plan.options || plan.suggestions)?.length) {
    const options = plan.options || plan.suggestions.map((title, index) => ({ id: `df_${index + 1}`, title, label: title }));
    return sendInteractiveMessage({ setup, to, body: plan.text, options, mode: 'buttons' });
  }
  return sendTextMessage({ setup, to, body: plan.text });
}
