import SuperAdminApp from "../../../components/super-admin-app";
import { requireSuperAdminPage } from "../../../lib/page-auth";

export const metadata = { title: "Companies" };
export default async function SuperAdminCompaniesPage() { await requireSuperAdminPage(); return <SuperAdminApp initialSection="companies" />; }
