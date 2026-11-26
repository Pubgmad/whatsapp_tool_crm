/**
 * Pure routing plan after reply bots + sheets attempt (matches Meta webhook handler in actions.js).
 * Used for regression tests documenting precedence: reply match → sheets → automation → deferred fallback → AI.
 */
export function planInboundAutomationOutcome({ botHandled, automationJob, hasDeferredFallback }) {
  if (botHandled) return 'cancel_ai';
  if (automationJob?.jobId || automationJob?.sessionId) return 'cancel_ai';
  if (hasDeferredFallback) return 'deliver_deferred_fallback';
  return 'allow_ai';
}