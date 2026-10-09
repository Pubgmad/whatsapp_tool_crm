import { AppError } from './db.js';

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
  const error = passwordPolicyError(password);
  if (error) throw new AppError(error, 400, 'PASSWORD_POLICY');
}

export function passwordMeetsPolicy(password) {
  return passwordPolicyError(password) === '';
}
