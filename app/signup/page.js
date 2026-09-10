import WorkspaceApp from "../../components/workspace-app";

export const metadata = { title: "Create workspace" };

export default function SignupPage() {
  return <WorkspaceApp authMode="signup" />;
}
