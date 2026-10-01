import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createSessionToken } from '../lib/auth.js';
import { enterSystemContext, query } from '../lib/db.js';
import { getAudienceSegments, pageAudienceSegments } from '../lib/segments.js';

test('saved segments page and search within a workspace', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = crypto.randomBytes(32).toString('hex');
  enterSystemContext();
  const suffix = crypto.randomBytes(8).toString('hex');
  const business = 'segment_b_' + suffix;
  const other = 'segment_o_' + suffix;
  const user = 'segment_u_' + suffix;
  try {
    await query('INSERT INTO businesses(id,name,slug) VALUES($1,$1,$1),($2,$2,$2)', [business, other]);
    await query("INSERT INTO users(id,name,email,password_hash) VALUES($1,$1,$2,'unused')", [user, user + '@example.test']);
    await query("INSERT INTO memberships(id,user_id,business_id,role) VALUES($1,$2,$3,'Owner')", ['segment_m_' + suffix, user, business]);
    for (let index = 0; index < 27; index++) {
      await query('INSERT INTO audience_segments(id,business_id,name,is_active) VALUES($1,$2,$3,$4)', [
        'segment_' + index + '_' + suffix, business, index === 26 ? 'Needle' : 'Segment ' + index, index !== 25
      ]);
    }
    await query("INSERT INTO audience_segments(id,business_id,name) VALUES($1,$2,'Other workspace')", ['segment_other_' + suffix, other]);
    const first = await pageAudienceSegments(business);
    const second = await pageAudienceSegments(business, { page: 2 });
    assert.equal(first.segments.length, 25);
    assert.equal(first.hasMore, true);
    assert.equal(second.segments.length, 2);
    assert.equal(second.hasMore, false);
    assert.equal(first.segments.every(item => item.contactCount === 0), true);
    const match = await pageAudienceSegments(business, { search: 'needle', activeOnly: true });
    assert.deepEqual(match.segments.map(item => item.name), ['Needle']);
    const inactive = await pageAudienceSegments(business, { segmentId: 'segment_25_' + suffix, activeOnly: true });
    assert.equal(inactive.segments.length, 0);
    const token = createSessionToken({ userId: user, businessId: business, role: 'Owner', sessionVersion: 0 });
    const response = await getAudienceSegments(new Request('https://crm.example.test/api/segments?page=2', {
      headers: { cookie: 'wcrm_session=' + encodeURIComponent(token) }
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.segments.length, 2);
    assert.equal(body.segments.some(item => item.name === 'Other workspace'), false);
  } finally {
    enterSystemContext();
    await query('DELETE FROM businesses WHERE id IN ($1,$2)', [business, other]);
    await query('DELETE FROM users WHERE id=$1', [user]);
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});
