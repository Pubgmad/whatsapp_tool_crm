import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

test('super-admin feature override is audited, tenant-scoped and reversible', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { enterSystemContext } = await import('../lib/db.js');
  const { saveCompanyFeatureOverride, workspaceFeatureFlags } = await import('../lib/feature-controls.js');
  const suffix = crypto.randomBytes(8).toString('hex');
  const businessId = `feature_business_${suffix}`;
  const otherId = `feature_other_${suffix}`;
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("SELECT set_config('app.system_access','true',false)");
    await client.query('INSERT INTO businesses(id,name,slug,account_status) VALUES($1,$2,$3,$4),($5,$6,$7,$8)', [businessId,'Feature test',`feature-${suffix}`,'active',otherId,'Other test',`other-${suffix}`,'active']);
    enterSystemContext();
    await saveCompanyFeatureOverride({ businessId, feature: 'calling', enabled: false, adminId: 'test-admin' });
    assert.equal((await workspaceFeatureFlags(businessId)).calling, false);
    assert.equal((await workspaceFeatureFlags(otherId)).calling, true);
    await saveCompanyFeatureOverride({ businessId, feature: 'calling', enabled: null, adminId: 'test-admin' });
    assert.equal((await workspaceFeatureFlags(businessId)).calling, true);
    const audits = await client.query("SELECT count(*)::int AS total FROM audit_logs WHERE business_id=$1 AND action='super_admin_feature_updated'", [businessId]);
    assert.equal(audits.rows[0].total, 2);
    await assert.rejects(saveCompanyFeatureOverride({ businessId, feature: 'unknown', enabled: false, adminId: 'test-admin' }), { code: 'VALIDATION_ERROR' });
  } finally {
    await client.query('DELETE FROM businesses WHERE id=ANY($1)', [[businessId, otherId]]);
    await client.end();
  }
});
