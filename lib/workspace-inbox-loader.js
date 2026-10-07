import { query, toIso } from './db.js';
import { mapContact, mapConversation, mapMessage, clean } from './workspace-mappers.js';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function pageMeta(total, page, pageSize) {
  const pages = Math.max(1, Math.ceil(Number(total || 0) / pageSize));
  return { page: Math.min(page, pages), pageSize, total: Number(total || 0), pages };
}

function inboxWhereClause(options, businessId, userId, manager) {
  const binds = [businessId];
  const parts = ['c.business_id = $1'];
  let index = 2;
  const filter = clean(options.inboxFilter || 'all');
  if (filter === 'mine' && userId) {
    parts.push(`c.assigned_user_id = $${index++}`);
    binds.push(userId);
  } else if (filter === 'unassigned') {
    parts.push('c.assigned_user_id IS NULL');
  } else if (filter === 'human') {
    parts.push('c.automation_paused = TRUE');
  } else if (filter === 'unread') {
    parts.push('c.unread_count > 0');
  } else if (filter === 'closed') {
    parts.push("c.status = 'closed'");
  } else if (filter === 'replyable') {
    parts.push("c.status = 'open'");
  } else if (filter === 'groups') {
    parts.push("COALESCE(c.channel_kind, 'direct') = 'group'");
  }
  if (!manager && userId && filter === 'all') {
    parts.push(`(c.assigned_user_id IS NULL OR c.assigned_user_id = $${index++})`);
    binds.push(userId);
  }
  const q = clean(options.q);
  if (q) {
    parts.push(`(t.name ILIKE $${index} OR t.phone ILIKE $${index})`);
    binds.push(`%${q.slice(0, 120)}%`);
    index++;
  }
  return { sql: parts.join(' AND '), binds, joinContacts: Boolean(q) };
}

export async function loadWorkspaceInbox(businessId, options = {}, account = null) {
  const page = Math.max(1, Math.min(Number(options.page) || 1, 100000));
  const pageSize = Math.max(1, Math.min(Number(options.pageSize) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
  const cursorUpdatedAt = options.cursorUpdatedAt ? new Date(options.cursorUpdatedAt) : null;
  const cursorId = clean(options.cursorId);
  const manager = account && ['Owner', 'Manager'].includes(account.role);
  const userId = account?.userId || '';
  const { sql, binds, joinContacts } = inboxWhereClause(options, businessId, userId, manager);
  const from = joinContacts
    ? `conversations c JOIN contacts t ON t.id = c.contact_id AND t.business_id = c.business_id`
    : 'conversations c';
  const totalResult = await query(`SELECT COUNT(*)::int AS total FROM ${from} WHERE ${sql}`, binds);
  const pagination = pageMeta(totalResult.rows[0]?.total, page, pageSize);
  const useCursor = cursorUpdatedAt && !Number.isNaN(cursorUpdatedAt.getTime()) && cursorId;
  const pageResult = useCursor
    ? await query(
        `SELECT c.* FROM ${from} WHERE ${sql} AND (c.updated_at < $${binds.length + 1} OR (c.updated_at = $${binds.length + 1} AND c.id < $${binds.length + 2}))
         ORDER BY c.updated_at DESC, c.id DESC LIMIT $${binds.length + 3}`,
        [...binds, cursorUpdatedAt.toISOString(), cursorId, pageSize]
      )
    : await query(
        `SELECT c.* FROM ${from} WHERE ${sql} ORDER BY c.updated_at DESC, c.id DESC LIMIT $${binds.length + 1} OFFSET $${binds.length + 2}`,
        [...binds, pagination.pageSize, (pagination.page - 1) * pagination.pageSize]
      );
  let conversations = pageResult.rows;
  if (options.conversationId && !conversations.some((row) => row.id === options.conversationId)) {
    const selected = await query('SELECT * FROM conversations WHERE id = $1 AND business_id = $2', [options.conversationId, businessId]);
    if (selected.rows[0]) conversations = [selected.rows[0], ...conversations];
  }
  const selectedId = options.conversationId || conversations[0]?.id || '';
  const contactIds = [...new Set(conversations.map((row) => row.contact_id))];
  const contacts = contactIds.length
    ? await query('SELECT * FROM contacts WHERE business_id = $1 AND id = ANY($2)', [businessId, contactIds])
    : { rows: [] };
  const latestMessages = conversations.length
    ? await query(
        `SELECT DISTINCT ON (m.conversation_id) m.* FROM messages m
         WHERE m.conversation_id = ANY($1) ORDER BY m.conversation_id, m.at DESC`,
        [conversations.map((row) => row.id)]
      )
    : { rows: [] };
  const messagePage = Math.max(1, Number(options.messagePage) || 1);
  const notePage = Math.max(1, Number(options.notePage) || 1);
  const messageTotal = selectedId
    ? await query(
        `SELECT COUNT(*)::int AS total FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.conversation_id = $1 AND c.business_id = $2`,
        [selectedId, businessId]
      )
    : { rows: [{ total: 0 }] };
  const messagePagination = pageMeta(messageTotal.rows[0]?.total, messagePage, pageSize);
  const selectedMessages = selectedId
    ? await query(
        `SELECT * FROM (
       SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE m.conversation_id = $1 AND c.business_id = $2 ORDER BY m.at DESC LIMIT $3 OFFSET $4
     ) recent ORDER BY at ASC`,
        [selectedId, businessId, messagePagination.pageSize, (messagePagination.page - 1) * messagePagination.pageSize]
      )
    : { rows: [] };
  const noteTotal = selectedId
    ? await query('SELECT COUNT(*)::int AS total FROM conversation_notes WHERE business_id=$1 AND conversation_id=$2', [businessId, selectedId])
    : { rows: [{ total: 0 }] };
  const notePagination = pageMeta(noteTotal.rows[0]?.total, notePage, pageSize);
  const notes = selectedId
    ? await query(
        `SELECT * FROM (SELECT n.*,u.name AS user_name,u.email AS user_email FROM conversation_notes n
     JOIN users u ON u.id=n.user_id WHERE n.business_id=$1 AND n.conversation_id=$2
     ORDER BY n.created_at DESC,n.id DESC LIMIT $3 OFFSET $4) recent ORDER BY created_at ASC,id ASC`,
        [businessId, selectedId, notePagination.pageSize, (notePagination.page - 1) * notePagination.pageSize]
      )
    : { rows: [] };
  const contactById = new Map(contacts.rows.map((row) => [row.id, row]));
  return {
    contacts: contacts.rows.map(mapContact),
    conversations: conversations.map((conversation) => {
      const selected = conversation.id === selectedId;
      const messages = selected
        ? selectedMessages.rows.map(mapMessage)
        : latestMessages.rows.filter((message) => message.conversation_id === conversation.id).map(mapMessage);
      const conversationNotes = selected
        ? notes.rows.map((note) => ({
            id: note.id,
            body: note.body,
            userId: note.user_id,
            author: note.user_name || note.user_email,
            createdAt: toIso(note.created_at)
          }))
        : [];
      return mapConversation(conversation, contactById.get(conversation.contact_id), messages, conversationNotes);
    }),
    pagination: {
      inbox: {
        ...pagination,
        mode: useCursor ? 'cursor' : 'offset',
        nextCursor: conversations.length
          ? {
              updatedAt: toIso(conversations[conversations.length - 1].updated_at),
              id: conversations[conversations.length - 1].id
            }
          : null
      },
      messages: messagePagination,
      notes: notePagination
    }
  };
}
