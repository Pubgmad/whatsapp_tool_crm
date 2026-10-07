import { query } from './db.js';
import { marketingMessagesReadiness, MM_API_OPTIMIZER_FEATURES } from './mm-api-readiness.js';
import { getPlatformSettingValue } from './platform.js';

export async function workspaceMmLiteOptimizerReport(businessId) {
  const account = (
    await query(
      `SELECT a.capabilities, a.waba_id, p.phone_number_id
       FROM whatsapp_accounts a
       JOIN whatsapp_phone_numbers p ON p.whatsapp_account_id=a.id AND p.business_id=a.business_id
       WHERE a.business_id=$1 AND p.is_default=TRUE AND a.status='connected' LIMIT 1`,
      [businessId]
    )
  ).rows[0];
  const readiness = marketingMessagesReadiness(account || {});
  const platformTtl = await getPlatformSettingValue('mm_marketing_message_ttl_seconds', null);
  const sendPath = readiness.sendPathReady ? 'marketing_messages_api' : 'standard_cloud_api';
  const features = MM_API_OPTIMIZER_FEATURES.map((feature) => ({
    ...feature,
    controlSurface: feature.managedIn === 'meta' ? 'meta_ads_manager' : 'crm',
    enabledInCrm: feature.id === 'time_to_live' && Number.isFinite(Number(platformTtl)) && Number(platformTtl) > 0
  }));
  return {
    sendPath,
    marketingMessagesStatus: readiness.status,
    platformTtlSeconds: Number.isFinite(Number(platformTtl)) ? Number(platformTtl) : null,
    optimizerFeatures: features,
    operatorNote: readiness.operatorNote,
    actions: [
      { id: 'refresh_entitlements', label: 'Refresh Meta entitlements', href: '/app/settings/whatsapp?section=capabilities' },
      { id: 'meta_docs', label: 'Meta Marketing Messages API docs', href: 'https://developers.facebook.com/docs/whatsapp/marketing-messages-api' }
    ]
  };
}
