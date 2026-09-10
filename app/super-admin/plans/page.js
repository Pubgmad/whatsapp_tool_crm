import SuperAdminApp from "../../../components/super-admin-app";
import { requireSuperAdminPage } from "../../../lib/page-auth";

export const metadata = { title: "Subscription plans" };
export default async function SuperAdminPlansPage() { await requireSuperAdminPage(); return <SuperAdminApp initialSection="plans" />; }
