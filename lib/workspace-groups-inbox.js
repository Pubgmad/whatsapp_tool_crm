import { AppError, id, query, toIso, transaction } from './db.js';
import { decryptSecret } from './meta.js';
import { metaGraphApiVersion } from './operational-policy.js';

const clean = (value) => String(value || '').trim();
const ENTITLED_STATUSES = new Set(['AVAILABLE']);

export function groupsEntitlement(status) {
  const normalized = clean(status).toUpperCase() || 'UNKNOWN';
  return { status: normalized, entitled: ENTITLED_STATUSES.has(normalized) };
}

export function safeGroupMessage(input = {}) {
  const type = clean(input.type).toLowerCase() || 'unknown';
  const supported = type === 'text';
  const body = supported ? clean(input.text?.body ?? input.body) : clean(input.caption);
  return {
    type,
    body: body || (supported ? '' : `[Unsupported ${type} message]`),
    supported,
    metadata: supported ? {} : { unsupported: true }
  };
}

async function capability(businessId, run = query) {
  const row = (await run(
    `SELECT COALESCE(a.capabilities->'groups_messaging'->>'status','UNKNOWN') AS status
     FROM whatsapp_accounts a
     JOIN whatsapp_phone_numbers p ON p.whatsapp_account_id=a.id AND p.business_id=a.business_id
     WHERE a.business_id=$1 AND p.is_default=TRUE LIMIT 1`,
    [businessId]
  )).rows[0];
  return groupsEntitlement(row?.status);
}

function pageDetails(total, page, pageSize) {
  const pages = Math.max(1, Math.ceil(Number(total || 0) / pageSize));
  return { page: Math.min(page, pages), pageSize, total: Number(total || 0), pages };
}

export async function loadWorkspaceGroupsInbox(businessId, options = {}, run = query) {
  const page = Math.max(1, Math.min(Number(options.page) || 1, 100000));
  const pageSize = Math.max(1, Math.min(Number(options.pageSize || options.limit) || 25, 100));
  const messagePage = Math.max(1, Math.min(Number(options.messagePage) || 1, 100000));
  const messagePageSize = Math.max(1, Math.min(Number(options.messagePageSize) || 50, 100));
  const q = clean(options.q).slice(0, 120);
  const values = [businessId];
  const search = q ? ' AND (g.subject ILIKE $2 OR g.meta_group_id ILIKE $2)' : '';
  if (q) values.push(`%${q}%`);
  const entitlement = await capability(businessId, run);
  const total = (await run(`SELECT COUNT(*)::int AS total FROM whatsapp_groups g WHERE g.business_id=$1${search}`, values)).rows[0]?.total || 0;
  const pagination = pageDetails(total, page, pageSize);
  const groupsResult = await run(
    `SELECT g.id,g.subject,g.participant_count,g.invite_link,g.sync_status,g.meta_group_id,g.updated_at,
            g.unread_count,g.last_read_at,
            lm.body AS latest_body,lm.message_type AS latest_type,lm.direction AS latest_direction,lm.status AS latest_status,lm.at AS latest_at
     FROM whatsapp_groups g
     LEFT JOIN LATERAL (
       SELECT body,message_type,direction,status,at FROM whatsapp_group_messages
       WHERE group_id=g.id ORDER BY at DESC,id DESC LIMIT 1
     ) lm ON TRUE
     WHERE g.business_id=$1${search}
     ORDER BY COALESCE(lm.at,g.updated_at) DESC,g.id DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, (pagination.page - 1) * pageSize]
  );
  const groups = groupsResult.rows.map((row) => ({
    id: row.id,
    subject: row.subject || row.meta_group_id,
    participantCount: Number(row.participant_count || 0),
    inviteLink: row.invite_link,
    syncStatus: row.sync_status,
    metaGroupId: row.meta_group_id,
    unreadCount: Number(row.unread_count || 0),
    lastReadAt: toIso(row.last_read_at),
    updatedAt: toIso(row.latest_at || row.updated_at),
    inboxKind: 'whatsapp_group',
    latestMessage: row.latest_at ? {
      body: row.latest_body,
      type: row.latest_type,
      direction: row.latest_direction,
      status: row.latest_status,
      at: toIso(row.latest_at)
    } : null
  }));
  const selectedId = clean(options.groupId) || groups[0]?.id || '';
  let messages = [];
  let messagePagination = pageDetails(0, messagePage, messagePageSize);
  if (selectedId) {
    const owned = (await run('SELECT id FROM whatsapp_groups WHERE id=$1 AND business_id=$2', [selectedId, businessId])).rows[0];
    if (!owned) throw new AppError('Group not found in this workspace.', 404, 'GROUP_NOT_FOUND');
    const count = (await run('SELECT COUNT(*)::int AS total FROM whatsapp_group_messages WHERE group_id=$1 AND business_id=$2', [selectedId, businessId])).rows[0]?.total || 0;
    messagePagination = pageDetails(count, messagePage, messagePageSize);
    const result = await run(
      `SELECT * FROM (
         SELECT id,direction,body,message_type,status,meta_message_id,sender_ref,metadata,at
         FROM whatsapp_group_messages WHERE group_id=$1 AND business_id=$2
         ORDER BY at DESC,id DESC LIMIT $3 OFFSET $4
       ) recent ORDER BY at ASC,id ASC`,
      [selectedId, businessId, messagePageSize, (messagePagination.page - 1) * messagePageSize]
    );
    messages = result.rows.map((row) => ({
      id: row.id,
      direction: row.direction,
      body: row.body,
      type: row.message_type,
      status: row.status,
      metaMessageId: row.meta_message_id,
      senderRef: row.sender_ref,
      unsupported: Boolean(row.metadata?.unsupported),
      at: toIso(row.at)
    }));
  }
  return { mode: 'groups', entitlement, groups, selectedGroupId: selectedId, messages, pagination: { groups: pagination, messages: messagePagination } };
}

async function sendingConnection(businessId, run = query) {
  const row = (await run(
    `SELECT p.phone_number_id,a.access_token_encrypted,
            COALESCE(a.capabilities->'groups_messaging'->>'status','UNKNOWN') AS capability
     FROM whatsapp_phone_numbers p JOIN whatsapp_accounts a
       ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id
     WHERE p.business_id=$1 AND p.is_default=TRUE AND p.registration_state='registered' AND a.status='connected'
     LIMIT 1`,
    [businessId]
  )).rows[0];
  if (!row) throw new AppError('Connect and register a default WhatsApp number first.', 409, 'GROUPS_PHONE_REQUIRED');
  if (!groupsEntitlement(row.capability).entitled) {
    throw new AppError('Meta has not granted Groups messaging to this WhatsApp account.', 403, 'GROUPS_NOT_ENTITLED');
  }
  return { phoneNumberId: row.phone_number_id, token: decryptSecret(row.access_token_encrypted) };
}

export async function sendWorkspaceGroupMessage(businessId, userId, body, dependencies = {}) {
  const run = dependencies.query || query;
  const fetcher = dependencies.fetch || globalThis.fetch;
  const groupId = clean(body.groupId);
  const text = clean(body.text);
  if (!groupId || !text || text.length > 4096) throw new AppError('Provide a group and message up to 4096 characters.', 400, 'VALIDATION_ERROR');
  const group = (await run('SELECT id,meta_group_id FROM whatsapp_groups WHERE id=$1 AND business_id=$2', [groupId, businessId])).rows[0];
  if (!group) throw new AppError('Group not found in this workspace.', 404, 'GROUP_NOT_FOUND');
  const connection = await sendingConnection(businessId, run);
  const response = await fetcher(`https://graph.facebook.com/${metaGraphApiVersion()}/${connection.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'group', to: group.meta_group_id, type: 'text', text: { body: text } }),
    signal: globalThis.AbortSignal.timeout(20000)
  });
  const payload = await response.json();
  if (!response.ok || !payload.messages?.[0]?.id) throw new AppError(payload?.error?.message || 'Meta did not confirm the group message.', 409, 'GROUPS_SEND_FAILED');
  const messageId = id('gm');
  await run(
    `INSERT INTO whatsapp_group_messages(id,business_id,group_id,direction,body,message_type,status,meta_message_id,sender_ref,metadata)
     VALUES($1,$2,$3,'outgoing',$4,'text','sent',$5,$6,'{}')`,
    [messageId, businessId, group.id, text, payload.messages[0].id, userId]
  );
  await run('UPDATE whatsapp_groups SET updated_at=NOW() WHERE id=$1 AND business_id=$2', [group.id, businessId]);
  return { ok: true, messageId, metaMessageId: payload.messages[0].id, status: 'sent' };
}

export async function markWorkspaceGroupRead(businessId, groupId, run = query) {
  const result = await run(
    'UPDATE whatsapp_groups SET unread_count=0,last_read_at=NOW() WHERE id=$1 AND business_id=$2 RETURNING id',
    [clean(groupId), businessId]
  );
  if (!result.rows[0]) throw new AppError('Group not found in this workspace.', 404, 'GROUP_NOT_FOUND');
  return { ok: true };
}

export async function ingestWorkspaceGroupMessage(businessId, metaGroupId, rawMessage, at, runTransaction = transaction) {
  const normalized = safeGroupMessage(rawMessage);
  return runTransaction(async (client) => {
    const group = (await client.query('SELECT id FROM whatsapp_groups WHERE business_id=$1 AND meta_group_id=$2', [businessId, clean(metaGroupId)])).rows[0];
    if (!group) return { ignored: true };
    const inserted = await client.query(
      `INSERT INTO whatsapp_group_messages(id,business_id,group_id,direction,body,message_type,status,meta_message_id,sender_ref,metadata,at)
       VALUES($1,$2,$3,'incoming',$4,$5,'received',$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
      [id('gm'), businessId, group.id, normalized.body, normalized.type, clean(rawMessage.id), clean(rawMessage.from), JSON.stringify(normalized.metadata), at]
    );
    if (!inserted.rows[0]) return { duplicate: true };
    await client.query('UPDATE whatsapp_groups SET unread_count=unread_count+1,updated_at=$1 WHERE id=$2 AND business_id=$3', [at, group.id, businessId]);
    return { groupId: group.id, messageId: inserted.rows[0].id };
  });
}

export async function updateWorkspaceGroupMessageStatus(businessId, statusUpdate, run = query) {
  const status = clean(statusUpdate.status).toLowerCase();
  if (!['sent', 'delivered', 'read', 'failed'].includes(status)) return false;
  const result = await run(
    `UPDATE whatsapp_group_messages SET status=$1,
       metadata=CASE WHEN $1='failed' THEN metadata || jsonb_build_object('deliveryError',$4::text) ELSE metadata END
     WHERE business_id=$2 AND meta_message_id=$3`,
    [status, businessId, clean(statusUpdate.id), clean(statusUpdate.errors?.[0]?.message || statusUpdate.errors?.[0]?.title)]
  );
  return result.rowCount > 0;
}
