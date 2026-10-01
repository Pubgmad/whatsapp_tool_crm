const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function okToReply(contact) {
  const value = contact?.last_message_at || contact?.lastMessageAt;
  if (!value) return false;
  const age = Date.now() - new Date(value).getTime();
  return Number.isFinite(age) && age >= 0 && age <= REPLY_WINDOW_MS;
}
