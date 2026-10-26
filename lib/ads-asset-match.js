import { AppError } from './db.js';

/** Digits only from a display / Graph phone string. */
export function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * CRM and Meta often disagree on country-code prefix (e.g. 918807111304 vs 8807111304).
 * Treat as the same number when one digit string ends with the other (min 8 digits).
 */
export function phonesMatch(crmDigits, metaDigits) {
  const a = phoneDigits(crmDigits);
  const b = phoneDigits(metaDigits);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  return shorter.length >= 8 && longer.endsWith(shorter);
}

/** Meta may return account_status as number or string. */
export function adAccountIsActive(accountStatus) {
  return Number(accountStatus) === 1;
}

/**
 * Shared Finish-connection / verifyConnection gate.
 * @returns {{ number: string, currency: string }}
 */
export function assertPageWhatsAppMatchesCrm({ account, page, adAccountId, pageId, crmDisplayPhone }) {
  const number = phoneDigits(crmDisplayPhone);
  if (!number) {
    throw new AppError('Connect and register the selected WhatsApp number.', 409, 'ADS_PHONE_INELIGIBLE');
  }

  const expectedAct = String(adAccountId).startsWith('act_') ? String(adAccountId) : `act_${adAccountId}`;
  if (String(account?.id) !== expectedAct && String(account?.id) !== String(adAccountId)) {
    throw new AppError(
      'Meta returned a different ad account than the one you selected. Start Continue with Facebook again.',
      403,
      'ADS_ASSET_MISMATCH'
    );
  }
  if (!adAccountIsActive(account?.account_status)) {
    throw new AppError(
      `The selected ad account is not active in Meta (status ${account?.account_status ?? 'unknown'}). Open Ads Manager, fix the account status, then retry.`,
      403,
      'ADS_ASSET_MISMATCH'
    );
  }
  if (String(page?.id) !== String(pageId)) {
    throw new AppError(
      'Meta returned a different Facebook Page than the one you selected. Start Continue with Facebook again.',
      403,
      'ADS_ASSET_MISMATCH'
    );
  }

  const pageWhatsapp = phoneDigits(page?.whatsapp_number);
  if (!pageWhatsapp) {
    throw new AppError(
      'Meta did not return a WhatsApp number on this Facebook Page. In Meta Business Suite → Page Mathstrat → WhatsApp, link Sandbox Business (+91 88071 11304), wait a few minutes, then Finish connection again.',
      403,
      'ADS_ASSET_MISMATCH'
    );
  }
  if (!phonesMatch(number, pageWhatsapp)) {
    throw new AppError(
      `WhatsApp number mismatch: CRM has …${number.slice(-4)}, Meta Page reports …${pageWhatsapp.slice(-4)}. Link Page Mathstrat to the same Sandbox number as CRM Setup, then retry.`,
      403,
      'ADS_ASSET_MISMATCH'
    );
  }

  return { number, currency: account?.currency || '' };
}
