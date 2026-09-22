import SuperAdminApp from '@/components/super-admin-app';
import { requireSuperAdminPage } from '@/lib/page-auth';

export const metadata = { title: 'Super Admin security' };
export default async function SuperAdminSecurityPage() {
  await requireSuperAdminPage();
  return <SuperAdminApp initialSection='security' />;
}
