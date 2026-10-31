import nextEnv from '@next/env';
import pg from 'pg';
import {
  getSheetsSyncPolicy,
  getMarketplaceProviders,
  getZohoSyncPolicy,
  getDefaultFallbackReply
} from '../lib/smb-platform-config.js';

nextEnv.loadEnvConfig(process.cwd());
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const col = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='sheets_bots' AND column_name='sync_fail_count'`
  );
  const nav = await client.query(`SELECT value FROM platform_settings WHERE key='smb_simple_nav'`);
  const keys = await client.query(
    `SELECT key FROM platform_settings
     WHERE key LIKE 'smb_%' ORDER BY key`
  );
  const [sheets, providers, zoho, fallback] = await Promise.all([
    getSheetsSyncPolicy(),
    getMarketplaceProviders(),
    getZohoSyncPolicy(),
    getDefaultFallbackReply()
  ]);
  console.log(JSON.stringify({
    syncFailColumn: Boolean(col.rows[0]),
    simpleNav: nav.rows[0]?.value,
    smbKeys: keys.rows.map((row) => row.key),
    sheetsPoll: sheets.pollIntervalMinutes,
    retryLimit: sheets.retryLimit,
    providers: providers.map((item) => item.id),
    zohoInterval: zoho.intervalMinutes,
    fallbackPreview: String(fallback).slice(0, 48)
  }, null, 2));
} finally {
  await client.end();
}
