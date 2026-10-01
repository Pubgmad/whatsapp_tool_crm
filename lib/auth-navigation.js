export function isSessionFailure(error) {
  return ['AUTH_REQUIRED', 'SESSION_REVOKED', 'SUPER_ADMIN_AUTH_REQUIRED', 'SUPER_ADMIN_SESSION_REVOKED'].includes(error?.code);
}

export function authFormPasswordError(password, mode) {
  return mode === 'signup' && String(password || '').length < 12 ? 'Password must be at least 12 characters.' : '';
}

export function createRequestGate() {
  let generation = 0;
  return { begin: () => ++generation, current: request => request === generation, invalidate: () => { generation++; } };
}
