import SuperAdminApp from '../../../components/super-admin-app';
import { requireSuperAdminPage } from '../../../lib/page-auth';

export const metadata = { title: 'Concierge requests' };
export default async function SuperAdminConciergePage() {
  await requireSuperAdminPage();
  return <SuperAdminApp initialSection="concierge" />;
}
