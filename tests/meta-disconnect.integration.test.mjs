import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

test('local WhatsApp disconnect clears credentials without a remote token', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const suffix = crypto.randomBytes(6).toString('hex');
  const businessId = `test_b_${suffix}`;
  const userId = `test_u_${suffix}`;
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("SELECT set_config('app.system_access','true',false)");
    await client.query('INSERT INTO users (id,name,email,password_hash) VALUES ($1,$2,$3,$4)', [
      userId,
      'Owner',
      `owner-${suffix}@example.test`,
      'scrypt:00:00'
    ]);
    await client.query(
      'INSERT INTO businesses (id,name,slug,waba_id,access_token_encrypted,webhook_subscribed,status) VALUES ($1,$2,$3,$4,$5,TRUE,$6)',
      [businessId, 'Disc', `disc-${suffix}`, `waba_${suffix}`, '', 'Connected']
    );
    await client.query(
      'INSERT INTO meta_authorizations (id,business_id,meta_user_id,integration,status,is_current) VALUES ($1,$2,$3,$4,$5,TRUE)',
      [`ma_${suffix}`, businessId, `meta_${suffix}`, 'whatsapp', 'active']
    );
    const { applyLocalWhatsAppDisconnect } = await import('../lib/meta-disconnect-local.js');
    await applyLocalWhatsAppDisconnect({ businessId, userId, remoteCleanupState: 'not_required' });
    const business = await client.query('SELECT access_token_encrypted,waba_id FROM businesses WHERE id=$1', [businessId]);
    assert.equal(business.rows[0].access_token_encrypted, '');
    assert.equal(business.rows[0].waba_id, '');
    const auth = await client.query('SELECT status FROM meta_authorizations WHERE business_id=$1', [businessId]);
    assert.equal(auth.rows[0].status, 'revoked');
  } finally {
    await client.query('DELETE FROM users WHERE id=$1', [userId]);
    await client.query('DELETE FROM businesses WHERE id=$1', [businessId]);
    await client.end();
  }
});
