import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateSessionToken, SESSION_COOKIE_NAME } from "../lib/auth";
import { isSessionFailure } from '../lib/auth-navigation';

export default async function HomePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  let authenticated = false;
  try {
    await authenticateSessionToken(token);
    authenticated = true;
  } catch (error) { if (!isSessionFailure(error)) throw error; }
  redirect(authenticated ? "/app/dashboard" : "/login");
}
