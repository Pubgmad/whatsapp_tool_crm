import SuperAdminApp from "../../../components/super-admin-app";
import { requireSuperAdminPage } from "../../../lib/page-auth";

export const metadata = { title: "Privacy policy" };

export default async function SuperAdminPrivacyPolicyPage() {
  await requireSuperAdminPage();
  return <SuperAdminApp initialSection="privacy-policy" />;
}
