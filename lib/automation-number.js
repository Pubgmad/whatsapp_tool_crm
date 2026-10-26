import { AppError } from "./db.js";

export function automationMessagingSetup(job) {
  const conversationPhoneId = String(job.conversation_phone_number_id || "");
  const defaultPhoneId = String(job.phone_number_id || "");
  if (conversationPhoneId && conversationPhoneId !== defaultPhoneId &&
      (!job.source_phone_number_id || !job.source_access_token_encrypted)) {
    throw new AppError("The WhatsApp number for this conversation is no longer connected.", 409, "META_SOURCE_DISCONNECTED");
  }
  if (job.source_phone_number_id && job.source_access_token_encrypted) {
    return {
      ...job,
      phone_number_id: job.source_phone_number_id,
      waba_id: job.source_waba_id || job.waba_id,
      default_waba_id: job.default_waba_id || job.waba_id,
      access_token_encrypted: job.source_access_token_encrypted
    };
  }
  return job; // Claim SQL only joins connected source accounts; default COALESCE prefers connected def.
}
