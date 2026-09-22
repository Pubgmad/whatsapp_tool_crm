import AccountAccess from '@/components/account-access';
export const metadata = { title: 'Choose a new password' };
export default async function ResetPasswordPage({ searchParams }) { const query = await searchParams; return <AccountAccess mode='reset' token={query?.token || ''} />; }
