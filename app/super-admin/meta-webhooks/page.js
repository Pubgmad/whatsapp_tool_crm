import SuperAdminApp from '@/components/super-admin-app';
import { requireSuperAdminPage } from '@/lib/page-auth';

export const metadata = { title: 'Meta webhook operations' };

export default async function MetaWebhookOperationsPage() {
  await requireSuperAdminPage();
  return <SuperAdminApp initialSection="meta-webhooks" />;
}
