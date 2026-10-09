/**
 * Client-safe password rules. Do not import server-only modules (db/pg) here —
 * this file is used by signup/invite client components.
 */

export const PASSWORD_MIN_LENGTH = 12;

export const PASSWORD_POLICY_HINT =
  `At least ${PASSWORD_MIN_LENGTH} characters, with lowercase, uppercase, and a number.`;

/**
 * Returns a user-facing error string, or empty when the password meets policy.
 */
export function passwordPolicyError(password) {
  const value = String(password || '');
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[a-z]/.test(value)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(value)) return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(value)) return 'Password must include a number.';
  if (!/[A-Za-z]/.test(value)) return 'Password must include a letter.';
  return '';
}

export function assertPasswordPolicy(password) {
  const message = passwordPolicyError(password);
  if (!message) return;
  const error = new Error(message);
  error.status = 400;
  error.code = 'PASSWORD_POLICY';
  throw error;
}

export function passwordMeetsPolicy(password) {
  return passwordPolicyError(password) === '';
}
