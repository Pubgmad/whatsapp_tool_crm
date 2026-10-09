import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupsEntitlement,
  ingestWorkspaceGroupMessage,
  loadWorkspaceGroupsInbox,
  safeGroupMessage,
  updateWorkspaceGroupMessageStatus
} from '../lib/workspace-groups-inbox.js';

test('group entitlement is granted only by Meta AVAILABLE status', () => {
  assert.deepEqual(groupsEntitlement('AVAILABLE'), { status: 'AVAILABLE', entitled: true });
  for (const status of ['UNKNOWN', 'ACTIVE', 'enabled', '', null]) {
    assert.equal(groupsEntitlement(status).entitled, false);
  }
});

test('unsupported group content is represented safely without rendering payload data', () => {
  assert.deepEqual(safeGroupMessage({ type: 'text', text: { body: ' hello ' } }), {
    type: 'text', body: 'hello', supported: true, metadata: {}
  });
  assert.deepEqual(safeGroupMessage({ type: 'reaction', reaction: { emoji: '<script>' } }), {
    type: 'reaction', body: '[Unsupported reaction message]', supported: false, metadata: { unsupported: true }
  });
});

test('group inbox search and message loading remain tenant scoped and paginated', async () => {
  const calls = [];
  const responses = [
    { rows: [{ status: 'AVAILABLE' }] },
    { rows: [{ total: 1 }] },
    { rows: [{ id: 'g1', subject: 'Ops', participant_count: 3, meta_group_id: 'meta-1', sync_status: 'synced', unread_count: 2, updated_at: new Date('2026-10-09T10:00:00Z') }] },
    { rows: [{ id: 'g1' }] },
    { rows: [{ total: 1 }] },
    { rows: [{ id: 'gm1', direction: 'incoming', body: '[Unsupported image message]', message_type: 'image', status: 'received', meta_message_id: 'wamid.1', sender_ref: 'person', metadata: { unsupported: true }, at: new Date('2026-10-09T10:00:00Z') }] }
  ];
  const run = async (sql, args) => {
    calls.push({ sql, args });
    return responses.shift();
  };
  const result = await loadWorkspaceGroupsInbox('business-1', { q: 'Ops', page: 1, pageSize: 10, groupId: 'g1' }, run);
  assert.equal(result.entitlement.entitled, true);
  assert.equal(result.groups[0].unreadCount, 2);
  assert.equal(result.messages[0].unsupported, true);
  assert.ok(calls.every((call) => call.args.includes('business-1')));
  assert.match(calls[2].sql, /ILIKE/);
  assert.deepEqual(calls[2].args.slice(-2), [10, 0]);
});

test('group webhook ingestion deduplicates and increments unread inside one transaction', async () => {
  const calls = [];
  const transaction = async (work) => work({
    query: async (sql, args) => {
      calls.push({ sql, args });
      if (sql.startsWith('SELECT id FROM whatsapp_groups')) return { rows: [{ id: 'g1' }] };
      if (sql.includes('INSERT INTO whatsapp_group_messages')) return { rows: [{ id: 'gm1' }] };
      return { rows: [], rowCount: 1 };
    }
  });
  const result = await ingestWorkspaceGroupMessage(
    'business-1',
    'meta-group-1',
    { id: 'wamid.1', from: 'sender-1', type: 'document', document: { filename: '<b>unsafe</b>' } },
    new Date('2026-10-09T10:00:00Z'),
    transaction
  );
  assert.equal(result.groupId, 'g1');
  assert.equal(calls[1].args[3], '[Unsupported document message]');
  assert.match(calls[2].sql, /unread_count=unread_count\+1/);
});

test('delivery updates touch only tenant-owned group messages', async () => {
  let captured;
  const changed = await updateWorkspaceGroupMessageStatus('business-1', { id: 'wamid.1', status: 'delivered' }, async (sql, args) => {
    captured = { sql, args };
    return { rowCount: 1 };
  });
  assert.equal(changed, true);
  assert.match(captured.sql, /business_id=\$2/);
  assert.deepEqual(captured.args.slice(0, 3), ['delivered', 'business-1', 'wamid.1']);
});
