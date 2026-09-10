import SuperAdminApp from "../../../components/super-admin-app";
import { requireSuperAdminPage } from "../../../lib/page-auth";

export const metadata = { title: "Platform content" };
export default async function SuperAdminContentPage() { await requireSuperAdminPage(); return <SuperAdminApp initialSection="content" />; }
