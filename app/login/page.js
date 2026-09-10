import WorkspaceApp from "../../components/workspace-app";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return <WorkspaceApp authMode="signin" />;
}
