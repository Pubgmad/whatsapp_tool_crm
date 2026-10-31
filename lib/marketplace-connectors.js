import crypto from 'crypto';
import { requireSession } from './auth.js';
import { AppError, errorJson, id, json, query } from './db.js';
import { assertWorkspaceFeature } from './feature-controls.js';
import { encryptSecret, decryptSecret } from './meta.js';
import { readJsonBodyLimited } from './security.js';
import { requireWorkspaceManager } from './workspace-permissions.js';
import { getMarketplaceProviders } from './smb-platform-config.js';
import { syncZohoCrmForBusiness } from './zoho-crm-sync.js';

function zohoConfigured() {
  return Boolean(process.env.ZOHO_CLIENT_ID?.trim() && process.env.ZOHO_CLIENT_SECRET?.trim() && process.env.APP_URL?.trim());
}

const MARKETPLACE_OUTBOUND_HOSTS = new Set(
  String(process.env.MARKETPLACE_WEBHOOK_ALLOWED_HOSTS || 'hooks.zapier.com,hook.eu1.make.com,connect.pabbly.com,api.pabbly.com')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
);

function assertMarketplaceOutboundUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new AppError('Enter a valid HTTPS webhook URL.', 400, 'WEBHOOK_URL_INVALID');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href.length > 2000) {
    throw new AppError('Outbound webhooks must be HTTPS without credentials.', 400, 'WEBHOOK_URL_INVALID');
  }
  const host = url.hostname.toLowerCase();
  const allowed = [...MARKETPLACE_OUTBOUND_HOSTS].some((entry) => host === entry || host.endsWith(`.${entry}`));
  if (!allowed) {
    throw new AppError(
      'Outbound host is not on the marketplace allowlist. Ask the platform admin to add it to MARKETPLACE_WEBHOOK_ALLOWED_HOSTS.',
      400,
      'WEBHOOK_HOST_NOT_ALLOWED'
    );
  }
  return url.href;
}

export async function listMarketplaceConnectors(request) {
  try {
    const session = await requireSession(request);
    const [installs, sheetsConnection, storeConnectors] = await Promise.all([
      query(
        `SELECT provider, status, config, last_activity_at, last_error, updated_at,
                (secret_encrypted IS NOT NULL AND length(secret_encrypted) > 0) AS has_secret
         FROM marketplace_connector_installs WHERE business_id=$1`,
        [session.businessId]
      ),
      query(
        `SELECT status, google_account_email, last_error, updated_at FROM sheets_bot_connections WHERE business_id=$1`,
        [session.businessId]
      ),
      query(
        `SELECT provider, enabled, last_error, updated_at FROM provider_connectors
         WHERE business_id=$1 AND provider IN ('shopify','woocommerce')`,
        [session.businessId]
      )
    ]);
    const byProvider = Object.fromEntries(installs.rows.map((row) => [row.provider, row]));
    const sheets = sheetsConnection.rows[0] || null;
    const stores = Object.fromEntries(storeConnectors.rows.map((row) => [row.provider, row]));
    const appUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
    const catalogue = await getMarketplaceProviders();
    const providers = catalogue.map((provider) => {
      const install = byProvider[provider.id];
      let installStatus = install?.status || 'disconnected';
      let lastActivityAt = install?.last_activity_at || null;
      let lastError = install?.last_error || '';
      let connectionNote = '';
      if (provider.adapter === 'google_sheets') {
        installStatus = sheets?.status === 'connected' ? 'connected' : (sheets?.status || 'disconnected');
        lastActivityAt = sheets?.updated_at || null;
        lastError = sheets?.last_error || '';
        connectionNote = sheets?.status === 'connected'
          ? `Connected${sheets.google_account_email ? ` as ${sheets.google_account_email}` : ''} · manage in Bots`
          : 'Connect Google from Bots → Google Sheets bot';
      } else if (provider.adapter === 'zoho_crm') {
        connectionNote = zohoConfigured() ? 'OAuth ready' : 'Platform Zoho credentials not configured';
        if (install?.status === 'connected' && !install?.has_secret) {
          installStatus = 'disconnected';
          connectionNote = 'Reconnect Zoho — stored credentials are missing';
        } else if (install?.status === 'connected') {
          const summary = install.config?.lastSyncSummary;
          connectionNote = summary
            ? `Connected · last sync +${summary.imported || 0}/~${summary.updated || 0}`
            : 'Connected — Test or Sync Contacts';
        }
      } else if (provider.adapter === 'zapier' || provider.adapter === 'pabbly') {
        // Connected only when signing secret + inbound path exist — not for empty config rows.
        const hasSecret = Boolean(install?.has_secret && install?.config?.inboundPath);
        installStatus = hasSecret ? 'connected' : 'disconnected';
        connectionNote = hasSecret
          ? `Inbound URL ready${install?.config?.outboundUrl ? ' · outbound configured' : ''}`
          : 'Generate a signed inbound webhook to connect';
      } else if (provider.adapter === 'shopify' || provider.adapter === 'woocommerce') {
        const store = stores[provider.adapter];
        installStatus = store?.enabled ? 'connected' : 'disconnected';
        lastActivityAt = store?.updated_at || null;
        lastError = store?.last_error || '';
        connectionNote = store?.enabled
          ? 'Store connector enabled · manage under Integrations'
          : 'Connect your store under Integrations';
      }
      return {
        ...provider,
        installStatus,
        lastActivityAt,
        lastError,
        connectionNote,
        inboundUrl: install?.config?.inboundPath ? `${appUrl}${install.config.inboundPath}` : '',
        outboundConfigured: Boolean(install?.config?.outboundUrl),
        platformReady: provider.adapter === 'zoho_crm' ? zohoConfigured() : true
      };
    });
    return json({
      providers,
      operatorNote: 'Provider visibility is Super Admin–managed. Zapier/Pabbly use signed webhooks; official directory listing may require separate approval.'
    });
  } catch (error) {
    return errorJson(error);
  }
}

export async function manageMarketplaceConnector(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const body = await readJsonBodyLimited(request, 16384);
    const provider = String(body.provider || '');
    const catalogue = await getMarketplaceProviders();
    const meta = catalogue.find((item) => item.id === provider);
    if (!meta) throw new AppError('Unknown or disabled provider.', 404, 'NOT_FOUND');
    await assertWorkspaceFeature(meta.feature, session.businessId);
    const action = String(body.action || '');
    const adapter = meta.adapter || provider;

    if (action === 'installWebhook') {
      if (!['zapier', 'pabbly'].includes(adapter)) throw new AppError('This provider uses a different connect flow.', 400, 'INVALID_ACTION');
      const secret = crypto.randomBytes(24).toString('hex');
      const inboundPath = `/api/integrations/marketplace/inbound/${provider}`;
      const existing = (await query(
        'SELECT config FROM marketplace_connector_installs WHERE business_id=$1 AND provider=$2',
        [session.businessId, provider]
      )).rows[0];
      const config = {
        inboundPath,
        events: body.events || ['contact.created', 'message.received', 'campaign.result'],
        outboundUrl: existing?.config?.outboundUrl || ''
      };
      await query(
        `INSERT INTO marketplace_connector_installs (id, business_id, provider, status, config, secret_encrypted, last_activity_at)
         VALUES ($1,$2,$3,'connected',$4::jsonb,$5,NOW())
         ON CONFLICT (business_id, provider) DO UPDATE SET status='connected', config=$4::jsonb, secret_encrypted=$5, last_error='', last_activity_at=NOW(), updated_at=NOW()`,
        [id('mci'), session.businessId, provider, JSON.stringify(config), encryptSecret(secret)]
      );
      return json({
        ok: true,
        inboundUrl: `${String(process.env.APP_URL || '').replace(/\/$/, '')}${inboundPath}`,
        secret,
        header: 'x-mathstrat-signature',
        note: 'Store the secret in Zapier/Pabbly. Sign bodies with HMAC-SHA256 hex of the raw JSON. Official Zapier directory listing is separate.'
      });
    }

    if (action === 'syncZoho') {
      if (adapter !== 'zoho_crm') throw new AppError('Sync is only for Zoho CRM.', 400, 'INVALID_ACTION');
      const summary = await syncZohoCrmForBusiness(session.businessId);
      return json({ ok: true, summary });
    }

    if (action === 'setOutboundUrl') {
      if (!['zapier', 'pabbly'].includes(adapter)) throw new AppError('Outbound URLs apply to Zapier/Pabbly webhook connectors.', 400, 'INVALID_ACTION');
      const outboundUrl = body.outboundUrl ? assertMarketplaceOutboundUrl(body.outboundUrl) : '';
      const existing = (await query(
        'SELECT id, config FROM marketplace_connector_installs WHERE business_id=$1 AND provider=$2',
        [session.businessId, provider]
      )).rows[0];
      if (!existing) throw new AppError('Generate the inbound webhook first.', 409, 'NOT_CONNECTED');
      const config = { ...(existing.config || {}), outboundUrl };
      await query(
        `UPDATE marketplace_connector_installs SET config=$3::jsonb, updated_at=NOW() WHERE id=$1 AND business_id=$2`,
        [existing.id, session.businessId, JSON.stringify(config)]
      );
      return json({ ok: true, outboundConfigured: Boolean(outboundUrl) });
    }

    if (action === 'testZoho') {
      if (adapter !== 'zoho_crm') throw new AppError('Test is only for Zoho CRM.', 400, 'INVALID_ACTION');
      const install = (await query(
        `SELECT * FROM marketplace_connector_installs WHERE business_id=$1 AND provider='zoho_crm' AND status='connected'`,
        [session.businessId]
      )).rows[0];
      if (!install) throw new AppError('Connect Zoho first.', 409, 'NOT_CONNECTED');
      const refreshToken = decryptSecret(install.secret_encrypted);
      if (!refreshToken) throw new AppError('Zoho credentials missing. Reconnect Zoho.', 409, 'ZOHO_TOKEN_MISSING');
      const { getZohoSyncPolicy } = await import('./smb-platform-config.js');
      const zohoPolicy = await getZohoSyncPolicy();
      const tokenRes = await fetch(`${zohoPolicy.accountsHost}/oauth/v2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: process.env.ZOHO_CLIENT_ID.trim(),
          client_secret: process.env.ZOHO_CLIENT_SECRET.trim(),
          refresh_token: refreshToken
        })
      });
      const token = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !token.access_token) {
        await query(
          `UPDATE marketplace_connector_installs SET last_error=$3, status='error', updated_at=NOW() WHERE id=$1 AND business_id=$2`,
          [install.id, session.businessId, String(token.error || 'Zoho token refresh failed').slice(0, 500)]
        );
        throw new AppError(token.error || 'Zoho token refresh failed.', 502, 'ZOHO_TOKEN_FAILED');
      }
      const apiDomain = String(install.config?.apiDomain || 'https://www.zohoapis.com').replace(/\/$/, '');
      const orgRes = await fetch(`${apiDomain}/crm/v2/org`, {
        headers: { authorization: `Zoho-oauthtoken ${token.access_token}` }
      });
      const org = await orgRes.json().catch(() => ({}));
      if (!orgRes.ok) {
        throw new AppError(org.message || 'Zoho org lookup failed.', 502, 'ZOHO_ORG_FAILED');
      }
      await query(
        `UPDATE marketplace_connector_installs SET last_activity_at=NOW(), last_error='', status='connected', updated_at=NOW() WHERE id=$1 AND business_id=$2`,
        [install.id, session.businessId]
      );
      return json({
        ok: true,
        org: Array.isArray(org.org) ? org.org[0]?.company_name || org.org[0]?.domain_name || 'Zoho org' : 'Zoho org'
      });
    }

    if (action === 'startZoho') {
      if (!zohoConfigured()) throw new AppError('Zoho CRM is not configured on this platform yet.', 503, 'ZOHO_NOT_CONFIGURED');
      const state = crypto.randomBytes(16).toString('hex');
      const redirectUri = `${String(process.env.APP_URL || '').replace(/\/$/, '')}/api/integrations/zoho/callback`;
      await query(
        `INSERT INTO marketplace_connector_installs (id, business_id, provider, status, config)
         VALUES ($1,$2,'zoho_crm','disconnected',$3::jsonb)
         ON CONFLICT (business_id, provider) DO UPDATE SET config=$3::jsonb, updated_at=NOW()`,
        [id('mci'), session.businessId, JSON.stringify({ oauthState: state })]
      );
      const url = new URL('https://accounts.zoho.com/oauth/v2/auth');
      url.searchParams.set('scope', 'ZohoCRM.modules.ALL,ZohoCRM.settings.ALL');
      url.searchParams.set('client_id', process.env.ZOHO_CLIENT_ID.trim());
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', `${session.businessId}.${state}`);
      return json({ url: url.toString() });
    }

    if (action === 'disconnect') {
      await query(
        `UPDATE marketplace_connector_installs SET status='disconnected', secret_encrypted='', last_error='', updated_at=NOW()
         WHERE business_id=$1 AND provider=$2`,
        [session.businessId, provider]
      );
      return json({ ok: true });
    }

    throw new AppError('Unsupported action.', 400, 'INVALID_ACTION');
  } catch (error) {
    return errorJson(error);
  }
}

export async function completeZohoOAuth(url) {
  const params = url.searchParams;
  const code = params.get('code');
  const stateRaw = String(params.get('state') || '');
  const [businessId, state] = stateRaw.split('.');
  if (!code || !businessId || !state) throw new AppError('Invalid Zoho OAuth callback.', 400, 'OAUTH_INVALID');
  if (!zohoConfigured()) throw new AppError('Zoho CRM is not configured.', 503, 'ZOHO_NOT_CONFIGURED');
  const install = (await query(
    `SELECT * FROM marketplace_connector_installs WHERE business_id=$1 AND provider='zoho_crm'`,
    [businessId]
  )).rows[0];
  if (!install || install.config?.oauthState !== state) throw new AppError('Zoho OAuth state mismatch.', 400, 'OAUTH_STATE');
  const redirectUri = `${String(process.env.APP_URL || '').replace(/\/$/, '')}/api/integrations/zoho/callback`;
  const tokenRes = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.ZOHO_CLIENT_ID.trim(),
      client_secret: process.env.ZOHO_CLIENT_SECRET.trim(),
      redirect_uri: redirectUri,
      code
    })
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) {
    throw new AppError(token.error || 'Zoho token exchange failed.', 502, 'ZOHO_TOKEN_FAILED');
  }
  await query(
    `UPDATE marketplace_connector_installs
     SET status='connected', secret_encrypted=$3, config=$4::jsonb, last_error='', last_activity_at=NOW(), updated_at=NOW()
     WHERE id=$1 AND business_id=$2`,
    [
      install.id,
      businessId,
      encryptSecret(token.refresh_token || token.access_token),
      JSON.stringify({
        apiDomain: token.api_domain || 'https://www.zohoapis.com',
        tokenType: token.token_type || 'Bearer',
        expiresIn: token.expires_in || null,
        connectedAt: new Date().toISOString()
      })
    ]
  );
  return { ok: true, businessId };
}

export async function marketplaceInbound(request, provider) {
  try {
    if (!['zapier', 'pabbly'].includes(provider)) throw new AppError('Unsupported provider.', 404, 'NOT_FOUND');
    const raw = await request.text();
    const signature = String(request.headers.get('x-mathstrat-signature') || '');
    const installs = (await query(
      `SELECT * FROM marketplace_connector_installs WHERE provider=$1 AND status='connected'`,
      [provider]
    )).rows;
    let matched = null;
    for (const install of installs) {
      const secret = decryptSecret(install.secret_encrypted);
      if (!secret || !signature) continue;
      const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
      const left = Buffer.from(String(signature));
      const right = Buffer.from(expected);
      if (left.length === right.length && crypto.timingSafeEqual(left, right)) {
        matched = install;
        break;
      }
    }
    if (!matched) throw new AppError('Invalid signature.', 401, 'UNAUTHORIZED');
    let payload = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new AppError('Invalid JSON body.', 400, 'VALIDATION_ERROR');
    }
    await query(
      `UPDATE marketplace_connector_installs SET last_activity_at=NOW(), last_error='', updated_at=NOW() WHERE id=$1 AND business_id=$2`,
      [matched.id, matched.business_id]
    );
    const eventType = String(payload.type || payload.event || payload.action || 'unknown').slice(0, 80);
    const result = { accepted: true, eventType, contactId: null };
    const phone = String(payload.phone || payload.contact?.phone || '').replace(/[^\d+]/g, '').slice(0, 20);
    const name = String(payload.name || payload.contact?.name || phone || 'Webhook contact').slice(0, 120);
    if (['create_contact', 'update_contact', 'contact.created', 'contact.updated'].includes(eventType) && phone) {
      const existing = (await query(
        'SELECT id FROM contacts WHERE business_id=$1 AND phone=$2',
        [matched.business_id, phone]
      )).rows[0];
      if (existing) {
        await query(
          `UPDATE contacts SET name=COALESCE(NULLIF($3,''), name), source=COALESCE(NULLIF(source,''), $4), updated_at=NOW()
           WHERE id=$1 AND business_id=$2`,
          [existing.id, matched.business_id, name, provider]
        );
        result.contactId = existing.id;
      } else {
        const contactId = id('c');
        await query(
          `INSERT INTO contacts (id, business_id, name, phone, source, opt_in_source)
           VALUES ($1,$2,$3,$4,$5,'Integration webhook')
           ON CONFLICT (business_id, phone) DO NOTHING`,
          [contactId, matched.business_id, name, phone, provider]
        );
        const created = (await query(
          'SELECT id FROM contacts WHERE business_id=$1 AND phone=$2',
          [matched.business_id, phone]
        )).rows[0];
        result.contactId = created?.id || contactId;
      }
    }
    const dedupeKey = String(payload.idempotencyKey || payload.id || `${eventType}:${phone}:${payload.occurredAt || ''}`).slice(0, 200);
    await query(
      `INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1,$2,NULL,$3,$4::jsonb)`,
      [
        id('a'),
        matched.business_id,
        `marketplace_inbound_${provider}`,
        JSON.stringify({ eventType, contactId: result.contactId, dedupeKey, at: new Date().toISOString() })
      ]
    );
    return json({ ok: true, ...result });
  } catch (error) {
    return errorJson(error);
  }
}

/**
 * Best-effort outbound delivery to Zapier/Pabbly Catch Hooks.
 * Failures are logged on the install row and do not fail the caller.
 */
export async function dispatchMarketplaceOutbound(businessId, eventType, payload = {}) {
  const installs = (await query(
    `SELECT id, provider, config, secret_encrypted FROM marketplace_connector_installs
     WHERE business_id=$1 AND status='connected' AND provider IN ('zapier','pabbly')`,
    [businessId]
  )).rows;
  let delivered = 0;
  for (const install of installs) {
    const outboundUrl = install.config?.outboundUrl;
    const events = Array.isArray(install.config?.events) ? install.config.events : [];
    if (!outboundUrl || (events.length && !events.includes(eventType) && !events.includes('*'))) continue;
    try {
      assertMarketplaceOutboundUrl(outboundUrl);
      const body = JSON.stringify({
        event: eventType,
        businessId,
        at: new Date().toISOString(),
        data: payload
      });
      const secret = decryptSecret(install.secret_encrypted) || '';
      const signature = secret
        ? crypto.createHmac('sha256', secret).update(body).digest('hex')
        : '';
      const response = await fetch(outboundUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(signature ? { 'x-mathstrat-signature': signature } : {})
        },
        body,
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) {
        await query(
          `UPDATE marketplace_connector_installs SET last_error=$3, updated_at=NOW() WHERE id=$1 AND business_id=$2`,
          [install.id, businessId, `Outbound ${response.status}`.slice(0, 500)]
        );
        continue;
      }
      await query(
        `UPDATE marketplace_connector_installs SET last_activity_at=NOW(), last_error='', updated_at=NOW() WHERE id=$1 AND business_id=$2`,
        [install.id, businessId]
      );
      delivered += 1;
    } catch (error) {
      await query(
        `UPDATE marketplace_connector_installs SET last_error=$3, updated_at=NOW() WHERE id=$1 AND business_id=$2`,
        [install.id, businessId, String(error?.message || 'Outbound failed').slice(0, 500)]
      );
    }
  }
  return { delivered };
}
