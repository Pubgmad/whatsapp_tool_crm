import { syncTemplatesForBusiness } from './template-meta-sync.js';

export function buildMetaActivationChecklist(operations) {
  const account = operations.accounts?.find((item) => item.isDefault) || operations.accounts?.[0];
  const phone = operations.phoneNumbers?.find((item) => item.isDefault) || operations.phoneNumbers?.[0];
  const capabilities = new Map((operations.capabilities || []).map((item) => [item.key, item]));
  const mmStatus = account?.marketingMessagesStatus || 'UNKNOWN';
  const steps = [
    {
      id: 'connection',
      label: 'WhatsApp Business Account connected',
      status: account?.status === 'connected' ? 'pass' : 'fail',
      detail: account?.wabaId ? `WABA ${account.wabaId}` : 'Complete Embedded Signup or manual connection'
    },
    {
      id: 'token',
      label: 'Meta access token healthy',
      status: account?.token?.status === 'expired' ? 'fail' : account?.token?.status === 'expiring' ? 'warn' : account ? 'pass' : 'fail',
      detail: account?.token?.expiresAt ? `Expires ${account.token.expiresAt}` : 'Token expiry unknown'
    },
    {
      id: 'webhooks',
      label: 'WABA webhook subscription',
      status: account?.webhookSubscribed && account?.health?.reason !== 'webhook_unsubscribed' ? 'pass' : account?.health?.reason === 'webhook_unsubscribed' ? 'fail' : account?.webhookSubscribed ? 'warn' : 'fail',
      detail: account?.health?.lastWebhookAt ? `Last webhook ${account.health.lastWebhookAt}` : 'Use Refresh entitlements to repair subscription'
    },
    {
      id: 'phone',
      label: 'Default phone registered for Cloud API',
      status: phone?.registrationState === 'registered' ? 'pass' : phone ? 'warn' : 'fail',
      detail: phone ? `${phone.displayPhoneNumber || phone.phoneNumberId} · ${phone.messagingLimitTier}` : 'Sync phone numbers from Meta'
    },
    {
      id: 'templates',
      label: 'Approved templates available',
      status: capabilities.get('templates')?.status === 'available' ? 'pass' : 'warn',
      detail: 'Sync templates after App Review approvals'
    },
    {
      id: 'marketing_messages_api',
      label: 'Marketing Messages API (bulk marketing)',
      status: mmStatus === 'ONBOARDED' ? 'pass' : ['ELIGIBLE', 'PENDING'].includes(mmStatus) ? 'warn' : 'fail',
      detail: `Meta status: ${mmStatus}`
    },
    {
      id: 'native_flows',
      label: 'Published WhatsApp Flow',
      status: capabilities.get('native_flows')?.status === 'available' ? 'pass' : 'warn',
      detail: 'Create, upload, and publish a Flow in Meta Setup'
    },
    {
      id: 'ctwa',
      label: 'Click-to-WhatsApp ads linked',
      status: capabilities.get('ctwa')?.status === 'available' ? 'pass' : 'warn',
      detail: 'Connect ad account to default phone in Ads workspace'
    },
    {
      id: 'catalogs',
      label: 'Catalog / commerce',
      status: capabilities.get('catalogs')?.status === 'available' ? 'pass' : 'warn',
      detail: capabilities.get('catalogs')?.detail || 'Link a product catalog to the WABA'
    },
    {
      id: 'calling',
      label: 'WhatsApp Calling enabled',
      status: capabilities.get('calling')?.status === 'available' ? 'pass' : 'warn',
      detail: 'Enable calling in Meta Setup when your number is eligible'
    }
  ];
  const blockers = steps.filter((step) => step.status === 'fail');
  const warnings = steps.filter((step) => step.status === 'warn');
  return {
    steps,
    readyForMessaging: !steps.some((step) => step.status === 'fail' && ['connection', 'token', 'webhooks', 'phone'].includes(step.id)),
    blockerCount: blockers.length,
    warningCount: warnings.length
  };
}

export async function runMetaTemplateSync(businessId, accountId = '') {
  return syncTemplatesForBusiness(businessId, accountId);
}
