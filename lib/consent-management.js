import { AppError, id, query, transaction } from './db.js';

const DEFAULT_OPT_OUT = ['STOP', 'UNSUBSCRIBE', 'OPT OUT'];
const DEFAULT_OPT_IN = ['START', 'SUBSCRIBE', 'YES'];
const MAX_KEYWORDS = 5;

function normalizeKeyword(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .slice(0, 64);
}

export function normalizeKeywordList(values, fallback) {
  const source = Array.isArray(values) ? values : fallback;
  const cleaned = [];
  const seen = new Set();
  for (const raw of source) {
    const keyword = normalizeKeyword(raw);
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    cleaned.push(keyword);
    if (cleaned.length >= MAX_KEYWORDS) break;
  }
  return cleaned.length ? cleaned : fallback.map(normalizeKeyword);
}

export function matchConsentKeyword(text, keywords) {
  const normalized = normalizeKeyword(text);
  if (!normalized) return null;
  for (const keyword of keywords || []) {
    if (normalized === keyword) return keyword;
  }
  return null;
}

export async function getBusinessConsentSettings(businessId, run = query) {
  const row = (await run(
    `SELECT * FROM business_consent_settings WHERE business_id=$1`,
    [businessId]
  )).rows[0];
  if (!row) {
    return {
      businessId,
      marketingMessagingEnabled: true,
      optOutKeywords: DEFAULT_OPT_OUT.slice(),
      optInKeywords: DEFAULT_OPT_IN.slice(),
      optOutAutoReply: 'You have been unsubscribed from marketing WhatsApp messages. Reply START to opt back in.',
      optInAutoReply: 'You are subscribed to marketing WhatsApp messages. Reply STOP to opt out.'
    };
  }
  return {
    businessId,
    marketingMessagingEnabled: row.marketing_messaging_enabled !== false,
    optOutKeywords: normalizeKeywordList(row.opt_out_keywords, DEFAULT_OPT_OUT),
    optInKeywords: normalizeKeywordList(row.opt_in_keywords, DEFAULT_OPT_IN),
    optOutAutoReply: String(row.opt_out_auto_reply || ''),
    optInAutoReply: String(row.opt_in_auto_reply || '')
  };
}

export async function upsertBusinessConsentSettings(session, body, run = query) {
  if (!['Owner', 'Manager'].includes(session.role)) {
    throw new AppError('Only owners and managers can change consent settings.', 403, 'FORBIDDEN');
  }
  const optOutKeywords = normalizeKeywordList(body.optOutKeywords, DEFAULT_OPT_OUT);
  const optInKeywords = normalizeKeywordList(body.optInKeywords, DEFAULT_OPT_IN);
  const overlap = optOutKeywords.filter((keyword) => optInKeywords.includes(keyword));
  if (overlap.length) {
    throw new AppError(`Opt-in and opt-out keywords cannot overlap (${overlap.join(', ')}).`, 400, 'CONSENT_KEYWORD_OVERLAP');
  }
  const marketingMessagingEnabled = body.marketingMessagingEnabled !== false;
  if (session.role !== 'Owner' && typeof body.marketingMessagingEnabled === 'boolean') {
    throw new AppError('Only the Owner can toggle marketing messaging for the workspace.', 403, 'FORBIDDEN');
  }
  const optOutAutoReply = String(body.optOutAutoReply ?? '').trim().slice(0, 500);
  const optInAutoReply = String(body.optInAutoReply ?? '').trim().slice(0, 500);
  await run(
    `INSERT INTO business_consent_settings (
       business_id, marketing_messaging_enabled, opt_out_keywords, opt_in_keywords,
       opt_out_auto_reply, opt_in_auto_reply, updated_at
     ) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,NOW())
     ON CONFLICT (business_id) DO UPDATE SET
       marketing_messaging_enabled = CASE WHEN $7 THEN EXCLUDED.marketing_messaging_enabled ELSE business_consent_settings.marketing_messaging_enabled END,
       opt_out_keywords = EXCLUDED.opt_out_keywords,
       opt_in_keywords = EXCLUDED.opt_in_keywords,
       opt_out_auto_reply = EXCLUDED.opt_out_auto_reply,
       opt_in_auto_reply = EXCLUDED.opt_in_auto_reply,
       updated_at = NOW()`,
    [
      session.businessId,
      marketingMessagingEnabled,
      JSON.stringify(optOutKeywords),
      JSON.stringify(optInKeywords),
      optOutAutoReply || 'You have been unsubscribed from marketing WhatsApp messages. Reply START to opt back in.',
      optInAutoReply || 'You are subscribed to marketing WhatsApp messages. Reply STOP to opt out.',
      session.role === 'Owner'
    ]
  );
  return getBusinessConsentSettings(session.businessId, run);
}

export async function cancelOutboundForContact(client, businessId, contactId, reason = 'Customer opted out') {
  const campaignJobs = await client.query(
    `UPDATE campaign_jobs j
     SET status='failed', error_message=$3, completed_at=NOW(), locked_at=NULL, updated_at=NOW()
     FROM campaign_recipients r
     JOIN campaigns c ON c.id=r.campaign_id
     WHERE j.campaign_recipient_id=r.id
       AND c.business_id=$1 AND r.contact_id=$2
       AND j.status IN ('queued','retry','processing')`,
    [businessId, contactId, reason]
  );
  const recipients = await client.query(
    `UPDATE campaign_recipients r
     SET status='failed', error_message=$3, updated_at=NOW()
     FROM campaigns c
     WHERE r.campaign_id=c.id AND c.business_id=$1 AND r.contact_id=$2
       AND r.status IN ('queued','pending')`,
    [businessId, contactId, reason]
  );
  const drips = await client.query(
    `UPDATE campaign_drip_enrollments
     SET status='cancelled', updated_at=NOW()
     WHERE business_id=$1 AND contact_id=$2 AND status='active'`,
    [businessId, contactId]
  );
  const automationJobs = await client.query(
    `UPDATE automation_jobs j
     SET status='failed', completed_at=NOW(), locked_at=NULL,
         error_message=$3, updated_at=NOW()
     FROM automation_sessions s
     WHERE j.session_id=s.id AND s.business_id=$1 AND s.contact_id=$2
       AND j.status IN ('queued','retry')`,
    [businessId, contactId, reason]
  );
  const sessions = await client.query(
    `UPDATE automation_sessions
     SET status='completed', ended_at=NOW(), updated_at=NOW()
     WHERE business_id=$1 AND contact_id=$2 AND status='active'`,
    [businessId, contactId]
  );
  return {
    campaignJobs: campaignJobs.rowCount,
    recipients: recipients.rowCount,
    dripEnrollments: drips.rowCount,
    automationJobs: automationJobs.rowCount,
    automationSessions: sessions.rowCount
  };
}

export async function applyContactOptOut(client, {
  businessId,
  contactId,
  source = 'keyword',
  evidence = 'Customer opt-out keyword',
  keyword = null,
  recordedBy = null
}) {
  await client.query(
    `UPDATE contacts
     SET marketing_permission=FALSE, unsubscribed=TRUE, updated_at=NOW()
     WHERE id=$1 AND business_id=$2`,
    [contactId, businessId]
  );
  const existing = (await client.query(
    `SELECT id FROM contact_suppressions
     WHERE business_id=$1 AND contact_id=$2 AND channel='whatsapp'`,
    [businessId, contactId]
  )).rows[0];
  if (existing) {
    await client.query(
      `UPDATE contact_suppressions
       SET active=TRUE, reason='opt_out', source=$3, released_at=NULL
       WHERE id=$1 AND business_id=$2`,
      [existing.id, businessId, source]
    );
  } else {
    await client.query(
      `INSERT INTO contact_suppressions (id,business_id,contact_id,channel,reason,source,active)
       VALUES ($1,$2,$3,'whatsapp','opt_out',$4,TRUE)`,
      [id('csp'), businessId, contactId, source]
    );
  }
  await client.query(
    `INSERT INTO contact_consent_events (id,business_id,contact_id,recorded_by,source,evidence,occurred_at,event_type,channel)
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),'opt_out','whatsapp')`,
    [id('cce'), businessId, contactId, recordedBy, source, evidence.slice(0, 500)]
  );
  await client.query(
    `INSERT INTO events (id,business_id,type,contact_id) VALUES ($1,$2,'unsubscribe',$3)`,
    [id('e'), businessId, contactId]
  );
  const cancelled = await cancelOutboundForContact(client, businessId, contactId, 'Customer opted out of marketing messages.');
  return { keyword, cancelled };
}

export async function applyContactOptIn(client, {
  businessId,
  contactId,
  source = 'keyword',
  evidence = 'Customer opt-in keyword',
  keyword = null,
  recordedBy = null
}) {
  await client.query(
    `UPDATE contacts
     SET marketing_permission=TRUE, unsubscribed=FALSE,
         opt_in_at=NOW(), opt_in_source=$3, updated_at=NOW()
     WHERE id=$1 AND business_id=$2`,
    [contactId, businessId, source]
  );
  await client.query(
    `UPDATE contact_suppressions
     SET active=FALSE, released_at=NOW()
     WHERE business_id=$1 AND contact_id=$2 AND channel='whatsapp' AND active=TRUE`,
    [businessId, contactId]
  );
  await client.query(
    `INSERT INTO contact_consent_events (id,business_id,contact_id,recorded_by,source,evidence,occurred_at,event_type,channel)
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),'opt_in','whatsapp')`,
    [id('cce'), businessId, contactId, recordedBy, source, evidence.slice(0, 500)]
  );
  await client.query(
    `INSERT INTO events (id,business_id,type,contact_id) VALUES ($1,$2,'subscribe',$3)`,
    [id('e'), businessId, contactId]
  );
  return { keyword };
}

export async function processInboundConsentKeywords(client, { businessId, contactId, text }) {
  const settings = await getBusinessConsentSettings(businessId, client.query.bind(client));
  const optOut = matchConsentKeyword(text, settings.optOutKeywords);
  if (optOut) {
    const result = await applyContactOptOut(client, {
      businessId,
      contactId,
      source: 'inbound_keyword',
      evidence: `Keyword: ${optOut}`,
      keyword: optOut
    });
    return { action: 'opt_out', autoReply: settings.optOutAutoReply, ...result };
  }
  const optIn = matchConsentKeyword(text, settings.optInKeywords);
  if (optIn) {
    const result = await applyContactOptIn(client, {
      businessId,
      contactId,
      source: 'inbound_keyword',
      evidence: `Keyword: ${optIn}`,
      keyword: optIn
    });
    return { action: 'opt_in', autoReply: settings.optInAutoReply, ...result };
  }
  return null;
}

/**
 * Send the configured opt-in/out confirmation when the 24h customer-care window is open.
 * Marketing template sends are intentionally not used here — confirmation is a session reply.
 * Returns Awaiting Live Verification details when Meta credentials/window block delivery.
 */
export async function sendConsentKeywordAutoReply({
  businessId,
  contactId,
  conversationId,
  autoReply,
  action
}) {
  const body = String(autoReply || '').trim().slice(0, 1000);
  if (!body) {
    return { sent: false, reason: 'empty_auto_reply' };
  }
  const { query: dbQuery, id: makeId } = await import('./db.js');
  const { okToReply } = await import('./reply-window.js');
  const { messagingSetupForContact } = await import('./messaging-setup.js');
  const { sendTextMessage, metaReady } = await import('./meta.js');

  const contact = (await dbQuery(
    `SELECT id, phone, last_message_at, unsubscribed, marketing_permission
     FROM contacts WHERE id=$1 AND business_id=$2`,
    [contactId, businessId]
  )).rows[0];
  if (!contact) return { sent: false, reason: 'contact_missing' };
  if (!okToReply(contact)) {
    return { sent: false, reason: 'reply_window_closed', awaitingLiveVerification: false };
  }

  try {
    const setup = await messagingSetupForContact(businessId, contactId);
    if (!metaReady(setup)) {
      return { sent: false, reason: 'meta_not_configured', awaitingLiveVerification: true };
    }
    const meta = await sendTextMessage({ setup, to: contact.phone, body });
    const conversation = conversationId || (await dbQuery(
      'SELECT id FROM conversations WHERE business_id=$1 AND contact_id=$2',
      [businessId, contactId]
    )).rows[0]?.id;
    if (conversation) {
      await dbQuery(
        `INSERT INTO messages (id, conversation_id, direction, body, status, meta_message_id, message_type, metadata)
         VALUES ($1,$2,'outgoing',$3,$4,$5,'text',$6::jsonb)`,
        [
          makeId('m'),
          conversation,
          body,
          meta.status || 'sent',
          meta.metaMessageId || '',
          JSON.stringify({ kind: 'consent_auto_reply', action })
        ]
      );
      await dbQuery(
        `UPDATE conversations SET updated_at=NOW(), version=version+1 WHERE id=$1 AND business_id=$2`,
        [conversation, businessId]
      );
    }
    await dbQuery(
      `INSERT INTO audit_logs(id,business_id,user_id,action,metadata)
       VALUES ($1,$2,NULL,'consent_auto_reply_sent',$3::jsonb)`,
      [makeId('a'), businessId, JSON.stringify({ contactId, action, metaMessageId: meta.metaMessageId || null })]
    );
    return { sent: true, metaMessageId: meta.metaMessageId || null, awaitingLiveVerification: false };
  } catch (error) {
    const code = String(error?.code || 'CONSENT_AUTO_REPLY_FAILED');
    await dbQuery(
      `INSERT INTO audit_logs(id,business_id,user_id,action,metadata)
       VALUES ($1,$2,NULL,'consent_auto_reply_failed',$3::jsonb)`,
      [makeId('a'), businessId, JSON.stringify({ contactId, action, code, message: String(error?.message || '').slice(0, 300) })]
    ).catch(() => {});
    return {
      sent: false,
      reason: code,
      awaitingLiveVerification: code === 'META_NOT_CONFIGURED' || code.includes('META')
    };
  }
}

export async function listContactConsentHistory(businessId, contactId, limit = 50) {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = (await query(
    `SELECT id, source, evidence, occurred_at, event_type, channel, recorded_by, created_at
     FROM contact_consent_events
     WHERE business_id=$1 AND contact_id=$2
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT $3`,
    [businessId, contactId, capped]
  )).rows;
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    evidence: row.evidence,
    eventType: row.event_type || 'opt_in',
    channel: row.channel || 'whatsapp',
    recordedBy: row.recorded_by,
    occurredAt: row.occurred_at,
    createdAt: row.created_at
  }));
}

export async function consentManagementRequest(request) {
  const { requireSession } = await import('./auth.js');
  const { json, errorJson } = await import('./db.js');
  const { readJsonBodyLimited } = await import('./security.js');
  try {
    const session = await requireSession(request);
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const contactId = String(url.searchParams.get('contactId') || '').trim();
      const settings = await getBusinessConsentSettings(session.businessId);
      const history = contactId
        ? await listContactConsentHistory(session.businessId, contactId)
        : [];
      const suppressions = (await query(
        `SELECT s.id,s.contact_id,s.reason,s.source,s.active,s.created_at,s.released_at,c.name,c.phone
         FROM contact_suppressions s
         JOIN contacts c ON c.id=s.contact_id AND c.business_id=s.business_id
         WHERE s.business_id=$1 AND s.active=TRUE
         ORDER BY s.created_at DESC
         LIMIT 200`,
        [session.businessId]
      )).rows.map((row) => ({
        id: row.id,
        contactId: row.contact_id,
        name: row.name,
        phone: row.phone,
        reason: row.reason,
        source: row.source,
        createdAt: row.created_at,
        releasedAt: row.released_at
      }));
      return json({ settings, history, suppressions });
    }
    if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
      const body = await readJsonBodyLimited(request, 16384);
      const settings = await transaction(async (client) => {
        const next = await upsertBusinessConsentSettings(session, body, client.query.bind(client));
        await client.query(
          `INSERT INTO audit_logs(id,business_id,user_id,action,metadata)
           VALUES ($1,$2,$3,'consent_settings_updated',$4)`,
          [id('a'), session.businessId, session.userId, JSON.stringify({
            marketingMessagingEnabled: next.marketingMessagingEnabled,
            optOutKeywords: next.optOutKeywords,
            optInKeywords: next.optInKeywords
          })]
        );
        return next;
      });
      return json({ ok: true, settings });
    }
    throw new AppError('Method not allowed.', 405, 'METHOD_NOT_ALLOWED');
  } catch (error) {
    return errorJson(error);
  }
}
