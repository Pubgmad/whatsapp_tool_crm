import SuperAdminApp from '../../../components/super-admin-app';
import { requireSuperAdminPage } from '../../../lib/page-auth';

export const metadata = { title: 'Feature controls' };
export default async function SuperAdminFeaturesPage() {
  await requireSuperAdminPage();
  return <SuperAdminApp initialSection='features' />;
}
