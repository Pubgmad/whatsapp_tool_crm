import { redirect } from 'next/navigation';

export const metadata = { title: 'Workspace' };

/**
 * Compatibility shim: the generic Overview dashboard is no longer a user destination.
 * Bookmarks and legacy links land on workspace / Meta connection management.
 */
export default function DashboardPage() {
  redirect('/app/settings/whatsapp');
}
