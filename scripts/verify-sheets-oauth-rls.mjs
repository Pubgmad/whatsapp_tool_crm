/**
 * VPS check: prove the runtime DB role can INSERT into sheets_bot_connections
 * the same way Connect Google does (BEGIN + set_config + INSERT + ROLLBACK).
 *
 * Usage (on the server, from app dir):
 *   node --env-file=.env scripts/verify-sheets-oauth-rls.mjs b_YOUR_BUSINESS_ID
 */
import pg from 'pg';

const businessId = String(process.argv[2] || '').trim();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (!businessId) {
  console.error('Usage: node --env-file=.env scripts/verify-sheets-oauth-rls.mjs <business_id>');
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
const id = `sbc_verify_${Date.now().toString(36)}`;
try {
  const who = await client.query('SELECT current_user, current_database()');
  console.log('connected_as', who.rows[0]);

  await client.query('BEGIN');
  await client.query(
    `SELECT set_config('app.business_id',$1,true), set_config('app.system_access','false',true)`,
    [businessId]
  );
  const guc = await client.query(
    `SELECT current_setting('app.business_id', true) AS business_id,
            current_setting('app.system_access', true) AS system_access`
  );
  console.log('guc', guc.rows[0]);

  await client.query(
    `INSERT INTO sheets_bot_connections (id, business_id, status, last_error)
     VALUES ($1,$2,'disconnected',$3)
     ON CONFLICT (business_id) DO UPDATE SET last_error=$3, updated_at=NOW()`,
    [id, businessId, 'oauth_pending:verify_script']
  );
  console.log('INSERT_OK');
  await client.query('ROLLBACK');
  console.log('ROLLBACK_OK (no lasting change)');
  process.exit(0);
} catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch {
    /* ignore */
  }
  console.error('INSERT_FAILED', {
    code: error.code,
    message: error.message,
    table: error.table,
    detail: error.detail
  });
  process.exit(2);
} finally {
  await client.end().catch(() => {});
}
