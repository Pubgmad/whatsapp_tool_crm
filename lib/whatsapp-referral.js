const trimmed = (value, maxLength) => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

export function normalizeWhatsAppReferral(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sourceType = trimmed(value.source_type, 16).toUpperCase();
  const sourceId = trimmed(value.source_id, 32);
  if (!['AD', 'POST'].includes(sourceType) || !/^\d{1,32}$/.test(sourceId)) return null;

  const referral = {
    sourceType,
    sourceId,
    headline: trimmed(value.headline, 200),
    body: trimmed(value.body, 500)
  };
  const rawUrl = trimmed(value.source_url, 2048);
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol === 'https:') referral.sourceUrl = url.toString();
    } catch { /* Ignore malformed links supplied by the webhook. */ }
  }
  return referral;
}
