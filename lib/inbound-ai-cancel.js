import { cancelPendingAiReply } from './ai-auto-replies.js';

/** Cancel queued AI after bots/automation claim without masking in-flight send races. */
export async function bestEffortCancelPendingAi(businessId, conversationId) {
  try {
    await cancelPendingAiReply(businessId, conversationId);
  } catch (error) {
    if (error?.code === 'AI_REPLY_IN_FLIGHT' || error?.code === 'AI_REPLY_UNCONFIRMED') return;
    console.error('AI cancel failed', { businessId, code: error?.code || 'AI_CANCEL_FAILED' });
  }
}