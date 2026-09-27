import AccountAccess from '@/components/account-access';
import { getPublicPlatformConfig } from '@/lib/platform';
export const metadata = { title: 'Verify email' };
export default async function VerifyEmailPage({ searchParams }) {
  const [query, platform] = await Promise.all([searchParams, getPublicPlatformConfig()]);
  return <AccountAccess mode='verify' token={query?.token || ''} brandName={platform.brand_name} />;
}
