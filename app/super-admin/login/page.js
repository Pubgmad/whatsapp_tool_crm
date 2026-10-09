import SuperAdminApp from "../../../components/super-admin-app";
import { prepareSuperAdminLoginPage } from "@/lib/page-auth";

export const metadata = { title: "Super Admin sign in" };
export default async function SuperAdminLoginPage() {
  await prepareSuperAdminLoginPage();
  return <SuperAdminApp authOnly />;
}
