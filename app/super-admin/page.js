import SuperAdminApp from "../../components/super-admin-app";
import { requireSuperAdminPage } from "../../lib/page-auth";

export const metadata = { title: "Super Admin overview" };
export default async function SuperAdminOverviewPage() { await requireSuperAdminPage(); return <SuperAdminApp initialSection="overview" />; }
