import WorkspaceApp from "../../components/workspace-app";
import { prepareWorkspaceAuthPage } from '@/lib/page-auth';

export const metadata = { title: "Create workspace" };

export default async function SignupPage() {
  return <WorkspaceApp authMode="signup" initialPlatform={await prepareWorkspaceAuthPage()} />;
}
