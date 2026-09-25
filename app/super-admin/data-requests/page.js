import SuperAdminApp from "@/components/super-admin-app";
import { requireSuperAdminPage } from "@/lib/page-auth";

export const metadata = { title: "Meta data requests" };

export default async function MetaDataRequestsPage() {
  await requireSuperAdminPage();
  return <SuperAdminApp initialSection="data-requests" />;
}
