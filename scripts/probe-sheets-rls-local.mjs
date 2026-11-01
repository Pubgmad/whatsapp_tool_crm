import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

const u = new URL(databaseUrl);
const businessId = String(process.argv[2] || 'b_84f3a30c96faac61').trim();
console.log(
  JSON.stringify(
    {
      host: u.hostname,
      port: u.port || '5432',
      db: u.pathname,
      user: u.username,
      looksLocal: ['localhost', '127.0.0.1'].includes(u.hostname)
    },
    null,
    2
  )
);

const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const who = await client.query(
    'SELECT current_user, current_database(), inet_server_addr()::text AS server, current_setting(\'app.business_id\', true) AS guc_before'
  );
  const priv = await client.query(`
    SELECT
      has_table_privilege(current_user, 'sheets_bot_connections', 'INSERT') AS can_insert,
      has_table_privilege(current_user, 'sheets_bot_connections', 'SELECT') AS can_select,
      has_table_privilege(current_user, 'sheets_bot_connections', 'UPDATE') AS can_update
  `);
  const force = await client.query(`
    SELECT relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname = 'sheets_bot_connections'
  `);
  const pol = await client.query(`
    SELECT pol.polname, pol.polcmd::text, pol.polpermissive,
           pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    WHERE c.relname = 'sheets_bot_connections'
  `);
  const biz = await client.query('SELECT id, name FROM businesses WHERE id = $1', [businessId]);

  console.log(JSON.stringify({ who: who.rows[0], priv: priv.rows[0], force: force.rows[0], policies: pol.rows, business: biz.rows[0] || null }, null, 2));

  // Mimic broken app path: no transaction, set_config is_local=true then INSERT
  await client.query(`SELECT set_config('app.business_id',$1,true), set_config('app.system_access','false',true)`, [businessId]);
  try {
    await client.query(
      `INSERT INTO sheets_bot_connections (id, business_id, status, last_error)
       VALUES ($1,$2,'disconnected',$3)
       ON CONFLICT (business_id) DO UPDATE SET last_error=$3, updated_at=NOW()`,
      [`sbc_probe_nontx_${Date.now()}`, businessId, 'oauth_pending:probe_nontx']
    );
    console.log('NON_TX_INSERT_OK (unexpected if is_local resets)');
  } catch (error) {
    console.log(JSON.stringify({ NON_TX_INSERT_FAILED: { code: error.code, message: error.message, table: error.table } }, null, 2));
  }

  // Mimic withTenant / fixed path
  await client.query('BEGIN');
  await client.query(`SELECT set_config('app.business_id',$1,true), set_config('app.system_access','false',true)`, [businessId]);
  const guc = await client.query(
    `SELECT current_setting('app.business_id', true) AS business_id, current_setting('app.system_access', true) AS system_access`
  );
  console.log(JSON.stringify({ tx_guc: guc.rows[0] }, null, 2));
  try {
    await client.query(
      `INSERT INTO sheets_bot_connections (id, business_id, status, last_error)
       VALUES ($1,$2,'disconnected',$3)
       ON CONFLICT (business_id) DO UPDATE SET last_error=$3, updated_at=NOW()`,
      [`sbc_probe_tx_${Date.now()}`, businessId, 'oauth_pending:probe_tx']
    );
    console.log('TX_INSERT_OK');
  } catch (error) {
    console.log(JSON.stringify({ TX_INSERT_FAILED: { code: error.code, message: error.message, table: error.table, detail: error.detail } }, null, 2));
  }
  await client.query('ROLLBACK');
  console.log('ROLLBACK_OK');
} catch (error) {
  console.log(JSON.stringify({ fatal: { code: error.code, message: error.message } }, null, 2));
  process.exitCode = 2;
} finally {
  await client.end().catch(() => {});
}
