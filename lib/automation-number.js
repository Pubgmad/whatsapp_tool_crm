import { AppError } from "./db.js";

function sourceTokenLive(job) {
  if (!job?.source_phone_number_id || !job?.source_access_token_encrypted) return false;
  const expiresAt = job.source_token_expires_at;
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() > Date.now();
}

export function automationMessagingSetup(job) {
  const conversationPhoneId = String(job.conversation_phone_number_id || "");
  // Conversation pinned to a number must use that number's live token — never fall through to COALESCE default/businesses.
  if (conversationPhoneId) {
    if (!(sourceTokenLive(job) && String(job.source_phone_number_id) === conversationPhoneId)) {
      throw new AppError("The WhatsApp number for this conversation is no longer connected.", 409, "META_SOURCE_DISCONNECTED");
    }
    return {
      ...job,
      phone_number_id: job.source_phone_number_id,
      waba_id: job.source_waba_id || job.waba_id,
      default_waba_id: job.default_waba_id || job.waba_id,
      access_token_encrypted: job.source_access_token_encrypted
    };
  }
  if (sourceTokenLive(job)) {
    return {
      ...job,
      phone_number_id: job.source_phone_number_id,
      waba_id: job.source_waba_id || job.waba_id,
      default_waba_id: job.default_waba_id || job.waba_id,
      access_token_encrypted: job.source_access_token_encrypted
    };
  }
  return job;
}
