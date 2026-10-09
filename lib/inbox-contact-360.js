import { Buffer } from 'node:buffer';
import { AppError, id, query, toIso, transaction } from './db.js';
import { readJsonBodyLimited } from './security.js';
import { normalizeTags } from './workspace-mappers.js';
import { isWorkspaceManager } from './workspace-roles.ts';

export const CONTACT_TIMELINE_DEFAULT_LIMIT = 30;
export const CONTACT_TIMELINE_MAX_LIMIT = 100;

function clean(value) {
  return String(value || '').trim();
}

export function parseTimelineLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : CONTACT_TIMELINE_DEFAULT_LIMIT, CONTACT_TIMELINE_MAX_LIMIT));
}

export function encodeTimelineCursor(item) {
  if (!item?.occurredAt || !item?.key) return null;
  return Buffer.from(JSON.stringify({ at: item.occurredAt, key: item.key }), 'utf8').toString('base64url');
}

export function decodeTimelineCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    const date = new Date(parsed.at);
    if (Number.isNaN(date.getTime()) || typeof parsed.key !== 'string' || !/^[a-z_]+:[A-Za-z0-9_-]{1,200}$/.test(parsed.key)) throw new Error();
    return { at: date.toISOString(), key: parsed.key };
  } catch {
    throw new AppError('Timeline cursor is invalid or expired.', 400, 'INVALID_TIMELINE_CURSOR');
  }
}

export function canAccessInboxContact(account, assignment, { write = false } = {}) {
  if (isWorkspaceManager(account?.role)) return true;
  if (account?.role !== 'Agent' || !assignment?.conversation_id) return false;
  return write ? assignment.assigned_user_id === account.userId : !assignment.assigned_user_id || assignment.assigned_user_id === account.userId;
}

async function contactAccess(businessId, contactId, account, run = query, options = {}) {
  const result = await run(
    `SELECT ct.*,
            c.id AS conversation_id,c.status AS conversation_status,c.assigned_user_id,
            c.first_referral,c.first_referral_at,c.updated_at AS conversation_updated_at,
            u.name AS assigned_name,u.email AS assigned_email
       FROM contacts ct
       LEFT JOIN conversations c ON c.business_id=ct.business_id AND c.contact_id=ct.id
       LEFT JOIN users u ON u.id=c.assigned_user_id
      WHERE ct.business_id=$1 AND ct.id=$2
      LIMIT 1${options.write ? '\n      FOR UPDATE OF ct' : ''}`,
    [businessId, contactId]
  );
  const contact = result.rows[0];
  if (!contact) throw new AppError('Contact not found.', 404, 'CONTACT_NOT_FOUND');
  if (!canAccessInboxContact(account, contact, options)) {
    throw new AppError('You do not have access to this inbox contact.', 403, 'INBOX_CONTACT_FORBIDDEN');
  }
  return contact;
}

export async function loadInboxContactProfile(businessId, contactId, account, run = query) {
  const contact = await contactAccess(businessId, clean(contactId), account, run);
  const [consent, activity] = await Promise.all([
    run(
      `SELECT ce.id,ce.source,ce.evidence,ce.occurred_at,ce.created_at,
              u.name AS recorded_by_name,u.email AS recorded_by_email
         FROM contact_consent_events ce
         LEFT JOIN users u ON u.id=ce.recorded_by
        WHERE ce.business_id=$1 AND ce.contact_id=$2
        ORDER BY ce.occurred_at DESC,ce.id DESC LIMIT 50`,
      [businessId, contact.id]
    ),
    run(
      `SELECT
         (SELECT COUNT(*)::int FROM campaign_recipients cr JOIN campaigns ca ON ca.id=cr.campaign_id WHERE ca.business_id=$1 AND cr.contact_id=$2) AS campaigns,
         (SELECT COUNT(*)::int FROM tracked_link_tokens tl WHERE tl.business_id=$1 AND tl.contact_id=$2 AND tl.confirmed_at IS NOT NULL) AS tracked_clicks,
         (SELECT COUNT(*)::int FROM whatsapp_orders wo WHERE wo.business_id=$1 AND wo.customer_phone=$3) AS orders,
         (SELECT COUNT(*)::int FROM whatsapp_calls wc WHERE wc.business_id=$1 AND wc.remote_number=$3) AS calls,
         (SELECT COUNT(*)::int FROM whatsapp_flow_invites fi WHERE fi.business_id=$1 AND fi.contact_id=$2) AS flow_events`,
      [businessId, contact.id, contact.phone]
    )
  ]);
  const counts = activity.rows[0] || {};
  return {
    contact: {
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      source: contact.source,
      tags: Array.isArray(contact.tags) ? contact.tags : [],
      attributes: contact.custom_attributes || {},
      consent: {
        marketingPermission: Boolean(contact.marketing_permission),
        unsubscribed: Boolean(contact.unsubscribed),
        optInAt: toIso(contact.opt_in_at),
        optInSource: contact.opt_in_source || contact.source,
        history: consent.rows.map((row) => ({
          id: row.id,
          source: row.source,
          evidence: row.evidence,
          occurredAt: toIso(row.occurred_at),
          recordedAt: toIso(row.created_at),
          recordedBy: row.recorded_by_name || row.recorded_by_email || null
        }))
      },
      createdAt: toIso(contact.created_at),
      updatedAt: toIso(contact.updated_at),
      lastMessageAt: toIso(contact.last_message_at)
    },
    assignment: contact.conversation_id ? {
      conversationId: contact.conversation_id,
      status: contact.conversation_status,
      assignedUserId: contact.assigned_user_id || null,
      assignedTo: contact.assigned_name || contact.assigned_email || null,
      updatedAt: toIso(contact.conversation_updated_at)
    } : null,
    referral: contact.first_referral ? {
      details: contact.first_referral,
      occurredAt: toIso(contact.first_referral_at),
      evidence: 'Stored on the tenant-scoped conversation',
      attribution: 'direct'
    } : null,
    activity: {
      campaigns: Number(counts.campaigns || 0),
      trackedClicks: Number(counts.tracked_clicks || 0),
      orders: Number(counts.orders || 0),
      calls: Number(counts.calls || 0),
      flowEvents: Number(counts.flow_events || 0)
    },
    permissions: {
      canEditTags: canAccessInboxContact(account, contact, { write: true })
    }
  };
}

const TIMELINE_SQL = `
WITH selected_contact AS (
  SELECT id,business_id,phone FROM contacts WHERE business_id=$1 AND id=$2
), timeline AS (
  SELECT 'message:'||m.id AS event_key,'message' AS kind,m.at AS occurred_at,
         CASE WHEN m.direction='incoming' THEN 'Incoming message' ELSE 'Outgoing message' END AS title,
         COALESCE(NULLIF(m.body,''),NULLIF(m.caption,''),m.message_type) AS summary,
         jsonb_build_object('direction',m.direction,'status',m.status,'messageType',m.message_type,'conversationId',m.conversation_id) AS data,
         CASE WHEN m.campaign_recipient_id IS NOT NULL THEN 'high' ELSE 'direct' END AS attribution_level,
         CASE WHEN m.campaign_recipient_id IS NOT NULL THEN 'Linked campaign recipient evidence' ELSE 'Direct conversation evidence' END AS attribution_label,
         jsonb_strip_nulls(jsonb_build_object('messageId',m.id,'campaignRecipientId',m.campaign_recipient_id)) AS evidence
    FROM messages m JOIN conversations c ON c.id=m.conversation_id
    JOIN selected_contact sc ON sc.business_id=c.business_id AND sc.id=c.contact_id
  UNION ALL
  SELECT 'campaign:'||cr.id,'campaign',COALESCE(cr.sent_at,cr.updated_at,ca.created_at),
         'Campaign interaction',ca.name||' · '||cr.status,
         jsonb_build_object('campaignId',ca.id,'campaignName',ca.name,'recipientId',cr.id,'status',cr.status,'error',COALESCE(cr.error_message,'')),
         'high','Direct campaign recipient evidence',jsonb_build_object('campaignId',ca.id,'recipientId',cr.id)
    FROM campaign_recipients cr JOIN campaigns ca ON ca.id=cr.campaign_id
    JOIN selected_contact sc ON sc.business_id=ca.business_id AND sc.id=cr.contact_id
  UNION ALL
  SELECT 'click:'||tl.id,'tracked_click',tl.confirmed_at,'Tracked link clicked',td.name,
         jsonb_build_object('definitionId',td.id,'destination',tl.destination,'campaignRecipientId',tl.campaign_recipient_id),
         CASE WHEN tl.campaign_recipient_id IS NULL THEN 'medium' ELSE 'high' END,
         CASE WHEN tl.campaign_recipient_id IS NULL THEN 'Direct tracked-token evidence; campaign unknown' ELSE 'Tracked token linked to campaign recipient' END,
         jsonb_strip_nulls(jsonb_build_object('tokenId',tl.id,'campaignRecipientId',tl.campaign_recipient_id))
    FROM tracked_link_tokens tl JOIN tracked_link_definitions td ON td.id=tl.definition_id AND td.business_id=tl.business_id
    JOIN selected_contact sc ON sc.business_id=tl.business_id AND sc.id=tl.contact_id
   WHERE tl.confirmed_at IS NOT NULL
  UNION ALL
  SELECT 'order:'||wo.id,'order',wo.created_at,'Order created',
         wo.currency||' '||wo.total_amount::text||' · '||wo.fulfillment_status,
         jsonb_build_object('orderId',wo.id,'items',wo.items,'totalAmount',wo.total_amount,'currency',wo.currency,'fulfillmentStatus',wo.fulfillment_status,'paymentStatus',wo.payment_status),
         CASE WHEN cr.id IS NOT NULL AND cv.first_referral IS NOT NULL THEN 'high' WHEN cr.id IS NOT NULL OR cv.first_referral IS NOT NULL OR wo.source_message_id LIKE 'flow:%' THEN 'medium' ELSE 'unknown' END,
         CASE WHEN cr.id IS NOT NULL AND cv.first_referral IS NOT NULL THEN 'Campaign and referral evidence recorded'
              WHEN cr.id IS NOT NULL THEN 'Linked campaign recipient evidence'
              WHEN cv.first_referral IS NOT NULL THEN 'Conversation referral evidence; campaign unknown'
              WHEN wo.source_message_id LIKE 'flow:%' THEN 'Flow source evidence; campaign unknown'
              ELSE 'Unknown attribution: no campaign, referral, or Flow evidence' END,
         jsonb_strip_nulls(jsonb_build_object('sourceMessageId',wo.source_message_id,'campaignRecipientId',cr.id,'referral',cv.first_referral))
    FROM whatsapp_orders wo JOIN selected_contact sc ON sc.business_id=wo.business_id AND sc.phone=wo.customer_phone
    LEFT JOIN messages m ON m.meta_message_id=wo.source_message_id
    LEFT JOIN campaign_recipients cr ON cr.id=m.campaign_recipient_id
    LEFT JOIN conversations cv ON cv.business_id=wo.business_id AND cv.contact_id=sc.id
  UNION ALL
  SELECT 'call:'||wc.id,'call',COALESCE(wc.last_event_at,wc.created_at),'WhatsApp call',
         wc.direction||' · '||wc.status,
         jsonb_build_object('callId',wc.id,'direction',wc.direction,'status',wc.status,'endedAt',wc.ended_at,'agentId',wc.agent_id,'errorCode',wc.error_code),
         'unknown','Unknown campaign attribution; matched by contact phone number',jsonb_build_object('callId',wc.id,'remoteNumber',wc.remote_number)
    FROM whatsapp_calls wc JOIN selected_contact sc ON sc.business_id=wc.business_id AND sc.phone=wc.remote_number
  UNION ALL
  SELECT 'flow_invite:'||fi.id,'flow',fi.created_at,'Flow invitation',nf.name||' · '||fi.status,
         jsonb_build_object('flowId',fi.flow_id,'flowName',nf.name,'status',fi.status,'fields',fi.fields),
         'direct','Direct Flow invitation evidence',jsonb_build_object('inviteId',fi.id,'flowId',fi.flow_id)
    FROM whatsapp_flow_invites fi JOIN whatsapp_native_flows nf ON nf.id=fi.flow_id AND nf.business_id=fi.business_id
    JOIN selected_contact sc ON sc.business_id=fi.business_id AND sc.id=fi.contact_id
  UNION ALL
  SELECT 'flow_submission:'||fs.id,'flow',fs.created_at,'Flow submitted',nf.name,
         jsonb_build_object('flowId',fi.flow_id,'flowName',nf.name,'response',fs.response),
         'direct','Direct Flow submission evidence',jsonb_build_object('submissionId',fs.id,'inviteId',fi.id,'messageId',fs.message_id)
    FROM whatsapp_flow_submissions fs JOIN whatsapp_flow_invites fi ON fi.id=fs.invite_id AND fi.business_id=fs.business_id
    JOIN whatsapp_native_flows nf ON nf.id=fi.flow_id AND nf.business_id=fi.business_id
    JOIN selected_contact sc ON sc.business_id=fs.business_id AND sc.id=fs.contact_id
  UNION ALL
  SELECT 'flow_screen:'||fe.id,'flow',fe.created_at,'Flow screen '||fe.event_kind,fe.screen_id,
         jsonb_build_object('flowId',fe.flow_id,'sessionId',fe.session_id,'screenId',fe.screen_id,'event',fe.event_kind),
         'direct','Direct Flow runtime session evidence',jsonb_build_object('screenEventId',fe.id,'sessionId',fe.session_id)
    FROM flow_screen_events fe JOIN flow_runtime_sessions frs ON frs.id=fe.session_id AND frs.business_id=fe.business_id
    JOIN selected_contact sc ON sc.business_id=frs.business_id AND sc.id=frs.contact_id
  UNION ALL
  SELECT 'consent:'||ce.id,'consent',ce.occurred_at,'Consent recorded',ce.source,
         jsonb_build_object('source',ce.source,'evidence',ce.evidence),
         'direct','Recorded consent evidence',jsonb_build_object('consentEventId',ce.id)
    FROM contact_consent_events ce JOIN selected_contact sc ON sc.business_id=ce.business_id AND sc.id=ce.contact_id
  UNION ALL
  SELECT 'referral:'||cv.id,'referral',cv.first_referral_at,'Conversation referral','Referral captured',
         jsonb_build_object('referral',cv.first_referral),
         'direct','Stored conversation referral evidence',jsonb_build_object('conversationId',cv.id)
    FROM conversations cv JOIN selected_contact sc ON sc.business_id=cv.business_id AND sc.id=cv.contact_id
   WHERE cv.first_referral IS NOT NULL AND cv.first_referral_at IS NOT NULL
  UNION ALL
  SELECT 'tag_audit:'||al.id,'tag_change',al.at,'Contact tags changed','Inbox profile edit',
         al.metadata,'direct','Workspace audit evidence',jsonb_build_object('auditLogId',al.id,'userId',al.user_id)
    FROM audit_logs al JOIN selected_contact sc ON sc.business_id=al.business_id
   WHERE al.action='inbox_contact_tags_updated' AND al.metadata->>'contactId'=sc.id
)
SELECT event_key,kind,occurred_at,title,summary,data,attribution_level,attribution_label,evidence
  FROM timeline
 WHERE occurred_at IS NOT NULL
   AND ($3::timestamptz IS NULL OR (occurred_at,event_key) < ($3::timestamptz,$4::text))
 ORDER BY occurred_at DESC,event_key DESC
 LIMIT $5`;

export async function loadInboxContactTimeline(businessId, contactId, account, options = {}, run = query) {
  await contactAccess(businessId, clean(contactId), account, run);
  const limit = parseTimelineLimit(options.limit);
  const cursor = decodeTimelineCursor(options.cursor);
  const result = await run(TIMELINE_SQL, [businessId, clean(contactId), cursor?.at || null, cursor?.key || '', limit + 1]);
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  const items = rows.map((row) => ({
    key: row.event_key,
    kind: row.kind,
    occurredAt: toIso(row.occurred_at),
    title: row.title,
    summary: row.summary,
    data: row.data || {},
    attribution: {
      level: row.attribution_level,
      label: row.attribution_label,
      evidence: row.evidence || {}
    }
  }));
  return {
    items,
    page: {
      limit,
      order: 'newest_first',
      hasMore,
      nextCursor: hasMore ? encodeTimelineCursor(items[items.length - 1]) : null
    }
  };
}

export async function updateInboxContactTags(request, businessId, contactId, account) {
  const body = await readJsonBodyLimited(request, 4096);
  if (
    Object.keys(body).some((key) => key !== 'tags') ||
    !Array.isArray(body.tags) ||
    body.tags.length > 20 ||
    body.tags.some((tag) => typeof tag !== 'string' || clean(tag).length > 50)
  ) {
    throw new AppError('Provide tags as an array.', 400, 'INVALID_CONTACT_TAGS');
  }
  const tags = normalizeTags(body.tags);
  return transaction(async (client) => {
    const contact = await contactAccess(businessId, clean(contactId), account, client.query.bind(client), { write: true });
    const previous = Array.isArray(contact.tags) ? contact.tags : [];
    const changed = await client.query(
      `UPDATE contacts ct SET tags=$1::jsonb,updated_at=NOW()
        WHERE ct.business_id=$2 AND ct.id=$3
          AND ($4::boolean OR EXISTS (
            SELECT 1 FROM conversations c
             WHERE c.business_id=ct.business_id AND c.contact_id=ct.id AND c.assigned_user_id=$5
          ))
        RETURNING tags,updated_at`,
      [JSON.stringify(tags), businessId, contact.id, isWorkspaceManager(account.role), account.userId]
    );
    if (!changed.rows[0]) throw new AppError('You do not have access to edit this inbox contact.', 403, 'INBOX_CONTACT_FORBIDDEN');
    await client.query(
      `INSERT INTO audit_logs(id,business_id,user_id,action,metadata)
       VALUES($1,$2,$3,'inbox_contact_tags_updated',$4::jsonb)`,
      [id('a'), businessId, account.userId, JSON.stringify({ contactId: contact.id, previous, tags })]
    );
    return { contactId: contact.id, tags: changed.rows[0].tags, updatedAt: toIso(changed.rows[0].updated_at) };
  });
}
