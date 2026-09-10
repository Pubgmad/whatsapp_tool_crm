import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateSessionToken, SESSION_COOKIE_NAME } from "../../lib/auth";
import WorkspaceApp from "../../components/workspace-app";

export default async function ProtectedWorkspaceLayout({ children }) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  try {
    await authenticateSessionToken(token);
  } catch {
    redirect("/login");
  }
  return <WorkspaceApp>{children}</WorkspaceApp>;
}
