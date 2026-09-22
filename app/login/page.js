import WorkspaceApp from "../../components/workspace-app";
import { prepareWorkspaceAuthPage } from '@/lib/page-auth';

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  return <WorkspaceApp authMode="signin" initialPlatform={await prepareWorkspaceAuthPage()} />;
}
