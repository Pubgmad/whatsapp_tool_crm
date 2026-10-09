import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import process from 'node:process';
import {
  canAccessInboxContact,
  decodeTimelineCursor,
  encodeTimelineCursor,
  loadInboxContactProfile,
  loadInboxContactTimeline,
  parseTimelineLimit,
  updateInboxContactTags
} from '../lib/inbox-contact-360.js';
import { enterSystemContext, query } from '../lib/db.js';

test('contact timeline cursors are opaque, validated, and bounded', () => {
  const cursor = encodeTimelineCursor({ occurredAt: '2026-10-09T10:00:00.000Z', key: 'message:m_1' });
  assert.deepEqual(decodeTimelineCursor(cursor), { at: '2026-10-09T10:00:00.000Z', key: 'message:m_1' });
  assert.throws(() => decodeTimelineCursor('not-a-cursor'), { code: 'INVALID_TIMELINE_CURSOR' });
  assert.equal(parseTimelineLimit('0'), 1);
  assert.equal(parseTimelineLimit('5000'), 100);
  assert.equal(parseTimelineLimit('invalid'), 30);
});

test('inbox contact RBAC mirrors reads and restricts agent writes', () => {
  const owner = { role: 'Owner', userId: 'owner' };
  const agent = { role: 'Agent', userId: 'agent_1' };
  assert.equal(canAccessInboxContact(owner, null), true);
  assert.equal(canAccessInboxContact(agent, { conversation_id: 'c1', assigned_user_id: null }), true);
  assert.equal(canAccessInboxContact(agent, { conversation_id: 'c1', assigned_user_id: null }, { write: true }), false);
  assert.equal(canAccessInboxContact(agent, { conversation_id: 'c1', assigned_user_id: 'agent_1' }, { write: true }), true);
  assert.equal(canAccessInboxContact(agent, { conversation_id: 'c1', assigned_user_id: 'agent_2' }), false);
  assert.equal(canAccessInboxContact(agent, { assigned_user_id: null }), false);
});

test('contact 360 is tenant-scoped, cursor-paginated, and audits tag edits', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix = crypto.randomBytes(6).toString('hex');
  const businessId = `c360_business_${suffix}`;
  const otherBusinessId = `c360_other_${suffix}`;
  const userId = `c360_user_${suffix}`;
  const contactId = `c360_contact_${suffix}`;
  const conversationId = `c360_conversation_${suffix}`;
  try {
    await query("INSERT INTO businesses(id,name,slug,account_status) VALUES($1,$1,$1,'active'),($2,$2,$2,'active')", [businessId, otherBusinessId]);
    await query("INSERT INTO users(id,name,email,password_hash) VALUES($1,'Agent',$2,'test')", [userId, `${userId}@example.test`]);
    await query('INSERT INTO contacts(id,business_id,name,phone,custom_attributes) VALUES($1,$2,$3,$4,$5::jsonb)', [
      contactId, businessId, 'Contact 360', `+1555${suffix.slice(0, 6)}`, JSON.stringify({ tier: 'gold' })
    ]);
    await query('INSERT INTO conversations(id,business_id,contact_id,assigned_user_id,first_referral,first_referral_at) VALUES($1,$2,$3,$4,$5::jsonb,NOW()-INTERVAL \'3 minutes\')', [
      conversationId, businessId, contactId, userId, JSON.stringify({ sourceType: 'AD', sourceId: 'ad_1' })
    ]);
    await query("INSERT INTO messages(id,conversation_id,direction,body,at) VALUES($1,$3,'incoming','First',NOW()-INTERVAL '2 minutes'),($2,$3,'outgoing','Second',NOW()-INTERVAL '1 minute')", [
      `c360_m1_${suffix}`, `c360_m2_${suffix}`, conversationId
    ]);

    const agent = { role: 'Agent', userId };
    const profile = await loadInboxContactProfile(businessId, contactId, agent);
    assert.equal(profile.contact.attributes.tier, 'gold');
    assert.equal(profile.assignment.assignedUserId, userId);
    assert.equal(profile.referral.attribution, 'direct');
    assert.equal(profile.permissions.canEditTags, true);

    const firstPage = await loadInboxContactTimeline(businessId, contactId, agent, { limit: 1 });
    assert.equal(firstPage.items.length, 1);
    assert.equal(firstPage.page.hasMore, true);
    const secondPage = await loadInboxContactTimeline(businessId, contactId, agent, { limit: 1, cursor: firstPage.page.nextCursor });
    assert.notEqual(secondPage.items[0].key, firstPage.items[0].key);

    const updated = await updateInboxContactTags(
      new globalThis.Request('http://localhost/api/workspace/inbox/contacts/contact', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tags: ['VIP', 'vip', 'support'] })
      }),
      businessId,
      contactId,
      agent
    );
    assert.deepEqual(updated.tags, ['vip', 'support']);
    const audit = await query("SELECT metadata FROM audit_logs WHERE business_id=$1 AND action='inbox_contact_tags_updated'", [businessId]);
    assert.equal(audit.rows[0].metadata.contactId, contactId);

    await assert.rejects(loadInboxContactProfile(otherBusinessId, contactId, { role: 'Owner', userId }), { code: 'CONTACT_NOT_FOUND' });
    await query('UPDATE conversations SET assigned_user_id=NULL WHERE id=$1', [conversationId]);
    await assert.rejects(
      updateInboxContactTags(
        new globalThis.Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ tags: ['denied'] }) }),
        businessId,
        contactId,
        agent
      ),
      { code: 'INBOX_CONTACT_FORBIDDEN' }
    );
  } finally {
    enterSystemContext();
    await query('DELETE FROM users WHERE id=$1', [userId]);
    await query('DELETE FROM businesses WHERE id IN($1,$2)', [businessId, otherBusinessId]);
  }
});
