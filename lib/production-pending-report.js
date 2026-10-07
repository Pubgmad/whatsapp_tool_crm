import { query } from './db.js';
import { getPlatformOperationsSnapshot } from './platform-operations.js';
import { workspaceMmLiteOptimizerReport } from './mm-lite-optimizer.js';
import { shopifyProductionChecklist } from './shopify-production-checklist.js';
import { crmSyncProductionChecklist } from './crm-sync-production-checklist.js';
import { managedFlowRuntimeUrl } from './flow-runtime-url.js';

function item(id, area, title, status, detail = '', actions = []) {
  return { id, area, title, status, detail, actions };
}

/**
 * Code-derived production pendings for a workspace (ignores marketing parity registry).
 * status: open | blocked_external | ready
 */
export async function workspaceProductionPending(businessId) {
  const items = [];
  const platform = await getPlatformOperationsSnapshot();

  if (platform.worker.status !== 'ready') {
    items.push(item('worker', 'ops', 'Background worker', 'open', platform.worker.status, ['Start npm run worker on VPS', 'Check worker heartbeat in Production hub']));
  }
  if (!platform.database.isolationReady) {
    items.push(item('database_rls', 'ops', 'Database tenant isolation', 'open', 'App DB role may bypass RLS', ['Run db:init with app role grants']));
  }
  if (!platform.razorpayConfigured) {
    items.push(item('billing', 'commerce', 'Razorpay billing', 'open', 'Platform billing keys missing', ['Configure Razorpay in server env']));
  }

  const business = (await query('SELECT account_status, meta_connection_metadata FROM businesses WHERE id=$1', [businessId])).rows[0];
  if (!business || business.account_status === 'suspended') {
    return { items: [item('workspace', 'ops', 'Workspace active', 'open', 'Suspended or missing')], generatedAt: new Date().toISOString() };
  }

  const account = (
    await query(
      `SELECT capabilities, health_status FROM whatsapp_accounts WHERE business_id=$1 AND status='connected' ORDER BY is_default DESC LIMIT 1`,
      [businessId]
    )
  ).rows[0];
  if (!account) {
    items.push(item('waba', 'meta', 'WhatsApp connection', 'open', 'No connected WABA', ['Complete Meta Setup']));
  } else {
    if (account.health_status && account.health_status !== 'healthy') {
      items.push(item('meta_health', 'meta', 'Meta connection health', 'open', account.health_status, ['Run deep certification probe', 'Refresh token in Meta Setup']));
    }
    const mm = await workspaceMmLiteOptimizerReport(businessId);
    const mmStatus = mm?.eligibility?.status || account.capabilities?.marketing_messages_api?.status || 'UNKNOWN';
    if (mmStatus !== 'ONBOARDED') {
      items.push(item('mm_api', 'meta', 'Marketing Messages API', 'blocked_external', `Status: ${mmStatus}`, ['Request MM API in Meta Business Manager', 'Refresh entitlements in Capabilities']));
    }
    const groupsGranted = account.capabilities?.groups_messaging?.status === 'AVAILABLE' || account.capabilities?.whatsapp_groups?.status === 'AVAILABLE';
    const { workspaceFeatureFlags } = await import('./feature-controls.js');
    const flags = await workspaceFeatureFlags(businessId);
    const groupsEnabled = flags.whatsapp_groups;
    if (groupsEnabled && !groupsGranted) {
      items.push(item('groups_api', 'meta', 'WhatsApp Groups API', 'blocked_external', 'Feature enabled but WABA not granted Groups', ['Apply for Groups API with Meta']));
    }
  }

  const runtimeUrl = managedFlowRuntimeUrl();
  if (!runtimeUrl.ok) {
    items.push(item('flow_runtime_url', 'flows', 'Managed Flow runtime URL', 'open', runtimeUrl.reason, ['Set public HTTPS APP_URL', 'Publish Flows using runtime data endpoint']));
  }

  const ads = (await query('SELECT ad_account_id FROM whatsapp_ads_connections WHERE business_id=$1', [businessId])).rows[0];
  if (!ads?.ad_account_id) {
    items.push(item('ad_account', 'ads', 'CTWA ad account', 'open', 'No ad account linked', ['Connect ad account in Ads settings']));
  }

  const shopify = await shopifyProductionChecklist(businessId);
  items.push(...shopify);

  const crm = await crmSyncProductionChecklist(businessId);
  items.push(...crm);

  const aiSettings = (await query('SELECT autonomous_actions_enabled FROM ai_agent_settings WHERE business_id=$1', [businessId])).rows[0];
  const platformAutonomous = (await query("SELECT value FROM platform_settings WHERE key='ai_autonomous_actions_enabled'")).rows[0]?.value === true;
  if (aiSettings?.autonomous_actions_enabled && !platformAutonomous && process.env.AI_AUTONOMOUS_ACTIONS_ENABLED !== 'true') {
    items.push(item('ai_autonomous', 'ai', 'Autonomous AI actions', 'blocked_external', 'Tenant enabled but platform gate off', ['Enable platform ai_autonomous_actions_enabled']));
  }

  const sloLast = (await query("SELECT value FROM platform_settings WHERE key='slo_certification_last_run'")).rows[0]?.value;
  if (!sloLast) {
    items.push(item('slo_cert', 'ops', 'SLO load-test attestation', 'open', 'No recorded SLO run', ['node scripts/load-test-slo.mjs', 'Record in Super Admin SLO panel']));
  }

  const a11yLast = (await query("SELECT value FROM platform_settings WHERE key='a11y_e2e_last_run'")).rows[0]?.value;
  if (!a11yLast) {
    items.push(item('a11y_cert', 'ops', 'Accessibility E2E attestation', 'open', 'No recorded a11y matrix run', ['npm run test:e2e', 'node scripts/record-a11y-e2e.mjs']));
  }

  const openCount = items.filter((i) => i.status === 'open').length;
  const blockedCount = items.filter((i) => i.status === 'blocked_external').length;
  return {
    generatedAt: new Date().toISOString(),
    summary: { total: items.length, open: openCount, blockedExternal: blockedCount, ready: items.length === 0 },
    items
  };
}
