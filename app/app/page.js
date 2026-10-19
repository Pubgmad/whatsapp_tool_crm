import { redirect } from 'next/navigation';

/** /app entry opens workspace management (Meta connection), not Inbox or Overview. */
export default function AppIndexPage() {
  redirect('/app/settings/whatsapp');
}
