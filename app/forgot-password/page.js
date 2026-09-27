import AccountAccess from '@/components/account-access';
import { getPublicPlatformConfig } from '@/lib/platform';
export const metadata = { title: 'Reset password' };
export default async function ForgotPasswordPage() {
  const platform = await getPublicPlatformConfig();
  return <AccountAccess mode='request' brandName={platform.brand_name} />;
}
