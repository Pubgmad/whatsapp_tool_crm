import { query } from './db.js';
import { workerIsFresh } from './health.js';

function clean(value) {
  return String(value || '').trim();
}

function item(id, label, status, detail = '', operatorHint = '') {
  return {
    id,
    label,
    status, // ready | awaiting_live | blocked | info
    detail: String(detail || '').slice(0, 600),
    operatorHint: String(operatorHint || '').slice(0, 400)
  };
}

function appUrlState() {
  const raw = clean(process.env.APP_URL);
  if (!raw) return { ok: false, https: false, url: '', webhookUrl: '' };
  try {
    const url = new URL(raw);
    const https = url.protocol === 'https:';
    return { ok: true, https, url: url.origin, webhookUrl: `${url.origin}/api/webhooks/meta` };
  } catch {
    return { ok: false, https: false, url: raw, webhookUrl: '' };
  }
}

/**
 * Operator-facing live Meta + ops readiness for Automation / Flows / Webviews.
 * Code can be production-shaped while status stays "awaiting_live" until WABA/Flows/webhooks are verified on HTTPS.
 */
export async function workspaceLiveMetaReadiness(businessId) {
  const checks = [];
  const app = appUrlState();
  const production = process.env.NODE_ENV === 'production';

  if (!app.ok) {
    checks.push(item('app_url', 'Public APP_URL', 'blocked', 'APP_URL is missing or invalid', 'Set APP_URL to your public CRM origin'));
  } else if (!app.https && production) {
    checks.push(item('app_url', 'HTTPS APP_URL', 'blocked', app.url, 'Meta webhooks and Flows require https:// APP_URL in production'));
  } else if (!app.https) {
    checks.push(item('app_url', 'HTTPS APP_URL', 'awaiting_live', `${app.url} (HTTP OK for local only)`, 'Use HTTPS APP_URL before Meta live verification'));
  } else {
    checks.push(item('app_url', 'HTTPS APP_URL', 'ready', app.url));
  }

  checks.push(
    item(
      'webhook_endpoint',
      'Meta webhook endpoint',
      app.https || !production ? (app.ok ? 'awaiting_live' : 'blocked') : 'blocked',
      app.webhookUrl || 'unavailable',
      'Subscribe this URL in Meta Developer Console and confirm workspace webhookSubscribed'
    )
  );

  const heartbeat = (await query("SELECT last_success_at,last_cycle_errors FROM worker_heartbeats WHERE worker_name='queue'")).rows[0];
  const workerFresh = workerIsFresh(heartbeat?.last_success_at);
  const workerErrors = heartbeat?.last_cycle_errors && typeof heartbeat.last_cycle_errors === 'object' ? Object.keys(heartbeat.last_cycle_errors) : [];
  checks.push(
    item(
      'worker',
      'Queue worker (automation + campaigns)',
      workerFresh && !workerErrors.length ? 'ready' : workerFresh ? 'awaiting_live' : 'blocked',
      workerFresh
        ? `Heartbeat ${heartbeat.last_success_at}${workerErrors.length ? `; cycle errors: ${workerErrors.join(', ')}` : ''}`
        : 'No fresh worker heartbeat — automation jobs will stall',
      'Run `npm run worker` (or systemd/Procfile worker) with JOB_RUNNER_SECRET against APP_URL'
    )
  );

  const account = (
    await query(
      `SELECT a.id,a.waba_id,a.status,a.health_status,a.webhook_subscribed,p.phone_number_id,p.registration_state,p.display_phone_number
       FROM whatsapp_accounts a
       LEFT JOIN whatsapp_phone_numbers p ON p.whatsapp_account_id=a.id AND p.business_id=a.business_id AND p.is_default=TRUE
       WHERE a.business_id=$1 AND a.status='connected'
       ORDER BY a.is_default DESC NULLS LAST, a.created_at LIMIT 1`,
      [businessId]
    )
  ).rows[0];

  if (!account) {
    checks.push(item('waba', 'WABA connected', 'awaiting_live', 'No connected WhatsApp Business Account', 'Meta Setup → Cloud API / coexistence connect'));
  } else {
    const healthy = !account.health_status || account.health_status === 'healthy';
    checks.push(
      item(
        'waba',
        'WABA connected',
        healthy && account.waba_id ? 'ready' : 'awaiting_live',
        `WABA ${account.waba_id || '—'} · health ${account.health_status || 'unknown'}`,
        'Run Connection check after connect'
      )
    );
    checks.push(
      item(
        'webhook_subscribed',
        'Webhook subscribed on WABA',
        account.webhook_subscribed ? 'ready' : 'awaiting_live',
        account.webhook_subscribed ? 'Subscribed' : 'Not verified in CRM',
        'Complete Embedded Signup or subscribe webhooks in Meta, then Connection check'
      )
    );
    const registered = account.registration_state === 'registered' && account.phone_number_id;
    checks.push(
      item(
        'sending_number',
        'Registered sending number',
        registered ? 'ready' : 'awaiting_live',
        registered ? account.display_phone_number || account.phone_number_id : 'Register a phone number on the WABA',
        'Meta Setup → Numbers'
      )
    );
  }

  const flows = (
    await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) IN ('published','active'))::int AS published
       FROM whatsapp_native_flows WHERE business_id=$1`,
      [businessId]
    )
  ).rows[0] || { total: 0, published: 0 };

  checks.push(
    item(
      'published_flows',
      'Published Meta Flows',
      Number(flows.published) > 0 ? 'ready' : Number(flows.total) > 0 ? 'awaiting_live' : 'awaiting_live',
      `${flows.published} published / ${flows.total} total`,
      'Meta Setup → WhatsApp Flows → publish at least one Flow for send_native_flow nodes'
    )
  );

  let webviewTotal = 0;
  try {
    webviewTotal = Number((await query(`SELECT COUNT(*)::int AS total FROM whatsapp_webviews WHERE business_id=$1`, [businessId])).rows[0]?.total || 0);
  } catch {
    webviewTotal = 0;
  }
  const webviews = { total: webviewTotal };

  checks.push(
    item(
      'hosted_webviews',
      'Hosted pages (CRM webviews)',
      Number(webviews.total) > 0 ? 'ready' : 'info',
      `${webviews.total} hosted page(s)`,
      'Integrations → Hosted pages; in-chat WebView chrome remains Meta-controlled'
    )
  );

  checks.push(
    item(
      'in_chat_webview_chrome',
      'Native in-chat WebView chrome',
      'info',
      'Chrome, navigation bar, and security UI are owned by WhatsApp/Meta — CRM supplies CTA URL + hosted content only',
      'Use send_webview_cta / transactional hosted pages; do not expect custom in-chat chrome'
    )
  );

  const blocked = checks.some((c) => c.status === 'blocked');
  const awaiting = checks.some((c) => c.status === 'awaiting_live');
  const summary = blocked ? 'blocked' : awaiting ? 'awaiting_live_verification' : 'ready';

  return {
    businessId,
    summary,
    codeComplete: true,
    liveVerified: summary === 'ready',
    appUrl: app.url || null,
    webhookUrl: app.webhookUrl || null,
    checks,
    generatedAt: new Date().toISOString()
  };
}
