import { passwordPolicyError } from './password-policy.js';

export function isSessionFailure(error) {
  return ['AUTH_REQUIRED', 'SESSION_REVOKED', 'SUPER_ADMIN_AUTH_REQUIRED', 'SUPER_ADMIN_SESSION_REVOKED'].includes(error?.code);
}

/** Errors that should send the user to login instead of the root error page. */
export function isWorkspaceGateFailure(error) {
  return isSessionFailure(error)
    || ['EMAIL_NOT_VERIFIED', 'ACCOUNT_SUSPENDED', 'NO_WORKSPACE'].includes(error?.code);
}

export function authFormPasswordError(password, mode) {
  return mode === 'signup' ? passwordPolicyError(password) : '';
}

export function createRequestGate() {
  let generation = 0;
  return { begin: () => ++generation, current: request => request === generation, invalidate: () => { generation++; } };
}
