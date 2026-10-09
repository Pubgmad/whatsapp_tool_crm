const integerPolicies = Object.freeze({
  workerPollIntervalMs: { env: 'JOB_POLL_INTERVAL_MS', default: 15000, min: 5000, max: 300000 },
  workerRetentionIntervalHours: { env: 'WORKER_RETENTION_INTERVAL_HOURS', default: 24, min: 1, max: 168 },
  workerJobConcurrency: { env: 'JOB_CONCURRENCY', default: 4, min: 1, max: 8 },
  workerJobBatchSize: { env: 'JOB_BATCH_SIZE', default: 25, min: 1, max: 100 },
  campaignQueueBatchSize: { env: 'CAMPAIGN_QUEUE_BATCH_SIZE', default: 25, min: 1, max: 100 },
  automationQueueBatchSize: { env: 'AUTOMATION_QUEUE_BATCH_SIZE', default: 25, min: 1, max: 100 },
  retentionBatchSize: { env: 'RETENTION_BATCH_SIZE', default: 500, min: 1, max: 5000 },
  trackedLinkRetentionDays: { env: 'TRACKED_LINK_RETENTION_DAYS', default: 30, min: 1, max: 3650 },
  dynamicAudienceSyncMinutes: { env: 'DYNAMIC_AUDIENCE_SYNC_MINUTES', default: 15, min: 1, max: 1440 },
  integrationDispatchWindowSeconds: { env: 'INTEGRATION_DISPATCH_WINDOW_SECONDS', default: 120, min: 30, max: 900 },
  integrationReservationTtlSeconds: { env: 'INTEGRATION_RESERVATION_TTL_SECONDS', default: 300, min: 60, max: 3600 },
  workspaceApiKeyExpiryDays: { env: 'WORKSPACE_API_KEY_EXPIRY_DAYS', default: 90, min: 1, max: 365 },
  workspaceApiKeyRpm: { env: 'WORKSPACE_API_KEY_RPM', default: 60, min: 1, max: 1000 },
  campaignMaxScheduleDays: { env: 'CAMPAIGN_MAX_SCHEDULE_DAYS', default: 60, min: 1, max: 365 },
  crmSyncIntervalMinutes: { env: 'CRM_SYNC_INTERVAL_MINUTES', default: 5, min: 1, max: 1440 },
  crmSyncClaimMinutes: { env: 'CRM_SYNC_CLAIM_MINUTES', default: 2, min: 1, max: 60 },
  audienceTagJobBatchSize: { env: 'AUDIENCE_TAG_JOB_BATCH_SIZE', default: 5, min: 1, max: 50 }
});

const DEFAULT_DISABLED_FEATURES = Object.freeze(['checkout_recovery', 'whatsapp_groups']);
const GRAPH_VERSION_DEFAULT = 'v26.0';

function integerValue(name, env = process.env) {
  const policy = integerPolicies[name];
  const raw = env[policy.env];
  if (raw === undefined || String(raw).trim() === '') return policy.default;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= policy.min && value <= policy.max ? value : policy.default;
}

function booleanValue(name, fallback, env = process.env) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  if (String(raw).toLowerCase() === 'true') return true;
  if (String(raw).toLowerCase() === 'false') return false;
  return fallback;
}

export function operationalPolicy(env = process.env) {
  return Object.freeze({
    ...Object.fromEntries(Object.keys(integerPolicies).map(name => [name, integerValue(name, env)])),
    subscriptionEnforcementEnabled: booleanValue('SUBSCRIPTION_ENFORCEMENT_ENABLED', true, env),
    metaGraphApiVersion: metaGraphApiVersion(env)
  });
}

export function metaGraphApiVersion(env = process.env) {
  const value = String(env.META_GRAPH_API_VERSION || '').trim();
  return /^v(?:[2-9]\d|1[8-9])\.0$/.test(value) ? value : GRAPH_VERSION_DEFAULT;
}

export function defaultDisabledWorkspaceFeatures(knownFeatures, env = process.env) {
  const raw = env.PLATFORM_DEFAULT_DISABLED_FEATURES;
  if (raw === undefined || !String(raw).trim()) return new Set(DEFAULT_DISABLED_FEATURES);
  const requested = String(raw).split(',').map(value => value.trim()).filter(Boolean);
  return new Set(requested.filter(feature => Object.hasOwn(knownFeatures, feature)));
}

export function operationalPolicyDiagnostics(env = process.env) {
  const values = operationalPolicy(env);
  const settings = Object.fromEntries(Object.entries(integerPolicies).map(([name, policy]) => {
    const configured = env[policy.env];
    const parsed = Number(configured);
    return [name, {
      env: policy.env,
      effective: values[name],
      default: policy.default,
      min: policy.min,
      max: policy.max,
      configured: configured === undefined || String(configured).trim() === '' ? false : true,
      valid: configured === undefined || String(configured).trim() === '' ||
        (Number.isSafeInteger(parsed) && parsed >= policy.min && parsed <= policy.max)
    }];
  }));
  const graphConfigured = String(env.META_GRAPH_API_VERSION || '').trim();
  const subscriptionConfigured = String(env.SUBSCRIPTION_ENFORCEMENT_ENABLED || '').trim().toLowerCase();
  return {
    settings,
    metaGraphApiVersion: {
      env: 'META_GRAPH_API_VERSION',
      effective: values.metaGraphApiVersion,
      default: GRAPH_VERSION_DEFAULT,
      valid: !graphConfigured || /^v(?:[2-9]\d|1[8-9])\.0$/.test(graphConfigured)
    },
    subscriptionEnforcement: {
      env: 'SUBSCRIPTION_ENFORCEMENT_ENABLED',
      effective: values.subscriptionEnforcementEnabled,
      default: true,
      valid: !subscriptionConfigured || ['true', 'false'].includes(subscriptionConfigured)
    }
  };
}

const platformIntegerBounds = Object.freeze({
  security_event_retention_days: [1, 3650],
  webhook_event_retention_days: [1, 3650],
  completed_job_retention_days: [1, 3650],
  message_retention_days: [0, 3650],
  message_usage_retention_days: [0, 3650],
  workspace_deletion_grace_days: [0, 90],
  campaign_queue_max_lag_seconds: [60, 86400]
});

export function platformOperationalValueIsValid(key, value) {
  const bounds = platformIntegerBounds[key];
  return !bounds || (Number.isSafeInteger(value) && value >= bounds[0] && value <= bounds[1]);
}
