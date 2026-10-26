import { query } from './db.js';
import { workerIsFresh } from './health.js';

function clean(value) {
  return String(value || '').trim();
}

function item(id, label, status, detail = '', operatorHint = '', observedAt = null) {
  return {
    id,
    label,
    status,
    detail: String(detail || '').slice(0, 600),
    operatorHint: String(operatorHint || '').slice(0, 400),
    observedAt: observedAt || null
  };
}

export function appUrlState(rawValue = process.env.APP_URL) {
  const raw = clean(rawValue);
  if (!raw) return { ok: false, https: false, url: '', webhookUrl: '' };
  try {
    const url = new URL(raw);
    const https = url.protocol === 'https:';
    return { ok: true, https, url: url.origin, webhookUrl: `${url.origin}/api/webhooks/meta` };
  } catch {
    return { ok: false, https: false, url: raw, webhookUrl: '' };
  }
}

export function secretConfigured(name, env = process.env) {
  const value = clean(env[name]);
  if (!value || value.startsWith('replace-with') || value.startsWith('your-')) return false;
  return true;
}

const CORE_IDS = new Set([
  'app_url',
  'meta_app',
  'webhook_endpoint',
  'webhook_observed',
  'worker',
  'waba',
  'token',
  'webhook_subscribed',
  'sending_number'
]);

export function summarizeReadiness(checks) {
  const core = checks.filter((check) => CORE_IDS.has(check.id));
  const blocked = core.some((check) => check.status === 'blocked');
  const unverified = core.some((check) => check.status === 'not_verified');
  const summary = blocked ? 'blocked' : unverified ? 'not_verified' : 'ready';
  return { summary, liveVerified: summary === 'ready' };
}

/**
 * Configuration, eligibility, and observed evidence are separate.
 * Optional Flows and hosted pages do not block core WhatsApp readiness.
 * Absence of recent traffic does not erase an earlier signed webhook observation.
 */
export function buildReadinessChecks({
  production = false,
  app,
  secrets,
  workerFresh = false,
  workerErrors = [],
  workerObservedAt = null,
  account = null,
  flows = { total: 0, published: 0 },
  webviews = { total: 0 },
  now = new Date()
}) {
  const checks = [];
  if (!app.ok) {
    checks.push(item('app_url', 'Public website URL', 'blocked', 'Public website URL is missing or invalid', 'Set APP_URL to the public CRM origin'));
  } else if (!app.https && production) {
    checks.push(item('app_url', 'Secure website URL', 'blocked', 'Website must use HTTPS in production', 'Meta webhooks require an https:// APP_URL in production'));
  } else if (!app.https) {
    checks.push(item('app_url', 'Secure website URL', 'not_verified', 'Website is HTTP (local development only)', 'Use HTTPS before Meta live verification'));
  } else {
    checks.push(item('app_url', 'Secure website URL', 'ready', 'HTTPS website URL is configured'));
  }

  checks.push(item(
    'meta_app',
    'Meta app credentials',
    secrets.appId && secrets.appSecret ? 'ready' : production ? 'blocked' : 'not_verified',
    secrets.appId && secrets.appSecret ? 'Meta app credentials are configured' : 'Meta app credentials are incomplete',
    'Set META_APP_ID and META_APP_SECRET on the server. This check does not display the secret.'
  ));

  checks.push(item(
    'webhook_endpoint',
    'Webhook URL configured',
    app.ok && (app.https || !production) ? 'ready' : 'blocked',
    app.ok ? 'Webhook endpoint is ready for Meta subscription' : 'Webhook endpoint unavailable',
    'Subscribe the HTTPS webhook URL in the Meta app dashboard. Configuration alone is not proof of delivery.'
  ));

  if (!account) {
    checks.push(item('waba', 'WhatsApp account connected', 'not_verified', 'No connected WhatsApp Business Account', 'Meta Setup → Cloud API or coexistence'));
    checks.push(item('token', 'Access token', 'not_verified', 'No connected account to check', 'Connect WhatsApp'));
    checks.push(item('webhook_subscribed', 'App subscribed to WhatsApp account', 'not_verified', 'Not connected', 'Complete Embedded Signup'));
    checks.push(item('sending_number', 'Registered sending number', 'not_verified', 'No number', 'Meta Setup → Numbers'));
    checks.push(item('webhook_observed', 'Signed webhook observed', 'not_verified', 'No webhook has been recorded for this account', 'Send a test message after the webhook is subscribed'));
  } else {
    const healthy = !account.health_status || account.health_status === 'healthy';
    checks.push(item(
      'waba',
      'WhatsApp account connected',
      account.waba_id && account.status !== 'revoked' ? (healthy ? 'ready' : 'not_verified') : 'blocked',
      `WhatsApp account linked · health ${account.health_status || 'unknown'}`,
      'Run Connection check after connect',
      account.health_checked_at || null
    ));
    const expiresAt = account.token_expires_at ? new Date(account.token_expires_at) : null;
    const expired = expiresAt && expiresAt.getTime() <= now.getTime();
    checks.push(item(
      'token',
      'Access token',
      !account.access_token_present ? 'blocked' : expired ? 'blocked' : 'ready',
      !account.access_token_present ? 'Token missing' : expired ? 'Token expiry has passed' : expiresAt ? `Expires ${expiresAt.toISOString()}` : 'Meta did not return an expiry',
      expired || !account.access_token_present ? 'Reconnect WhatsApp' : 'Reconnect when Meta reports the token is invalid',
      expiresAt ? expiresAt.toISOString() : null
    ));
    checks.push(item(
      'webhook_subscribed',
      'App subscribed to WhatsApp account',
      account.webhook_subscribed ? 'ready' : 'not_verified',
      account.webhook_subscribed ? 'Subscribed flag is set' : 'Subscription has not been confirmed in the CRM',
      'Complete Embedded Signup or subscribe the app, then run Connection check'
    ));
    const registered = account.registration_state === 'registered' && account.phone_number_id;
    checks.push(item(
      'sending_number',
      'Registered sending number',
      registered ? 'ready' : 'not_verified',
      registered ? account.display_phone_number || account.phone_number_id : 'Register a phone number on the WABA',
      'Meta Setup → Numbers'
    ));
    const observedAt = account.last_message_webhook_at || account.last_webhook_at || null;
    checks.push(item(
      'webhook_observed',
      'Signed webhook observed',
      observedAt ? 'ready' : 'not_verified',
      observedAt ? `Last event ${account.last_webhook_field || 'recorded'}` : 'No signed webhook has been recorded yet. Quiet traffic is not a failure.',
      'Send a template to a consented test number and confirm the status callback',
      observedAt
    ));
  }

  checks.push(item(
    'worker',
    'Queue worker',
    workerFresh ? (workerErrors.length ? 'not_verified' : 'ready') : 'blocked',
    workerFresh
      ? `Heartbeat present${workerErrors.length ? `; last cycle errors: ${workerErrors.join(', ')}` : ''}`
      : 'No fresh worker heartbeat',
    'Run the worker process against this APP_URL',
    workerObservedAt
  ));

  checks.push(item(
    'published_flows',
    'Published Meta Flows',
    Number(flows.published) > 0 ? 'ready' : 'not_applicable',
    `${flows.published || 0} published / ${flows.total || 0} total`,
    'Flows are optional. Publish one only if the submission includes Flows.'
  ));
  checks.push(item(
    'hosted_webviews',
    'Hosted pages',
    Number(webviews.total) > 0 ? 'ready' : 'not_applicable',
    `${webviews.total || 0} hosted page(s)`,
    'Optional. In-chat WebView chrome stays Meta-controlled.'
  ));
  checks.push(item(
    'in_chat_webview_chrome',
    'Native in-chat WebView chrome',
    'not_applicable',
    'Chrome and navigation are owned by WhatsApp. The CRM supplies the hosted page only.',
    'Do not treat this as a CRM configuration failure.'
  ));
  return checks;
}

export async function workspaceLiveMetaReadiness(businessId) {
  const app = appUrlState();
  const production = process.env.NODE_ENV === 'production';
  const heartbeat = (await query("SELECT last_success_at,last_cycle_errors FROM worker_heartbeats WHERE worker_name='queue'")).rows[0];
  const workerFresh = workerIsFresh(heartbeat?.last_success_at);
  const workerErrors = heartbeat?.last_cycle_errors && typeof heartbeat.last_cycle_errors === 'object' ? Object.keys(heartbeat.last_cycle_errors) : [];
  const account = (
    await query(
      `SELECT a.waba_id,a.status,a.health_status,a.health_checked_at,a.webhook_subscribed,a.token_expires_at,
              (a.access_token_encrypted <> '') AS access_token_present,
              a.last_webhook_at,a.last_message_webhook_at,a.last_webhook_field,
              p.phone_number_id,p.registration_state,p.display_phone_number
       FROM whatsapp_accounts a
       LEFT JOIN LATERAL (
         SELECT phone_number_id, registration_state, display_phone_number
           FROM whatsapp_phone_numbers
          WHERE whatsapp_account_id=a.id AND business_id=a.business_id
          ORDER BY is_default DESC, created_at
          LIMIT 1
       ) p ON TRUE
       WHERE a.business_id=$1 AND a.status='connected'
       ORDER BY CASE WHEN COALESCE(a.access_token_encrypted,'')<>'' THEN 0 ELSE 1 END,
                a.is_default DESC NULLS LAST, a.created_at LIMIT 1`,
      [businessId]
    )
  ).rows[0];
  const flows = (
    await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) IN ('published','active'))::int AS published
       FROM whatsapp_native_flows WHERE business_id=$1`,
      [businessId]
    )
  ).rows[0] || { total: 0, published: 0 };
  let webviewTotal = 0;
  try {
    webviewTotal = Number((await query(`SELECT COUNT(*)::int AS total FROM whatsapp_webviews WHERE business_id=$1`, [businessId])).rows[0]?.total || 0);
  } catch {
    webviewTotal = 0;
  }
  const checks = buildReadinessChecks({
    production,
    app,
    secrets: {
      appId: secretConfigured('META_APP_ID'),
      appSecret: secretConfigured('META_APP_SECRET')
    },
    workerFresh,
    workerErrors,
    workerObservedAt: heartbeat?.last_success_at || null,
    account,
    flows,
    webviews: { total: webviewTotal }
  });
  const summary = summarizeReadiness(checks);
  const nextSteps = checks
    .filter((check) => check.status === 'blocked' || check.status === 'not_verified')
    .map((check) => check.operatorHint)
    .filter(Boolean);
  return {
    businessId,
    summary: summary.summary,
    liveVerified: summary.liveVerified,
    appUrl: app.url || null,
    webhookUrl: app.webhookUrl || null,
    checks,
    nextSteps,
    generatedAt: new Date().toISOString()
  };
}
