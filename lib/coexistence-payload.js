const digits = (value) => String(value || '').replace(/\D/g, '');

export function coexistencePhone(value) {
  const phone = digits(value);
  return phone.length >= 7 && phone.length <= 15 ? `+${phone}` : '';
}

export function coexistenceTimestamp(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * (seconds > 1e12 ? 1 : 1000));
  return Number.isNaN(date.getTime()) ? null : date;
}

function messageContent(message) {
  const type = String(message.type || 'text');
  const media = ['image', 'video', 'audio', 'document', 'sticker'].includes(type) ? message[type] || {} : {};
  return {
    type,
    body: String(message.text?.body || media.caption || `[${type}]`).slice(0, 100000),
    mediaId: String(media.id || ''),
    mimeType: String(media.mime_type || ''),
    caption: String(media.caption || '')
  };
}

export function parseCoexistenceContacts(value) {
  return (Array.isArray(value.state_sync) ? value.state_sync : [])
    .filter((item) => item?.type === 'contact' && !['delete', 'remove'].includes(String(item.action || '').toLowerCase()))
    .map((item) => ({
      phone: coexistencePhone(item.contact?.phone_number),
      name: String(item.contact?.full_name || item.contact?.first_name || '').trim().slice(0, 255)
    }))
    .filter((item) => item.phone);
}

export function parseCoexistenceHistory(value) {
  const messages = [];
  const businessPhone = coexistencePhone(value.metadata?.display_phone_number);
  let declined = false;
  let maxProgress = null;
  const chunks = Array.isArray(value.history) ? value.history : [];
  for (const chunk of chunks) {
    const progress = Number(chunk?.metadata?.progress);
    if (Number.isFinite(progress)) maxProgress = maxProgress == null ? progress : Math.max(maxProgress, progress);
    if (chunk?.errors?.length) { declined = true; continue; }
    for (const thread of Array.isArray(chunk?.threads) ? chunk.threads : []) {
      const phone = coexistencePhone(thread.id);
      if (!phone) continue;
      for (const message of Array.isArray(thread.messages) ? thread.messages : []) {
        const from = coexistencePhone(message.from);
        const to = coexistencePhone(message.to);
        const direction = from === phone ? 'incoming' : from && (from === businessPhone || to === phone) ? 'outgoing' : '';
        const at = coexistenceTimestamp(message.timestamp);
        if (!direction || !at || !message.id) continue;
        messages.push({ phone, direction, at, metaMessageId: String(message.id), ...messageContent(message) });
      }
    }
  }
  // Meta reports progress 0-100; 100 (or an empty terminal chunk after transfer) ends history sync.
  const complete = declined || maxProgress === 100 || (chunks.length === 0 && Boolean(value.messaging_product));
  return { messages, declined, complete, progress: maxProgress };
}

export function parseCoexistenceEchoes(value) {
  return (Array.isArray(value.message_echoes) ? value.message_echoes : [])
    .map((message) => ({
      phone: coexistencePhone(message.to),
      at: coexistenceTimestamp(message.timestamp),
      metaMessageId: String(message.id || ''),
      ...messageContent(message)
    }))
    .filter((message) => message.phone && message.at && message.metaMessageId);
}
