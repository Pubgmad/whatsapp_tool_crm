import assert from 'node:assert/strict';
import test from 'node:test';
import { inboxWhereClause } from '../lib/workspace-inbox-loader.js';

test('inbox replyable filter requires open status and 24h contact window', () => {
  const clause = inboxWhereClause({ inboxFilter: 'replyable' }, 'biz-1', 'user-1', true);
  assert.match(clause.sql, /c\.status = 'open'/);
  assert.match(clause.sql, /t\.last_message_at IS NOT NULL/);
  assert.match(clause.sql, /INTERVAL '24 hours'/);
  assert.equal(clause.joinContacts, true);
  assert.deepEqual(clause.binds, ['biz-1']);
});

test('inbox active filter is open conversations only', () => {
  const clause = inboxWhereClause({ inboxFilter: 'active' }, 'biz-1', 'user-1', true);
  assert.match(clause.sql, /c\.status = 'open'/);
  assert.doesNotMatch(clause.sql, /last_message_at/);
  assert.equal(clause.joinContacts, false);
});

test('inbox mine filter scopes to assigned agent', () => {
  const clause = inboxWhereClause({ inboxFilter: 'mine' }, 'biz-1', 'agent-9', false);
  assert.match(clause.sql, /c\.assigned_user_id = \$2/);
  assert.deepEqual(clause.binds, ['biz-1', 'agent-9']);
});

test('agents cannot list other agents assigned chats under all filter', () => {
  const clause = inboxWhereClause({ inboxFilter: 'all' }, 'biz-1', 'agent-9', false);
  assert.match(clause.sql, /c\.assigned_user_id IS NULL OR c\.assigned_user_id = \$2/);
  assert.deepEqual(clause.binds, ['biz-1', 'agent-9']);
});

test('managers see all conversations without ownership clamp', () => {
  const clause = inboxWhereClause({ inboxFilter: 'all' }, 'biz-1', 'mgr-1', true);
  assert.doesNotMatch(clause.sql, /assigned_user_id IS NULL OR/);
  assert.deepEqual(clause.binds, ['biz-1']);
});

test('search joins contacts and scopes ILIKE binds', () => {
  const clause = inboxWhereClause({ inboxFilter: 'all', q: 'Ada' }, 'biz-1', 'mgr-1', true);
  assert.equal(clause.joinContacts, true);
  assert.match(clause.sql, /t\.name ILIKE \$2 OR t\.phone ILIKE \$2/);
  assert.deepEqual(clause.binds, ['biz-1', '%Ada%']);
});

test('requesting filter requires latest inbound message', () => {
  const clause = inboxWhereClause({ inboxFilter: 'requesting' }, 'biz-1', 'mgr-1', true);
  assert.match(clause.sql, /direction FROM messages/);
  assert.match(clause.sql, /'incoming'/);
});
