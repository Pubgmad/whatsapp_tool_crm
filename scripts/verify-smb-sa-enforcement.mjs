/**
 * Proves Super Admin platform_settings changes affect runtime getters (not cosmetic).
 * Restores original values after the check.
 */
import nextEnv from '@next/env';
import pg from 'pg';
import { getSheetsSyncPolicy, getDefaultFallbackReply, getOnboardingGoals } from '../lib/smb-platform-config.js';

nextEnv.loadEnvConfig(process.cwd());
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

async function setJson(key, value) {
  await client.query(
    `UPDATE platform_settings SET value=$2::jsonb, updated_at=NOW() WHERE key=$1`,
    [key, JSON.stringify(value)]
  );
}

async function readRaw(key) {
  return (await client.query(`SELECT value FROM platform_settings WHERE key=$1`, [key])).rows[0]?.value;
}

try {
  const originalPolicy = await readRaw('smb_sheets_sync_policy');
  const originalFallback = await readRaw('smb_default_fallback');
  const originalGoals = await readRaw('smb_onboarding_goals');

  await setJson('smb_sheets_sync_policy', {
    ...(originalPolicy && typeof originalPolicy === 'object' ? originalPolicy : {}),
    pollIntervalMinutes: 17,
    minIntervalMinutes: 2,
    maxIntervalMinutes: 60,
    retryLimit: 4
  });
  await setJson('smb_default_fallback', 'Audit fallback reply for SA enforcement.');
  await setJson('smb_onboarding_goals', [
    { id: 'audit_goal', label: 'Audit goal only', next: 'bots' }
  ]);

  const policy = await getSheetsSyncPolicy();
  const fallback = await getDefaultFallbackReply();
  const goals = await getOnboardingGoals();

  const ok = policy.pollIntervalMinutes === 17
    && policy.retryLimit === 4
    && fallback.includes('Audit fallback')
    && goals.length === 1
    && goals[0].id === 'audit_goal';

  console.log(JSON.stringify({
    ok,
    pollIntervalMinutes: policy.pollIntervalMinutes,
    retryLimit: policy.retryLimit,
    fallback,
    goals
  }, null, 2));

  // Restore
  if (originalPolicy != null) await setJson('smb_sheets_sync_policy', originalPolicy);
  if (originalFallback != null) await setJson('smb_default_fallback', originalFallback);
  if (originalGoals != null) await setJson('smb_onboarding_goals', originalGoals);

  if (!ok) process.exit(1);
} finally {
  await client.end();
}
