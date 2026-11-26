import { AppError } from './db.js';

/** Marketing templates need opt-in; utility/auth only need not unsubscribed. */
export function requiresMarketingOptIn(templateCategory) {
  return String(templateCategory || '').toUpperCase() === 'MARKETING';
}

/**
 * SQL predicate for contacts.
 * @param {string} templateCategory
 * @param {string} [contactAlias] e.g. 'c' → `c.unsubscribed`; omit for bare columns.
 */
export function contactEligibleSql(templateCategory, contactAlias = '') {
  const prefix = contactAlias ? `${contactAlias}.` : '';
  if (requiresMarketingOptIn(templateCategory)) {
    return `${prefix}marketing_permission = TRUE AND ${prefix}unsubscribed = FALSE`;
  }
  return `${prefix}unsubscribed = FALSE`;
}

/** Join-aware form when template category comes from `t.category`. */
export function contactEligibleJoinSql(contactAlias = 'c', templateAlias = 't') {
  const c = contactAlias;
  const t = templateAlias;
  return `${c}.unsubscribed = FALSE AND (${t}.category IS DISTINCT FROM 'MARKETING' OR ${c}.marketing_permission = TRUE)`;
}

export function assertContactEligibleForTemplate(contact, templateCategory) {
  if (!contact || contact.unsubscribed) {
    throw new AppError('Recipient opted out before delivery.', 409, 'RECIPIENT_OPTED_OUT');
  }
  if (requiresMarketingOptIn(templateCategory) && !contact.marketing_permission) {
    throw new AppError('Recipient has not opted in to marketing messages.', 409, 'RECIPIENT_OPTED_OUT');
  }
}
