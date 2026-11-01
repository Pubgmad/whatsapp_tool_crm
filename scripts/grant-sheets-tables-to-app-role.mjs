/**
 * Prints the runtime DATABASE_URL role and whether it can write sheets_bot_*.
 * Run on the VPS with the same .env the app uses:
 *   node --env-file=.env scripts/grant-sheets-tables-to-app-role.mjs
 *
 * If can_insert is false, run the printed GRANT as a superuser/migration role.
 */
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const u = new URL(databaseUrl);
const appRole = decodeURIComponent(u.username || '');
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

const who = await client.query('SELECT current_user, current_database()');
const tables = ['sheets_bot_connections', 'sheets_bots', 'sheets_bot_rows'];
const priv = {};
for (const table of tables) {
  const row = (
    await client.query(
      `SELECT
         to_regclass($1) IS NOT NULL AS exists,
         CASE WHEN to_regclass($1) IS NULL THEN false
              ELSE has_table_privilege(current_user, $1, 'SELECT') END AS can_select,
         CASE WHEN to_regclass($1) IS NULL THEN false
              ELSE has_table_privilege(current_user, $1, 'INSERT') END AS can_insert,
         CASE WHEN to_regclass($1) IS NULL THEN false
              ELSE has_table_privilege(current_user, $1, 'UPDATE') END AS can_update,
         CASE WHEN to_regclass($1) IS NULL THEN false
              ELSE has_table_privilege(current_user, $1, 'DELETE') END AS can_delete`,
      [table]
    )
  ).rows[0];
  priv[table] = row;
}

console.log(JSON.stringify({ envRole: appRole, connectedAs: who.rows[0], privileges: priv }, null, 2));

const missing = tables.filter((table) => priv[table] && (!priv[table].can_insert || !priv[table].can_update));
if (missing.length) {
  console.log('\n-- Run as postgres/migration owner (NOT as the app role):');
  console.log(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ${missing.join(', ')} TO ${appRole};`
  );
  process.exitCode = 2;
} else {
  console.log('\nApp role can SELECT/INSERT/UPDATE Sheets tables.');
}

await client.end();
