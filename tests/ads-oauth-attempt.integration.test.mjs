import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

test('ads OAuth attempt can be claimed once', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const { claimAdsOAuthAttempt } = await import('../lib/ads-meta-oauth.js');
  const suffix = crypto.randomBytes(6).toString('hex');
  const businessId = `test_b_${suffix}`;
  const hash = crypto.createHash('sha256').update(suffix).digest('hex');
  const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  const firstClient = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  const secondClient = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  await firstClient.connect();
  await secondClient.connect();
  try {
    await admin.query("SELECT set_config('app.system_access','true',false)");
    await admin.query("INSERT INTO businesses (id,name,slug) VALUES ($1,$2,$3)", [businessId, 'OAuth test', `oauth-${suffix}`]);
    await admin.query(
      `INSERT INTO ads_oauth_attempts (id,state_hash,business_id,user_id,session_version,login_session_id,requested_capabilities,redirect_uri,status,expires_at)
       VALUES ($1,$2,$3,$4,1,$5,'["ctwa"]'::jsonb,'https://crm.example.test/callback','pending',NOW()+INTERVAL '10 minutes')`,
      [`aoa_${suffix}`, hash, businessId, `user_${suffix}`, 'browser-a-session']
    );
    await firstClient.query("SELECT set_config('app.system_access','true',false)");
    await secondClient.query("SELECT set_config('app.system_access','true',false)");
    const [first, second] = await Promise.all([
      claimAdsOAuthAttempt(firstClient, hash),
      claimAdsOAuthAttempt(secondClient, hash)
    ]);
    const wins = [first, second].filter((result) => result.attempt);
    assert.equal(wins.length, 1);
    assert.equal(wins[0].attempt.business_id, businessId);
    const replay = await claimAdsOAuthAttempt(firstClient, hash);
    assert.equal(replay.code, 'META_OAUTH_REPLAY');
  } finally {
    await admin.query('DELETE FROM businesses WHERE id=$1', [businessId]);
    await admin.end();
    await firstClient.end();
    await secondClient.end();
  }
});

test('ads OAuth completion rejects a different browser session id', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const { oauthCompletionAllowed } = await import('../lib/ads-meta-oauth.js');
  const attempt = {
    user_id: 'user_1',
    business_id: 'biz_1',
    session_version: 2,
    login_session_id: 'browser-a'
  };
  assert.equal(oauthCompletionAllowed(attempt, { userId: 'user_1', businessId: 'biz_1', sessionVersion: 2, loginSessionId: 'browser-b' }).ok, false);
  assert.equal(oauthCompletionAllowed(attempt, { userId: 'user_1', businessId: 'biz_1', sessionVersion: 2, loginSessionId: 'browser-a' }).ok, true);
});
