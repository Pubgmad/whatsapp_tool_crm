import { requireSession } from './auth.js';
import { AppError, query, transaction, id, json, errorJson } from './db.js';
import { encryptSecret, decryptSecret } from './meta.js';
import { requireWorkspaceManager } from './workspace-permissions.js';
import { readJsonBodyLimited, readTextBodyLimited } from './security.js';
import { assertSubscriptionActive, subscriptionUsage } from './limits.js';
import { metaGraphApiVersion } from './operational-policy.js';

const clean = (value) => String(value || '').trim();
const metaId = (value) => /^\d{1,32}$/.test(String(value || ''));

export function assertConversionReplay(existing, payload, conversationId, datasetId, explicitTime) {
  const original = existing.payload?.data?.[0];
  const next = payload.data[0];
  if (!original || existing.conversation_id !== conversationId || existing.dataset_id !== datasetId ||
      original.event_name !== next.event_name ||
      ['ctwa_clid','page_id','whatsapp_business_account_id'].some(key => original.user_data?.[key] !== next.user_data?.[key]) ||
      original.custom_data?.value !== next.custom_data?.value || original.custom_data?.currency !== next.custom_data?.currency ||
      (explicitTime !== undefined && original.event_time !== next.event_time)) {
    throw new AppError('This event reference already belongs to a different business outcome.', 409, 'CONVERSION_REFERENCE_CONFLICT');
  }
}

export function conversionPayload(input, attribution, settings, now = Date.now()) {
  if (!['Lead', 'Purchase'].includes(input.eventName) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(clean(input.eventId))) throw new AppError('Choose a supported event and a stable business-event reference.', 400, 'CONVERSION_INVALID');
  if (input.consentConfirmed !== true) throw new AppError('Confirm the customer may be measured before reporting an event.', 400, 'MEASUREMENT_CONSENT_REQUIRED');
  if (!metaId(settings.page_id) || !metaId(settings.waba_id) || !/^[A-Za-z0-9_+/=-]{1,2048}$/.test(attribution?.ctwaClid || '') || attribution?.sourceType !== 'AD') throw new AppError('This conversation has no usable WhatsApp ad attribution.', 409, 'CTWA_ATTRIBUTION_REQUIRED');
  const seconds = Math.floor(now / 1000);
  const eventTime = input.eventTime === undefined ? seconds : Number(input.eventTime);
  if (!Number.isSafeInteger(eventTime) || eventTime > seconds || eventTime < seconds - 7 * 86400) throw new AppError('Event time must be within the previous seven days.', 400, 'CONVERSION_TIME_INVALID');
  const event = { event_id: clean(input.eventId), event_name: input.eventName, event_time: eventTime, action_source: 'business_messaging', messaging_channel: 'whatsapp', user_data: { ctwa_clid: attribution.ctwaClid, page_id: settings.page_id, whatsapp_business_account_id: settings.waba_id } };
  if (input.eventName === 'Purchase') {
    const value = typeof input.value === 'number' ? input.value : Number(String(input.value || ''));
    if (input.value === undefined || input.value === null || String(input.value).trim() === '' || !Number.isFinite(value) || value < 0 || !/^[A-Z]{3}$/.test(input.currency || '')) throw new AppError('Provide a valid purchase value and currency.', 400, 'CONVERSION_VALUE_INVALID');
    event.custom_data = { value, currency: input.currency };
  }
  return { data: [event] };
}

async function graphRequest(path, token, body) {
  const response = await fetch(`https://graph.facebook.com/${metaGraphApiVersion()}/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000)
  });
  const raw = await readTextBodyLimited(response, 2_000_000);
  const payload = JSON.parse(raw);
  return { ok: response.ok, payload };
}

export async function getConversions(request) {
  try {
    const session = await requireSession(request); requireWorkspaceManager(session);
    await query("UPDATE whatsapp_conversion_events SET status='unconfirmed',error_code='META_DELIVERY_UNCONFIRMED',updated_at=NOW() WHERE business_id=$1 AND status='processing' AND updated_at < NOW()-INTERVAL '2 minutes'", [session.businessId]);
    const raw = Number(new URL(request.url).searchParams.get('page') || 1);
    const page = Number.isSafeInteger(raw) ? Math.max(1, Math.min(raw,100000)) : 1;
    const settings = (await query('SELECT whatsapp_account_id,dataset_id,page_id,enabled,updated_at FROM whatsapp_conversion_settings WHERE business_id=$1', [session.businessId])).rows[0] || null;
    const accounts = (await query('SELECT id,name,waba_id FROM whatsapp_accounts WHERE business_id=$1 ORDER BY is_default DESC,created_at', [session.businessId])).rows;
    const events = (await query('SELECT id,event_id,event_name,status,error_code,created_at FROM whatsapp_conversion_events WHERE business_id=$1 ORDER BY created_at DESC,id LIMIT 26 OFFSET $2', [session.businessId, (page-1)*25])).rows;
    const conversations = (await query(`SELECT c.id,ct.name,ct.phone FROM conversations c JOIN contacts ct ON ct.id=c.contact_id AND ct.business_id=c.business_id
      JOIN whatsapp_phone_numbers p ON p.phone_number_id=c.whatsapp_phone_number_id AND p.business_id=c.business_id
      JOIN whatsapp_conversion_settings s ON s.business_id=c.business_id AND s.whatsapp_account_id=p.whatsapp_account_id
      WHERE c.business_id=$1 AND c.first_referral->>'ctwaClid' IS NOT NULL AND ct.unsubscribed=FALSE ORDER BY c.updated_at DESC LIMIT 100`, [session.businessId])).rows;
    return json({ settings, accounts, events: events.slice(0,25), conversations, page, hasMore: events.length > 25 });
  } catch (error) { return errorJson(error); }
}

export async function updateConversions(request) {
  try {
    const session = await requireSession(request); requireWorkspaceManager(session);
    const body = await readJsonBodyLimited(request, 16384);
    if (body.action === 'disable') {
      if (session.role !== 'Owner') throw new AppError('Only the company owner can disable measurement.', 403, 'FORBIDDEN');
      await transaction(async (client) => {
        await client.query('UPDATE whatsapp_conversion_settings SET enabled=FALSE,updated_at=NOW() WHERE business_id=$1', [session.businessId]);
        await client.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)', [id('a'),session.businessId,session.userId,'whatsapp_conversion_disabled','{}']);
      });
      return json({ok:true});
    }
    assertSubscriptionActive(await subscriptionUsage(session.businessId));
    if (body.action === 'configure') {
      if (session.role !== 'Owner') throw new AppError('Only the company owner can configure measurement credentials.', 403, 'FORBIDDEN');
      if (!metaId(body.datasetId) || !metaId(body.pageId) || typeof body.enabled !== 'boolean') throw new AppError('Provide valid Meta asset IDs and an enabled state.', 400, 'CONVERSION_SETTINGS_INVALID');
      const account = (await query('SELECT id FROM whatsapp_accounts WHERE id=$1 AND business_id=$2', [clean(body.accountId), session.businessId])).rows[0];
      if (!account) throw new AppError('WhatsApp account not found.',404,'NOT_FOUND');
      const previous = (await query('SELECT * FROM whatsapp_conversion_settings WHERE business_id=$1', [session.businessId])).rows[0];
      const suppliedToken = clean(body.accessToken);
      if (suppliedToken.length > 8192) throw new AppError('Access token is too long.',400,'CONVERSION_SETTINGS_INVALID');
      const token = suppliedToken || (previous && previous.whatsapp_account_id === account.id && previous.dataset_id === body.datasetId && previous.page_id === body.pageId ? decryptSecret(previous.access_token_encrypted) : '');
      if (!token) throw new AppError('Provide the access token for these Meta assets.',400,'META_TOKEN_REQUIRED');
      for (const asset of [body.datasetId, body.pageId]) {
        const check = await graphRequest(`${asset}?fields=id`,token);
        if (!check.ok || String(check.payload.id) !== asset) throw new AppError('Meta could not verify access to the selected assets.',403,'META_ASSET_ACCESS_DENIED');
      }
      await transaction(async (client) => {
        await client.query(`INSERT INTO whatsapp_conversion_settings (business_id,whatsapp_account_id,dataset_id,page_id,access_token_encrypted,enabled) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (business_id) DO UPDATE SET whatsapp_account_id=EXCLUDED.whatsapp_account_id,dataset_id=EXCLUDED.dataset_id,page_id=EXCLUDED.page_id,access_token_encrypted=EXCLUDED.access_token_encrypted,enabled=EXCLUDED.enabled,updated_at=NOW()`, [session.businessId,account.id,body.datasetId,body.pageId,encryptSecret(token),body.enabled]);
        await client.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)', [id('a'),session.businessId,session.userId,'whatsapp_conversion_configured',JSON.stringify({ accountId: account.id, datasetId: body.datasetId, pageId: body.pageId, enabled: body.enabled })]);
      });
      return json({ok:true});
    }
    if (body.action !== 'report') throw new AppError('Unsupported conversion action.',400,'INVALID_ACTION');
    const settings = (await query(`SELECT s.*,a.waba_id FROM whatsapp_conversion_settings s JOIN whatsapp_accounts a ON a.id=s.whatsapp_account_id AND a.business_id=s.business_id
      WHERE s.business_id=$1 AND s.enabled=TRUE AND a.status='connected'`, [session.businessId])).rows[0];
    if (!settings) throw new AppError('Configure and enable WhatsApp measurement first.',409,'CONVERSION_NOT_CONFIGURED');
    const conversation = (await query(`SELECT c.first_referral FROM conversations c JOIN contacts ct ON ct.id=c.contact_id AND ct.business_id=c.business_id
      JOIN whatsapp_phone_numbers p ON p.phone_number_id=c.whatsapp_phone_number_id AND p.business_id=c.business_id
      WHERE c.id=$1 AND c.business_id=$2 AND ct.unsubscribed=FALSE AND p.whatsapp_account_id=$3`, [clean(body.conversationId),session.businessId,settings.whatsapp_account_id])).rows[0];
    if (!conversation) throw new AppError('Eligible conversation not found.',404,'NOT_FOUND');
    const payload = conversionPayload(body,conversation.first_referral,settings);
    const eventId = id('wce');
    const created = await query(`INSERT INTO whatsapp_conversion_events (id,business_id,conversation_id,event_id,event_name,dataset_id,payload,status,submitted_by,consent_confirmed)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'processing',$8,TRUE) ON CONFLICT (business_id,event_id) DO NOTHING RETURNING id`, [eventId,session.businessId,clean(body.conversationId),clean(body.eventId),body.eventName,settings.dataset_id,JSON.stringify(payload),session.userId]);
    if (!created.rowCount) {
      const existing = (await query('SELECT status,payload,conversation_id,dataset_id FROM whatsapp_conversion_events WHERE business_id=$1 AND event_id=$2', [session.businessId,clean(body.eventId)])).rows[0];
      if (!existing) throw new AppError('The existing outcome is no longer available.',409,'CONVERSION_REFERENCE_CONFLICT');
      assertConversionReplay(existing,payload,clean(body.conversationId),settings.dataset_id,body.eventTime);
      return json({ ok: existing.status === 'accepted', duplicate: true, status: existing.status });
    }
    let status = 'unconfirmed'; let code = 'META_DELIVERY_UNCONFIRMED';
    try {
      const result = await graphRequest(`${settings.dataset_id}/events`,decryptSecret(settings.access_token_encrypted),payload);
      if (!result.ok) { status='failed'; code=String(result.payload.error?.code || 'META_CONVERSION_REJECTED'); }
      else if (result.payload.events_received === 1) { status='accepted'; code=''; }
    } catch { /* An uncertain response must not trigger a duplicate automatic submission. */ }
    await query('UPDATE whatsapp_conversion_events SET status=$1,error_code=$2,updated_at=NOW() WHERE id=$3 AND business_id=$4', [status,code,eventId,session.businessId]);
    return json({ ok: status === 'accepted', status, eventId }, status === 'accepted' ? 201 : 202);
  } catch (error) { return errorJson(error); }
}
