import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateSuperAdminToken, SUPER_SESSION_COOKIE_NAME } from "./super-admin";
import { authenticateSessionToken, SESSION_COOKIE_NAME } from './auth';
import { getPublicPlatformConfig } from './platform';
import { isSessionFailure } from './auth-navigation';

export async function prepareWorkspaceAuthPage({ reauthenticate = false } = {}) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (token && !reauthenticate) {
    try { await authenticateSessionToken(token); redirect('/app/dashboard'); }
    catch (error) { if (!isSessionFailure(error)) throw error; }
  }
  return getPublicPlatformConfig();
}

export async function requireSuperAdminPage() {
  const token = (await cookies()).get(SUPER_SESSION_COOKIE_NAME)?.value;
  try {
    return await authenticateSuperAdminToken(token);
  } catch (error) {
    if (isSessionFailure(error)) redirect('/super-admin/login');
    throw error;
  }
}

/** Login page: keep Super Admin signed in across browser revisits when the session cookie is still valid. */
export async function prepareSuperAdminLoginPage() {
  const token = (await cookies()).get(SUPER_SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    await authenticateSuperAdminToken(token);
    redirect('/super-admin');
  } catch (error) {
    if (!isSessionFailure(error)) throw error;
  }
  return null;
}
