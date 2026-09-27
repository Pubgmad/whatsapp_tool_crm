import AccountAccess from '@/components/account-access';
import { getPublicPlatformConfig } from '@/lib/platform';
export const metadata = { title: 'Resend verification email' };
export default async function ResendVerificationPage() {
  const platform = await getPublicPlatformConfig();
  return <AccountAccess mode='resend' brandName={platform.brand_name} />;
}
