import { AppError, errorJson, id, query, transaction } from './db.js';
import { requireSession } from './auth.js';
import { defaultDisabledWorkspaceFeatures } from './operational-policy.js';

export const WORKSPACE_FEATURES = Object.freeze({
  inbox: 'Shared inbox and replies',
  templates: 'WhatsApp templates',
  segments: 'Audience segments and retargeting',
  whatsapp_flows: 'Native WhatsApp Flows',
  entry_points: 'Links, QR codes and widgets',
  ads: 'Click-to-WhatsApp ads',
  calling: 'WhatsApp calling',
  commerce: 'WhatsApp commerce',
  conversions: 'WhatsApp conversions',
  automation: 'WhatsApp automation',
  campaigns: 'WhatsApp campaigns',
  marketing_messages: 'Marketing Messages API campaigns',
  connectors: 'Store connectors',
  checkout_recovery: 'WhatsApp checkout recovery',
  ai_agent: 'AI support assistant (drafts and knowledge)',
  ai_auto_reply: 'Autonomous AI WhatsApp replies',
  dialogflow_bot: 'Dialogflow CX WhatsApp bot',
  webviews: 'WhatsApp hosted pages',
  crm_sync: 'External CRM contact sync',
  whatsapp_groups: 'WhatsApp Groups (Cloud API)'
});

const FEATURE_DEFAULT_ENABLED = Object.freeze(
  Object.fromEntries(
    Object.keys(WORKSPACE_FEATURES).map((feature) => [
      feature,
      !defaultDisabledWorkspaceFeatures(WORKSPACE_FEATURES).has(feature)
    ])
  )
);

export const featureSettingKey = feature => `feature_${feature}_enabled`;

export async function workspaceFeatureFlags(businessId = null, run = query) {
  const keys = Object.keys(WORKSPACE_FEATURES);
  const result = await run('SELECT key,value FROM platform_settings WHERE key=ANY($1::text[])', [keys.map(featureSettingKey)]);
  const values = new Map(result.rows.map(row => [row.key, row.value]));
  const overrides = businessId ? (await run('SELECT feature_overrides FROM businesses WHERE id=$1', [businessId])).rows[0]?.feature_overrides || {} : {};
  return Object.fromEntries(keys.map(feature => [
    feature,
    (values.has(featureSettingKey(feature)) ? values.get(featureSettingKey(feature)) !== false : FEATURE_DEFAULT_ENABLED[feature]) &&
      overrides[feature] !== false
  ]));
}

export async function assertWorkspaceFeature(feature, businessId = null, run = query) {
  if (!Object.hasOwn(WORKSPACE_FEATURES, feature)) throw new AppError('Unknown workspace feature.', 500, 'FEATURE_UNKNOWN');
  const flags = await workspaceFeatureFlags(businessId, run);
  if (!flags[feature]) throw new AppError(`${WORKSPACE_FEATURES[feature]} is disabled by the platform administrator.`, 403, 'FEATURE_DISABLED');
}

export async function saveCompanyFeatureOverride({ businessId, feature, enabled, adminId }, transact = transaction) {
  if (!Object.hasOwn(WORKSPACE_FEATURES, feature) || ![true, false, null].includes(enabled)) throw new AppError('Choose a valid feature and setting.', 400, 'VALIDATION_ERROR');
  await transact(async client => {
    const result = await client.query(`UPDATE businesses SET feature_overrides = CASE WHEN $3::boolean IS NULL THEN feature_overrides - $2 ELSE jsonb_set(feature_overrides,ARRAY[$2],to_jsonb($3::boolean),true) END, updated_at=NOW() WHERE id=$1 RETURNING id`, [businessId, feature, enabled]);
    if (!result.rowCount) throw new AppError('Company not found.', 404, 'COMPANY_NOT_FOUND');
    await client.query('INSERT INTO audit_logs (id,business_id,action,metadata) VALUES ($1,$2,$3,$4)', [id('a'), businessId, 'super_admin_feature_updated', JSON.stringify({ feature, enabled, superAdminId: adminId })]);
  });
}

export function withWorkspaceFeature(feature, handler) {
  return async (...args) => {
    try {
      const session = await requireSession(args[0]);
      await assertWorkspaceFeature(feature, session.businessId);
      return await handler(...args);
    } catch (error) { return errorJson(error); }
  };
}
