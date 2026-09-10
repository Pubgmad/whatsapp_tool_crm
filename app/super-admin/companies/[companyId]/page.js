import SuperAdminApp from "../../../../components/super-admin-app";
import { requireSuperAdminPage } from "../../../../lib/page-auth";

export const metadata = { title: "Company details" };

export default async function SuperAdminCompanyPage({ params }) {
  await requireSuperAdminPage();
  const { companyId } = await params;
  return <SuperAdminApp initialSection="companies" initialCompanyId={companyId} />;
}
