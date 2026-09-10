import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateSuperAdminToken, SUPER_SESSION_COOKIE_NAME } from "./super-admin";

export async function requireSuperAdminPage() {
  const token = (await cookies()).get(SUPER_SESSION_COOKIE_NAME)?.value;
  try {
    return await authenticateSuperAdminToken(token);
  } catch {
    redirect("/super-admin/login");
  }
}
