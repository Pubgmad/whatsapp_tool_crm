#!/usr/bin/env node
/**
 * Pre-flight audit before starting whatsapp-crm-staging-worker.
 * Refuses non-staging DB. Prints no secrets.
 */
import nextEnv from '@next/env';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

nextEnv.loadEnvConfig(process.cwd());

function hostOf(url) {
  try { return new URL(url).host; } catch { return ''; }
}
function dbName(url) {
  try { return new URL(url).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; }
}

const report = { ok: true, checks: [] };
function check(name, ok, detail = '') {
  report.checks.push({ name, ok: Boolean(ok), detail: String(detail || '').slice(0, 240) });
  if (!ok) report.ok = false;
}

const databaseUrl = process.env.DATABASE_URL || '';
const appUrl = process.env.APP_URL || '';
const jobUrl = process.env.JOB_RUNNER_URL || appUrl;
const jobSecret = process.env.JOB_RUNNER_SECRET || '';
const db = dbName(databaseUrl);

check('database_url_present', Boolean(databaseUrl));
check('database_name_contains_staging', /staging/i.test(db), db || 'missing');
check('app_url_is_staging_host', /staging/i.test(hostOf(appUrl)), hostOf(appUrl) || 'missing');
check('job_runner_secret_configured', Boolean(jobSecret) && !jobSecret.startsWith('replace-with'));
check('meta_send_mock_armed', String(process.env.META_SEND_MODE || '').toLowerCase() === 'mock' && process.env.ALLOW_META_SEND_MOCK === '1', `META_SEND_MODE=${process.env.META_SEND_MODE || ''}`);
check('allow_local_job_runner', process.env.ALLOW_LOCAL_JOB_RUNNER === '1' || /^https:/.test(jobUrl), `JOB_RUNNER_URL host=${hostOf(jobUrl)}`);

let jobHostOk = false;
try {
  const u = new URL(jobUrl);
  jobHostOk = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || /staging/i.test(u.hostname);
} catch {}
check('job_runner_targets_staging_or_loopback', jobHostOk, hostOf(jobUrl));

const prodEnvPath = '/var/www/whatsapp-crm/.env.local';
if (fs.existsSync(prodEnvPath)) {
  const prod = Object.fromEntries(
    fs.readFileSync(prodEnvPath, 'utf8').split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
  check('job_secret_distinct_from_prod', Boolean(jobSecret) && jobSecret !== prod.JOB_RUNNER_SECRET);
  check('database_distinct_from_prod', Boolean(databaseUrl) && databaseUrl !== prod.DATABASE_URL);
  check('auth_secret_distinct_from_prod', Boolean(process.env.AUTH_SECRET) && process.env.AUTH_SECRET !== prod.AUTH_SECRET);
  check('webhook_verify_token_distinct_from_prod', Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN) && process.env.META_WEBHOOK_VERIFY_TOKEN !== prod.META_WEBHOOK_VERIFY_TOKEN);
}

if (!/staging/i.test(db)) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
await client.query("SELECT set_config('app.system_access','true',false)");
const accounts = (await client.query('SELECT COUNT(*)::int AS n FROM whatsapp_accounts')).rows[0].n;
const liveTokens = (await client.query(`SELECT COUNT(*)::int AS n FROM businesses WHERE COALESCE(access_token_encrypted,'') <> ''`)).rows[0].n;
check('no_live_whatsapp_accounts_or_mock_required', accounts === 0 || process.env.ALLOW_META_SEND_MOCK === '1', `accounts=${accounts}`);
check('no_business_live_tokens_or_mock_required', liveTokens === 0 || process.env.ALLOW_META_SEND_MOCK === '1', `businesses_with_token=${liveTokens}`);
await client.end();

const healthPath = path.join(process.cwd(), '.runtime', 'worker-health.json');
report.workerHealthFile = fs.existsSync(healthPath) ? 'present' : 'absent';
report.database = db;
report.appHost = hostOf(appUrl);
report.jobHost = hostOf(jobUrl);

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
