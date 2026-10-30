import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import nextEnv from '@next/env';
import pg from 'pg';

nextEnv.loadEnvConfig(process.cwd());
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  for (const file of ['smb-competitive-wave.sql', 'smb-entitlements-merge.sql', 'smb-sa-config-wave.sql']) {
    const sql = fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8');
    await client.query(sql);
    console.log('applied', file);
  }
  const result = await client.query("SELECT key FROM platform_settings WHERE key LIKE 'smb_%' OR key LIKE 'feature_sheets%' OR key LIKE 'feature_reply%' OR key LIKE 'feature_assisted%' OR key LIKE 'feature_simple%' OR key LIKE 'feature_ecommerce%' ORDER BY key");
  console.log(result.rows.map((row) => row.key).join('\n'));
} finally {
  await client.end();
}
