import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import pg from 'pg';
import { databaseSslConfig } from '../lib/db.js';

const adminUrl = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5433/postgres';
const suffix = crypto.randomBytes(4).toString('hex');
const dbName = `wcrm_mig_${suffix}`;
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${dbName}`;
const connectionString = testUrl.toString();
const baselineRoot = new URL('../whatsapp_tool_crm_baseline/', import.meta.url);
const currentRoot = new URL('../', import.meta.url);
const log = [];

function run(cmd, args, { cwd, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} failed (${code})`))));
  });
}

const admin = new pg.Client({ connectionString: adminUrl, ssl: databaseSslConfig() });
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  log.push(`created ${dbName}`);
  const env = {
    DATABASE_URL: connectionString,
    DATABASE_MIGRATION_URL: connectionString,
    AUTH_SECRET: process.env.AUTH_SECRET || 'migration-matrix-auth',
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex'),
    META_APP_SECRET: process.env.META_APP_SECRET || 'migration-matrix-meta',
    SUPER_ADMIN_SESSION_SECRET: process.env.SUPER_ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex')
  };
  await run(process.execPath, ['scripts/db-init.mjs'], { cwd: baselineRoot, env });
  log.push('step1 baseline db:init ok');
  const seed = new pg.Client({ connectionString, ssl: databaseSslConfig() });
  await seed.connect();
  const businessId = `mig_b_${suffix}`;
  await seed.query("SELECT set_config('app.system_access','true',false)");
  await seed.query('INSERT INTO businesses (id,name,slug,status) VALUES ($1,$2,$3,$4)', [businessId, 'Mig Co', `mig-${suffix}`, 'Connected']);
  await seed.query(
    `INSERT INTO meta_authorizations (id,business_id,meta_user_id,integration,status,is_current)
     VALUES ($1,$2,$3,'whatsapp','active',TRUE)`,
    [`ma_${suffix}`, businessId, `meta_${suffix}`]
  );
  await seed.query(
    `INSERT INTO meta_leadgen_submissions (id,business_id,form_id,lead_id,field_data)
     VALUES ($1,$2,'f1','lead1','[]'::jsonb)`,
    [`mlg_${suffix}`, businessId]
  );
  await seed.query(
    `INSERT INTO meta_data_deletion_requests (id,confirmation_code,meta_user_id_hash,status,result_code,businesses_affected)
     VALUES ($1,$2,$3,'completed','deleted',1)`,
    [`mdr_${suffix}`, `mdl_${'a'.repeat(32)}`, crypto.createHmac('sha256', env.META_APP_SECRET).update(`meta_${suffix}`).digest('hex')]
  );
  await seed.end();
  log.push('step2 seed ok');
  const sql = await fs.readFile(new URL('../db/meta-integration-defects.sql', import.meta.url), 'utf8');
  const mig = new pg.Client({ connectionString, ssl: databaseSslConfig() });
  await mig.connect();
  await mig.query(sql);
  await mig.end();
  log.push('step3 meta-integration-defects.sql ok');
  await run(process.execPath, ['scripts/db-init.mjs'], { cwd: currentRoot, env });
  log.push('step4 current db:init idempotent ok');
  const verify = new pg.Client({ connectionString, ssl: databaseSslConfig() });
  await verify.connect();
  const cols = await verify.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name='ads_oauth_attempts' AND column_name='login_session_id'`
  );
  assertCol(cols.rowCount === 1, 'login_session_id column');
  await verify.query(
    `INSERT INTO ads_oauth_attempts (id,state_hash,business_id,user_id,session_version,login_session_id,requested_capabilities,redirect_uri,status,expires_at)
     VALUES ($1,$2,$3,$4,0,$5,'[]'::jsonb,'', 'pending', NOW()+INTERVAL '1 hour')`,
    [`aoa_${suffix}`, crypto.createHash('sha256').update(suffix).digest('hex'), businessId, `u_${suffix}`, 'browser-1']
  );
  const { enqueueMetaRemoteCleanup } = await import('../lib/meta-remote-cleanup.js');
  process.env.DATABASE_URL = connectionString;
  const jobId = await enqueueMetaRemoteCleanup({
    businessId,
    wabaId: '123',
    accessTokenEncrypted: 'enc-placeholder',
    authorizationSeq: 1
  });
  assertCol(Boolean(jobId), 'remote cleanup job');
  await verify.end();
  log.push('step5 new-app smoke ok');
  await run(process.execPath, ['--import', './tests/preload.mjs', '--test', 'tests/meta-deletion.integration.test.mjs'], {
    cwd: currentRoot,
    env: { ...env, TEST_DATABASE_URL: connectionString }
  });
  log.push('step5 meta-deletion integration on migrated db ok');
  await run(process.execPath, ['--import', './tests/preload.mjs', '--test', 'tests/ads-meta-oauth.test.mjs'], {
    cwd: baselineRoot,
    env: { ...env, TEST_DATABASE_URL: connectionString, AUTH_SECRET: env.AUTH_SECRET }
  });
  log.push('step6 baseline unit ads-oauth on migrated db ok');
  let baselineDeletionOk = false;
  try {
    await run(process.execPath, ['--import', './tests/preload.mjs', '--test', 'tests/meta-deletion.integration.test.mjs'], {
      cwd: baselineRoot,
      env: { ...env, TEST_DATABASE_URL: connectionString, META_APP_SECRET: env.META_APP_SECRET, APP_URL: 'https://crm.example.test' }
    });
    baselineDeletionOk = true;
    log.push('step6 baseline meta-deletion integration ok');
  } catch (error) {
    log.push(`step6 baseline meta-deletion integration failed: ${error.message}`);
  }
  const oldDisconnect = await import(new URL('../whatsapp_tool_crm_baseline/lib/meta-onboarding.js', import.meta.url).href).catch(() => null);
  if (oldDisconnect?.disconnectMeta) {
    log.push('step6 old disconnectMeta export present (rollback must not rely on remote unsubscribe success)');
  }
  console.log(JSON.stringify({ dbName, log, baselineDeletionOk, codeRollback: 'unsupported if old disconnect or worker ignores meta_remote_cleanup_jobs' }, null, 2));
} finally {
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [dbName]).catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`).catch(() => {});
  await admin.end().catch(() => {});
}

function assertCol(ok, label) {
  if (!ok) throw new Error(`migration verify failed: ${label}`);
}
