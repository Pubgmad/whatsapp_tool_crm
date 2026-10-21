import { AppError, errorJson, id, query, transaction } from './db.js';
import { requireSession } from './auth.js';
import { defaultDisabledWorkspaceFeatures, operationalPolicy } from './operational-policy.js';
import {
  WORKSPACE_FEATURES,
  featureSettingKey,
  resolveFeatureGate,
  planAllowsFeature,
  planEntitlementKeys,
  planMarketingFeatures
} from './plan-features.js';
import { DEFAULT_FREE_PLAN_CODE } from './default-plans.js';

export {
  WORKSPACE_FEATURES,
  featureSettingKey,
  resolveFeatureGate,
  planAllowsFeature,
  planEntitlementKeys,
  planMarketingFeatures
};

const FEATURE_DEFAULT_ENABLED = Object.freeze(
  Object.fromEntries(
    Object.keys(WORKSPACE_FEATURES).map((feature) => [
      feature,
      !defaultDisabledWorkspaceFeatures(WORKSPACE_FEATURES).has(feature)
    ])
  )
);

function parseFeaturesJson(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return [];
}

function subscriptionEntitlementActive(row) {
  if (!row) return false;
  const now = Date.now();
  if (row.status === 'active' && (!row.current_period_end || new Date(row.current_period_end).getTime() > now)) {
    return true;
  }
  if (row.status === 'trialing' && row.trial_ends_at && new Date(row.trial_ends_at).getTime() > now) {
    return true;
  }
  return false;
}

/**
 * Features granted by the business subscription plan.
 * Expired / canceled / pending subscriptions fall back to Free Forever entitlements
 * (or empty deny-all keys when Free is missing) so paid modules cannot linger.
 * Returns null when subscription enforcement is off (no plan-level gate).
 */
async function planFeaturesForBusiness(businessId, run = query) {
  if (!businessId || !operationalPolicy().subscriptionEnforcementEnabled) return null;

  const row = (
    await run(
      `SELECT bs.status, bs.trial_ends_at, bs.current_period_end, sp.features AS plan_features, sp.code AS plan_code,
              free.features AS free_features
         FROM businesses b
         LEFT JOIN business_subscriptions bs ON bs.business_id = b.id
         LEFT JOIN subscription_plans sp ON sp.id = bs.plan_id
         LEFT JOIN subscription_plans free ON free.code = $2 AND free.is_active = TRUE
        WHERE b.id = $1
        LIMIT 1`,
      [businessId, DEFAULT_FREE_PLAN_CODE]
    )
  ).rows[0];

  if (!row) return parseFeaturesJson(null);

  if (subscriptionEntitlementActive(row)) {
    return parseFeaturesJson(row.plan_features);
  }

  // Inactive subscription: only Free Forever (or empty) entitlements apply.
  if (row.free_features != null) return parseFeaturesJson(row.free_features);
  return [];
}

export async function workspaceFeatureFlags(businessId = null, run = query) {
  const keys = Object.keys(WORKSPACE_FEATURES);
  const result = await run('SELECT key,value FROM platform_settings WHERE key=ANY($1::text[])', [
    keys.map(featureSettingKey)
  ]);
  const values = new Map(result.rows.map((row) => [row.key, row.value]));
  const overrides = businessId
    ? (await run('SELECT feature_overrides FROM businesses WHERE id=$1', [businessId])).rows[0]
        ?.feature_overrides || {}
    : {};
  const planFeatures = businessId ? await planFeaturesForBusiness(businessId, run) : null;
  return Object.fromEntries(
    keys.map((feature) => {
      const platformEnabled = values.has(featureSettingKey(feature))
        ? values.get(featureSettingKey(feature)) !== false
        : FEATURE_DEFAULT_ENABLED[feature];
      const planAllows = planFeatures == null ? true : planAllowsFeature(planFeatures, feature);
      const tenantOverride = Object.hasOwn(overrides, feature) ? overrides[feature] : null;
      return [feature, resolveFeatureGate({ platformEnabled, planAllows, tenantOverride })];
    })
  );
}

/**
 * Detailed gate reasons for upgrade UX (plan vs platform vs tenant).
 */
export async function workspaceFeatureGateDetails(businessId = null, run = query) {
  const keys = Object.keys(WORKSPACE_FEATURES);
  const result = await run('SELECT key,value FROM platform_settings WHERE key=ANY($1::text[])', [
    keys.map(featureSettingKey)
  ]);
  const values = new Map(result.rows.map((row) => [row.key, row.value]));
  const overrides = businessId
    ? (await run('SELECT feature_overrides FROM businesses WHERE id=$1', [businessId])).rows[0]
        ?.feature_overrides || {}
    : {};
  const planFeatures = businessId ? await planFeaturesForBusiness(businessId, run) : null;
  return Object.fromEntries(
    keys.map((feature) => {
      const platformEnabled = values.has(featureSettingKey(feature))
        ? values.get(featureSettingKey(feature)) !== false
        : FEATURE_DEFAULT_ENABLED[feature];
      const planAllows = planFeatures == null ? true : planAllowsFeature(planFeatures, feature);
      const tenantOverride = Object.hasOwn(overrides, feature) ? overrides[feature] : null;
      const enabled = resolveFeatureGate({ platformEnabled, planAllows, tenantOverride });
      let reason = null;
      if (!platformEnabled) reason = 'platform';
      else if (!planAllows) reason = 'plan';
      else if (tenantOverride === false) reason = 'tenant';
      return [feature, { enabled, reason, label: WORKSPACE_FEATURES[feature] }];
    })
  );
}

export async function assertWorkspaceFeature(feature, businessId = null, run = query) {
  if (!Object.hasOwn(WORKSPACE_FEATURES, feature)) {
    throw new AppError('Unknown workspace feature.', 500, 'FEATURE_UNKNOWN');
  }
  const details = await workspaceFeatureGateDetails(businessId, run);
  const gate = details[feature];
  if (gate?.enabled) return;
  if (gate?.reason === 'plan') {
    throw new AppError(
      `${WORKSPACE_FEATURES[feature]} is not included in your current plan. Open Billing to review upgrades.`,
      403,
      'FEATURE_PLAN_REQUIRED'
    );
  }
  if (gate?.reason === 'tenant') {
    throw new AppError(
      `${WORKSPACE_FEATURES[feature]} is disabled for this workspace.`,
      403,
      'FEATURE_DISABLED'
    );
  }
  throw new AppError(
    `${WORKSPACE_FEATURES[feature]} is disabled by the platform administrator.`,
    403,
    'FEATURE_DISABLED'
  );
}

export async function saveCompanyFeatureOverride(
  { businessId, feature, enabled, adminId },
  transact = transaction
) {
  if (!Object.hasOwn(WORKSPACE_FEATURES, feature) || ![true, false, null].includes(enabled)) {
    throw new AppError('Choose a valid feature and setting.', 400, 'VALIDATION_ERROR');
  }
  await transact(async (client) => {
    const result = await client.query(
      `UPDATE businesses SET feature_overrides = CASE WHEN $3::boolean IS NULL THEN feature_overrides - $2 ELSE jsonb_set(feature_overrides,ARRAY[$2],to_jsonb($3::boolean),true) END, updated_at=NOW() WHERE id=$1 RETURNING id`,
      [businessId, feature, enabled]
    );
    if (!result.rowCount) throw new AppError('Company not found.', 404, 'COMPANY_NOT_FOUND');
    await client.query('INSERT INTO audit_logs (id,business_id,action,metadata) VALUES ($1,$2,$3,$4)', [
      id('a'),
      businessId,
      'super_admin_feature_updated',
      JSON.stringify({ feature, enabled, superAdminId: adminId })
    ]);
  });
}

export function withWorkspaceFeature(feature, handler) {
  return async (...args) => {
    try {
      const session = await requireSession(args[0]);
      await assertWorkspaceFeature(feature, session.businessId);
      return await handler(...args);
    } catch (error) {
      return errorJson(error);
    }
  };
}
