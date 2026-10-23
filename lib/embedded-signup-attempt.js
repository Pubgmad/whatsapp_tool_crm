/**
 * Browser-safe Embedded Signup attempt coordinator.
 *
 * sessionInfoVersion 3 is the postMessage payload schema (event data with waba_id
 * and phone_number_id). It is not the Embedded Signup flow version (v2, v3, v4).
 * Flow version is selected by the Meta configuration ID.
 * Docs checked 2026-10-23:
 * https://developers.facebook.com/docs/whatsapp/embedded-signup/implementation/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/bypass-phone-addition/
 *
 * Origins are an explicit allowlist. Meta's sample uses a facebook.com suffix check;
 * this list is the hosts that actually post WA_EMBEDDED_SIGNUP.
 */

export const EMBEDDED_SIGNUP_ORIGINS = Object.freeze([
  'https://www.facebook.com',
  'https://web.facebook.com',
  'https://business.facebook.com',
  'https://m.facebook.com'
]);

export const SIGNUP_WAIT_MS = 20000;

const FINISH_EVENTS = Object.freeze({
  standard: Object.freeze(['FINISH', 'FINISH_ONLY_WABA']),
  coexistence: Object.freeze(['FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'])
});

const KNOWN_EVENTS = new Set([
  'FINISH',
  'FINISH_ONLY_WABA',
  'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  'CANCEL',
  'ERROR'
]);

export function createSignupAttempt(mode) {
  const generation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    generation,
    mode: mode === 'coexistence' ? 'coexistence' : 'standard',
    code: '',
    completion: null,
    error: '',
    cancelled: false,
    timedOut: false,
    submitted: false,
    listening: false
  };
}

export function acceptEmbeddedSignupMessage(origin, data) {
  if (!EMBEDDED_SIGNUP_ORIGINS.includes(String(origin || ''))) {
    return { accepted: false, reason: 'origin' };
  }
  let payload = data;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); }
    catch { return { accepted: false, reason: 'parse' }; }
  }
  if (!payload || typeof payload !== 'object' || payload.type !== 'WA_EMBEDDED_SIGNUP') {
    return { accepted: false, reason: 'type' };
  }
  const event = String(payload.event || '');
  if (!KNOWN_EVENTS.has(event)) return { accepted: false, reason: 'event' };
  const eventData = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : {};
  return {
    accepted: true,
    event,
    data: {
      waba_id: String(eventData.waba_id || '').trim(),
      phone_number_id: String(eventData.phone_number_id || '').trim(),
      error_message: String(eventData.error_message || eventData.message || eventData.current_step || '').trim()
    }
  };
}

export function reduceSignupAttempt(attempt, action) {
  if (!attempt || attempt.submitted) return attempt;
  if (action?.type === 'listen') return { ...attempt, listening: true };
  if (action?.type === 'code') {
    return { ...attempt, code: String(action.code || '').trim() };
  }
  if (action?.type === 'timeout') return { ...attempt, timedOut: true };
  if (action?.type !== 'message') return attempt;
  if (!attempt.listening) return attempt;
  if (action.generation && action.generation !== attempt.generation) return attempt;
  const parsed = action.parsed;
  if (!parsed?.accepted) return attempt;
  if (parsed.event === 'CANCEL' || parsed.event === 'ERROR') {
    return {
      ...attempt,
      cancelled: true,
      error: parsed.data.error_message || (parsed.event === 'CANCEL' ? 'Meta signup was cancelled.' : 'Meta signup reported an error.')
    };
  }
  const allowed = FINISH_EVENTS[attempt.mode] || FINISH_EVENTS.standard;
  if (!allowed.includes(parsed.event)) return attempt;
  if (attempt.completion) return attempt;
  return {
    ...attempt,
    error: '',
    completion: {
      event: parsed.event,
      wabaId: parsed.data.waba_id,
      phoneNumberId: parsed.data.phone_number_id
    }
  };
}

export function signupReadyToSubmit(attempt) {
  if (!attempt || attempt.submitted || attempt.cancelled || !attempt.code) return false;
  if (attempt.completion) return true;
  return Boolean(attempt.timedOut);
}

export function signupSubmitPayload(attempt) {
  if (!signupReadyToSubmit(attempt)) return null;
  return {
    code: attempt.code,
    mode: attempt.mode,
    sessionEvent: attempt.completion?.event || '',
    wabaId: attempt.completion?.wabaId || '',
    phoneNumberId: attempt.completion?.phoneNumberId || '',
    clientAttemptId: attempt.generation
  };
}
