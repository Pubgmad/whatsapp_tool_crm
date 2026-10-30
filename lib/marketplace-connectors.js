import crypto from 'crypto';
import { requireSession } from './auth.js';
import { AppError, errorJson, id, json, query } from './db.js';
import { assertWorkspaceFeature } from './feature-controls.js';
import { encryptSecret, decryptSecret } from './meta.js';
import { readJsonBodyLimited } from './security.js';
import { requireWorkspaceManager } from './workspace-permissions.js';

export const MARKETPLACE_PROVIDERS = Object.freeze([
  {
    id: 'google_sheets',
    label: 'Google Sheets',
    kind: 'oauth',
    category: 'bots',
    feature: 'sheets_bot',
    summary: 'Use a spreadsheet as your WhatsApp FAQ or product reply brain.',
    docsPath: '/app/bots',
    status: 'available'
  },
  {
    id: 'zoho_crm',
    label: 'Zoho CRM',
    kind: 'oauth',
    category: 'crm',
    feature: 'crm_sync',
    summary: 'Sync contacts and trigger WhatsApp follow-ups from Zoho.',
    docsPath: '/app/settings/integrations',
    status: 'available'
  },
  {
    id: 'zapier',
    label: 'Zapier',
    kind: 'webhook',
    category: 'automation',
    feature: 'connectors',
    summary: 'Send CRM events to Zapier and receive authorized actions via signed webhooks.',
    docsPath: '/app/settings/integrations',
    status: 'available'
  },
  {
    id: 'pabbly',
    label: 'Pabbly Connect',
    kind: 'webhook',
    category: 'automation',
    feature: 'connectors',
    summary: 'Connect Pabbly workflows with inbound/outbound WhatsApp CRM webhooks.',
    docsPath: '/app/settings/integrations',
    status: 'available'
  },
  {
    id: 'shopify',
    label: 'Shopify',
    kind: 'oauth',
    category: 'commerce',
    feature: 'connectors',
    summary: 'Orders, checkouts, and ecommerce playbooks.',
    docsPath: '/app/settings/integrations',
    status: 'available'
  },
  {
    id: 'woocommerce',
    label: 'WooCommerce',
    kind: 'webhook',
    category: 'commerce',
    feature: 'connectors',
    summary: 'Signed store webhooks for orders and recovery playbooks.',
    docsPath: '/app/settings/integrations',
    status: 'available'
  }
]);

function zohoConfigured() {
  return Boolean(process.env.ZOHO_CLIENT_ID?.trim() && process.env.ZOHO_CLIENT_SECRET?.trim() && process.env.APP_URL?.trim());
}

export async function listMarketplaceConnectors(request) {
  try {
    const session = await requireSession(request);
    const installs = (await query(
      'SELECT provider, status, config, last_activity_at, last_error, updated_at FROM marketplace_connector_installs WHERE business_id=$1',
      [session.businessId]
    )).rows;
    const byProvider = Object.fromEntries(installs.map((row) => [row.provider, row]));
    const appUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
    const providers = MARKETPLACE_PROVIDERS.map((provider) => {
      const install = byProvider[provider.id];
      let connectionNote = '';
      if (provider.id === 'google_sheets') connectionNote = 'Managed in Bots → Google Sheets.';
      if (provider.id === 'zoho_crm') connectionNote = zohoConfigured() ? 'OAuth ready' : 'Platform Zoho credentials not configured';
      if (provider.id === 'zapier' || provider.id === 'pabbly') {
        connectionNote = install?.config?.inboundPath
          ? `Inbound URL ready`
          : 'Generate a signed inbound webhook to connect';
      }
      return {
        ...provider,
        installStatus: install?.status || 'disconnected',
        lastActivityAt: install?.last_activity_at || null,
        lastError: install?.last_error || '',
        connectionNote,
        inboundUrl: install?.config?.inboundPath ? `${appUrl}${install.config.inboundPath}` : '',
        platformReady: provider.id === 'zoho_crm' ? zohoConfigured() : true
      };
    });
    return json({ providers, operatorNote: 'Zapier and Pabbly use signed workspace webhooks. Official directory listing may require separate provider approval.' });
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
    const meta = MARKETPLACE_PROVIDERS.find((item) => item.id === provider);
    if (!meta) throw new AppError('Unknown provider.', 404, 'NOT_FOUND');
    await assertWorkspaceFeature(meta.feature, session.businessId);
    const action = String(body.action || '');

    if (action === 'installWebhook') {
      if (!['zapier', 'pabbly'].includes(provider)) throw new AppError('This provider uses a different connect flow.', 400, 'INVALID_ACTION');
      const secret = crypto.randomBytes(24).toString('hex');
      const inboundPath = `/api/integrations/marketplace/inbound/${provider}`;
      await query(
        `INSERT INTO marketplace_connector_installs (id, business_id, provider, status, config, secret_encrypted, last_activity_at)
         VALUES ($1,$2,$3,'connected',$4::jsonb,$5,NOW())
         ON CONFLICT (business_id, provider) DO UPDATE SET status='connected', config=$4::jsonb, secret_encrypted=$5, last_error='', last_activity_at=NOW(), updated_at=NOW()`,
        [id('mci'), session.businessId, provider, JSON.stringify({ inboundPath, events: body.events || ['contact.created', 'message.received', 'campaign.result'] }), encryptSecret(secret)]
      );
      return json({
        ok: true,
        inboundUrl: `${String(process.env.APP_URL || '').replace(/\/$/, '')}${inboundPath}`,
        secret,
        header: 'x-mathstrat-signature',
        note: 'Store the secret in Zapier/Pabbly. Sign bodies with HMAC-SHA256 hex of the raw JSON.'
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
