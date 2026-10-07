import { query } from './db.js';
import { dialogflowPlatformConfigured } from './dialogflow-bot.js';
import { probeMetaConnection } from './meta-health.js';
import { getPlatformOperationsSnapshot } from './platform-operations.js';

function clean(value) {
  return String(value || '').trim();
}

function check(id, label, pass, detail = '') {
  return { id, label, pass: Boolean(pass), detail: String(detail || '').slice(0, 500) };
}

export async function workspaceProductionCertification(businessId) {
  const checks = [];
  const platform = await getPlatformOperationsSnapshot();

  checks.push(check('worker', 'Background worker heartbeat', platform.worker.status === 'ready', platform.worker.status));
  checks.push(check('database', 'Database tenant isolation', platform.database.isolationReady, platform.database.isolationReady ? 'ok' : 'app role must not bypass RLS'));
  checks.push(check('meta_webhooks', 'Meta webhook queue healthy', platform.metaWebhooks.lagOk, `queued=${platform.metaWebhooks.queued} failed=${platform.metaWebhooks.failed}`));
  checks.push(check('billing', 'Razorpay billing configured', platform.razorpayConfigured, platform.billingProvider));

  const business = (await query('SELECT id,name,account_status FROM businesses WHERE id=$1', [businessId])).rows[0];
  if (!business) return { ready: false, checks: [check('workspace', 'Workspace', false, 'not found')], generatedAt: new Date().toISOString() };

  checks.push(check('workspace_status', 'Workspace active', business.account_status !== 'suspended', business.account_status));

  const accounts = (await query(
    `SELECT a.waba_id,a.access_token_encrypted,a.health_status,a.health_reason,p.phone_number_id,p.registration_state
     FROM whatsapp_accounts a
     LEFT JOIN whatsapp_phone_numbers p ON p.whatsapp_account_id=a.id AND p.business_id=a.business_id AND p.is_default=TRUE
     WHERE a.business_id=$1 AND a.status='connected' ORDER BY a.created_at LIMIT 3`,
    [businessId]
  )).rows;

  if (!accounts.length) {
    checks.push(check('whatsapp_connection', 'Connected WhatsApp Business Account', false, 'Connect a WABA in Meta Setup'));
  } else {
    let metaPass = true;
    let metaDetail = '';
    for (const account of accounts) {
      try {
        const probe = await probeMetaConnection(account.waba_id, account.access_token_encrypted);
        if (probe.status !== 'healthy') {
          metaPass = false;
          metaDetail = probe.reason || probe.status;
        }
      } catch (error) {
        metaPass = false;
        metaDetail = error.code || error.message;
      }
    }
    checks.push(check('whatsapp_meta', 'Meta token, scopes and webhook subscription', metaPass, metaDetail || `${accounts.length} connected account(s)`));
    const registered = accounts.some((row) => row.registration_state === 'registered' && row.phone_number_id);
    checks.push(check('whatsapp_number', 'Registered WhatsApp sending number', registered, registered ? 'ok' : 'Register at least one phone number'));
  }

  const shopify = (await query(
    `SELECT c.id,c.enabled,c.last_error FROM provider_connectors c
     WHERE c.business_id=$1 AND c.provider='shopify' AND c.enabled ORDER BY c.created_at DESC LIMIT 1`,
    [businessId]
  )).rows[0];
  if (shopify) {
    checks.push(check('shopify', 'Shopify connector enabled', !shopify.last_error, shopify.last_error || 'connected'));
  }

  const crm = (await query(
    `SELECT provider,enabled,last_error,last_sync_at FROM crm_connections WHERE business_id=$1 AND enabled`,
    [businessId]
  )).rows;
  for (const row of crm) {
    checks.push(
      check(
        `crm_${row.provider}`,
        `${row.provider} CRM sync`,
        !row.last_error && Boolean(row.last_sync_at),
        row.last_error || (row.last_sync_at ? `last sync ${row.last_sync_at}` : 'run initial sync')
      )
    );
  }

  const ai = (await query(
    'SELECT dialogflow_enabled,dialogflow_agent_id FROM ai_agent_settings WHERE business_id=$1',
    [businessId]
  )).rows[0];
  if (ai?.dialogflow_enabled) {
    checks.push(
      check(
        'dialogflow',
        'Dialogflow CX agent configured',
        dialogflowPlatformConfigured() && /^[a-zA-Z0-9_-]{10,80}$/.test(clean(ai.dialogflow_agent_id)),
        dialogflowPlatformConfigured() ? 'platform credentials present' : 'set DIALOGFLOW_PROJECT_ID and GOOGLE_DIALOGFLOW_SERVICE_ACCOUNT_JSON'
      )
    );
  }

  const appUrl = clean(process.env.APP_URL);
  checks.push(check('app_url', 'Public HTTPS APP_URL for webviews and OAuth', appUrl.startsWith('https://'), appUrl || 'unset'));

  const turnConfigured = Boolean(clean(process.env.WHATSAPP_CALL_TURN_URLS) && clean(process.env.WHATSAPP_CALL_TURN_SECRET));
  checks.push(check('calling_turn', 'WhatsApp calling TURN configured', turnConfigured, turnConfigured ? 'ok' : 'set WHATSAPP_CALL_TURN_URLS and WHATSAPP_CALL_TURN_SECRET'));

  const { campaignQueueMetrics } = await import('./campaign-operations.js');
  const campaigns = await campaignQueueMetrics();
  checks.push(check('campaign_queue', 'Campaign queue lag acceptable', campaigns.lagOk, `queued=${campaigns.queued_jobs} scheduled=${campaigns.scheduled_campaigns}`));

  const { platformA11yCertificationStatus } = await import('./a11y-certification.js');
  const a11y = await platformA11yCertificationStatus();
  checks.push(check('a11y_e2e', 'Accessibility E2E matrix recorded', a11y.certified, a11y.lastRunAt || 'run npm run test:e2e with A11Y_E2E_REPORT=1'));

  const ready = checks.every((item) => item.pass);
  return { ready, businessId, businessName: business.name, checks, generatedAt: new Date().toISOString() };
}

export async function runPlatformProductionCertificationSample(businessId) {
  if (!businessId) {
    const row = (await query("SELECT id FROM businesses WHERE account_status<>'suspended' ORDER BY created_at LIMIT 1")).rows[0];
    businessId = row?.id;
  }
  if (!businessId) return { ready: false, checks: [check('workspace', 'Sample workspace', false, 'none')], generatedAt: new Date().toISOString() };
  return workspaceProductionCertification(businessId);
}
