import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateSuperAdminToken, SUPER_SESSION_COOKIE_NAME } from "./super-admin";
import { authenticateSessionToken, SESSION_COOKIE_NAME } from './auth';
import { getPublicPlatformConfig } from './platform';

export async function prepareWorkspaceAuthPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    try { await authenticateSessionToken(token); redirect('/app/dashboard'); }
    catch (error) { if (error?.digest?.startsWith('NEXT_REDIRECT')) throw error; }
  }
  return getPublicPlatformConfig();
}

export async function requireSuperAdminPage() {
  const token = (await cookies()).get(SUPER_SESSION_COOKIE_NAME)?.value;
  try {
    return await authenticateSuperAdminToken(token);
  } catch {
    redirect("/super-admin/login");
  }
}
