const clean = (value) => String(value || '').trim();

export function granularWabaIds(debug) {
  return (debug?.granular_scopes || [])
    .filter((scope) => scope.scope === 'whatsapp_business_management')
    .flatMap((scope) => scope.target_ids || [])
    .map((value) => clean(value))
    .filter(Boolean);
}

/**
 * Do not pick an arbitrary first WABA or phone when more than one asset is authorized.
 * A single authorized asset can still complete when the session event omits that id
 * (FINISH_ONLY_WABA and some v4 completions).
 */
export function resolveEmbeddedSignupSelection({ mode, wabaId, phoneNumberId, sessionEvent, numbers, granularTargetIds }) {
  const phones = numbers || [];
  const targets = [...new Set((granularTargetIds || []).map((value) => clean(value)).filter(Boolean))];
  const event = clean(sessionEvent);
  if (event === 'CANCEL' || event === 'ERROR') {
    return { error: 'META_SIGNUP_CANCELLED', message: 'Meta signup was cancelled or reported an error. Start the connection again.' };
  }
  if (mode === 'coexistence' && event !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
    return { error: 'COEXISTENCE_NOT_CONFIRMED', message: 'Meta did not confirm Business App onboarding. Start coexistence again and wait for the completion event.' };
  }
  let resolvedWaba = clean(wabaId);
  if (resolvedWaba && targets.length && !targets.includes(resolvedWaba)) {
    return { error: 'META_WABA_UNAUTHORIZED', message: 'The selected WhatsApp Business Account is not authorized by this token. Start Embedded Signup again.' };
  }
  if (!resolvedWaba) {
    if (targets.length === 1) resolvedWaba = targets[0];
    else if (targets.length > 1) {
      return { error: 'META_WABA_AMBIGUOUS', message: 'Meta authorized more than one WhatsApp Business Account and did not say which one was selected. Start Embedded Signup again and leave the window open until it finishes.' };
    } else {
      return { error: 'META_WABA_MISSING', message: 'Meta did not return a WhatsApp Business Account ID. Start Embedded Signup again.' };
    }
  }
  const selectedPhoneId = clean(phoneNumberId);
  let phone = null;
  if (selectedPhoneId) {
    phone = phones.find((item) => String(item.id) === selectedPhoneId) || null;
    if (!phone) return { error: 'META_PHONE_NOT_ACCESSIBLE', message: 'The selected phone number is not available on the authorized WhatsApp Business Account.' };
  } else if (phones.length === 1) {
    phone = phones[0];
  } else if (phones.length === 0) {
    return { error: 'META_PHONE_MISSING', message: 'Embedded Signup finished without a phone number on this account. Add a number in WhatsApp Manager, then connect again.' };
  } else {
    return { error: 'META_PHONE_AMBIGUOUS', message: 'More than one phone number is available and Meta did not identify the selected number. Start Embedded Signup again and complete the number step.' };
  }
  return { wabaId: resolvedWaba, phone };
}
