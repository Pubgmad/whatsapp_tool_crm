import AccountAccess from '@/components/account-access';
export const metadata = { title: 'Verify email' };
export default async function VerifyEmailPage({ searchParams }) { const query = await searchParams; return <AccountAccess mode='verify' token={query?.token || ''} />; }
