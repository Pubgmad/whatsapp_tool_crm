import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createSessionToken, hashPassword } from '../lib/auth.js';
import { createCsrfToken } from '../lib/security.js';
import { enterSystemContext, query } from '../lib/db.js';
import { acceptTeamInvitation, createTeamInvitation, getTeamInvitations, removeTeamMember, revokeTeamInvitation, updateTeamMember } from '../lib/team.js';

test('team invite create, accept, revoke, and membership mutations stay tenant-scoped', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const previousAuth = process.env.AUTH_SECRET;
  const previousCsrf = process.env.CSRF_SECRET;
  process.env.AUTH_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.CSRF_SECRET = crypto.randomBytes(32).toString('hex');
  enterSystemContext();

  const suffix = crypto.randomBytes(6).toString('hex');
  const business = `team_b_${suffix}`;
  const other = `team_o_${suffix}`;
  const ownerId = `team_owner_${suffix}`;
  const agentId = `team_agent_${suffix}`;
  const inviteEmail = `invite-${suffix}@example.test`;
  const base = process.env.APP_URL || 'https://example.test';
  const csrf = createCsrfToken();
  const ownerToken = createSessionToken({ userId: ownerId, businessId: business, role: 'Owner', sessionVersion: 0 });
  const agentToken = createSessionToken({ userId: agentId, businessId: business, role: 'Agent', sessionVersion: 0 });

  const ownerRequest = (path, { method = 'GET', body, role = 'Owner' } = {}) => {
    const token = role === 'Owner' ? ownerToken : agentToken;
    return new Request(new URL(path, base), {
      method,
      headers: {
        cookie: `wcrm_session=${encodeURIComponent(token)}; wcrm_csrf=${encodeURIComponent(csrf)}`,
        origin: new URL(base).origin,
        'x-csrf-token': csrf,
        'content-type': 'application/json'
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  };

  try {
    await query("INSERT INTO businesses (id,name,slug,account_status) VALUES ($1,$1,$1,'active'),($2,$2,$2,'active')", [business, other]);
    await query("INSERT INTO users (id,name,email,password_hash,email_verified_at) VALUES ($1,'Owner',$2,$3,NOW()),($4,'Agent',$5,$3,NOW())", [
      ownerId, `${ownerId}@example.test`, hashPassword('Aa1' + crypto.randomBytes(12).toString('base64url')),
      agentId, `${agentId}@example.test`
    ]);
    await query("INSERT INTO memberships (id,user_id,business_id,role,availability) VALUES ($1,$2,$3,'Owner','available'),($4,$5,$3,'Agent','offline')", [
      `mb_${ownerId}`, ownerId, business, `mb_${agentId}`, agentId
    ]);
    const planId = (await query("SELECT id FROM subscription_plans WHERE is_active=TRUE ORDER BY display_order NULLS LAST, created_at LIMIT 1")).rows[0]?.id;
    if (planId) {
      await query(
        `INSERT INTO business_subscriptions (id,business_id,plan_id,status,payment_status,starts_at,current_period_start,current_period_end,renews_at)
         VALUES ($1,$2,$3,'active','paid',NOW(),NOW(),NOW()+INTERVAL '30 days',NOW()+INTERVAL '30 days')
         ON CONFLICT (business_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,status='active',payment_status='paid',current_period_end=EXCLUDED.current_period_end`,
        [`sub_${suffix}`, business, planId]
      );
    }

    const forbidden = await createTeamInvitation(ownerRequest('/api/team/invitations', { method: 'POST', body: { email: inviteEmail, role: 'Agent' }, role: 'Agent' }));
    assert.equal(forbidden.status, 403);

    const created = await createTeamInvitation(ownerRequest('/api/team/invitations', { method: 'POST', body: { email: inviteEmail, role: 'Manager' } }));
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.ok(createdBody.inviteUrl.includes('/invite/'));
    assert.equal(createdBody.invitations[0].email, inviteEmail);
    assert.equal(createdBody.invitations[0].role, 'Manager');

    const listed = await getTeamInvitations(ownerRequest('/api/team/invitations'));
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).invitations.length, 1);

    const inviteToken = createdBody.inviteUrl.split('/invite/')[1];
    const accept = await acceptTeamInvitation(ownerRequest(`/api/team/accept/${inviteToken}`, {
      method: 'POST',
      body: { name: 'Invited Manager', password: 'Aa1' + crypto.randomBytes(12).toString('base64url') }
    }), { params: Promise.resolve({ token: inviteToken }) });
    assert.equal(accept.status, 201);
    enterSystemContext();
    const membership = await query("SELECT role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.business_id=$1 AND u.email=$2", [business, inviteEmail]);
    assert.equal(membership.rows[0]?.role, 'Manager');

    const invitedUserId = (await query("SELECT id FROM users WHERE email=$1", [inviteEmail])).rows[0].id;
    const demoted = await updateTeamMember(ownerRequest(`/api/team/members/${invitedUserId}`, {
      method: 'PATCH',
      body: { role: 'Agent' }
    }), { params: Promise.resolve({ id: invitedUserId }) });
    assert.equal(demoted.status, 200);
    enterSystemContext();
    assert.equal((await query("SELECT role FROM memberships WHERE business_id=$1 AND user_id=$2", [business, invitedUserId])).rows[0].role, 'Agent');

    const removed = await removeTeamMember(ownerRequest(`/api/team/members/${invitedUserId}`, { method: 'DELETE' }), { params: Promise.resolve({ id: invitedUserId }) });
    assert.equal(removed.status, 200);

    const reinvite = await createTeamInvitation(ownerRequest('/api/team/invitations', { method: 'POST', body: { email: `second-${suffix}@example.test`, role: 'Agent' } }));
    const inviteId = (await reinvite.json()).invitations[0].id;
    const revoked = await revokeTeamInvitation(ownerRequest(`/api/team/invitations/${inviteId}`, { method: 'DELETE' }), { params: Promise.resolve({ id: inviteId }) });
    assert.equal(revoked.status, 200);
    assert.equal((await revoked.json()).invitations.length, 0);
  } finally {
    enterSystemContext();
    await query('DELETE FROM businesses WHERE id IN ($1,$2)', [business, other]);
    await query("DELETE FROM users WHERE email LIKE $1 OR id IN ($2,$3)", [`%${suffix}@example.test`, ownerId, agentId]);
    await query('DELETE FROM subscription_plans WHERE id=$1', [`plan_team_${suffix}`]).catch(() => {});
    if (previousAuth === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousAuth;
    if (previousCsrf === undefined) delete process.env.CSRF_SECRET; else process.env.CSRF_SECRET = previousCsrf;
  }
});
