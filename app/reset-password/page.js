import AccountAccess from '@/components/account-access';
import { getPublicPlatformConfig } from '@/lib/platform';
export const metadata = { title: 'Choose a new password' };
export default async function ResetPasswordPage({ searchParams }) {
  const [query, platform] = await Promise.all([searchParams, getPublicPlatformConfig()]);
  return <AccountAccess mode='reset' token={query?.token || ''} brandName={platform.brand_name} />;
}
