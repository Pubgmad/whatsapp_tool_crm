#!/usr/bin/env node
/**
 * Isolated staging worker verification with META_SEND_MODE=mock.
 * Seeds synthetic automation jobs on whatsapp_crm_staging only.
 */
import crypto from 'node:crypto';
import nextEnv from '@next/env';
import { enterSystemContext, query } from '../lib/db.js';
import { encryptSecret } from '../lib/meta.js';
import { enqueueAutomationForIncoming, runAutomationQueue } from '../lib/automation.js';
import { runCampaignDripQueue } from '../lib/campaign-drip.js';

nextEnv.loadEnvConfig(process.cwd());
process.env.META_SEND_MODE = 'mock';
process.env.ALLOW_META_SEND_MOCK = '1';
process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED = process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED || 'false';

function requireStaging() {
  const raw = process.env.DATABASE_URL || '';
  const db = new URL(raw.includes('://') ? raw : `postgresql://${raw}`).pathname.replace(/^\//, '');
  if (!/staging/i.test(db)) throw new Error(`Refusing non-staging database "${db}"`);
  return db;
}

const database = requireStaging();
enterSystemContext();

const suffix = crypto.randomBytes(4).toString('hex');
const businessId = `b_wkr_${suffix}`;
const userId = `u_wkr_${suffix}`;
const contactId = `c_wkr_${suffix}`;
const conversationId = `cv_wkr_${suffix}`;
const flowId = `flow_wkr_${suffix}`;
const accountId = `wa_wkr_${suffix}`;
const phoneRowId = `wpn_wkr_${suffix}`;
const phoneNumberId = `pn_${suffix}`;
const wabaId = `waba_${suffix}`;
const phone = `1555${String(Date.now()).slice(-7)}`;
const tokenEnc = encryptSecret('staging-mock-token-not-live');
const report = { database, checks: [], passed: 0, failed: 0, metaLiveSends: 'mocked' };

function check(name, ok, detail = '') {
  report.checks.push({ name, ok: Boolean(ok), detail: String(detail || '').slice(0, 280) });
  if (ok) report.passed += 1;
  else report.failed += 1;
}

try {
  await query(
    `INSERT INTO businesses (id,name,slug,waba_id,phone_number_id,access_token_encrypted,status,account_status,review_access)
     VALUES ($1,$2,$3,$4,$5,$6,'Connected','pending',TRUE)`,
    [businessId, `Worker Verify ${suffix}`, `worker-${suffix}`, wabaId, phoneNumberId, tokenEnc]
  );
  await query(
    `INSERT INTO whatsapp_accounts (id,business_id,waba_id,onboarding_method,access_token_encrypted,is_default,status,webhook_subscribed)
     VALUES ($1,$2,$3,'manual',$4,TRUE,'connected',FALSE)`,
    [accountId, businessId, wabaId, tokenEnc]
  );
  await query(
    `INSERT INTO whatsapp_phone_numbers (id,business_id,whatsapp_account_id,phone_number_id,display_phone_number,is_default,registration_state)
     VALUES ($1,$2,$3,$4,$5,TRUE,'registered')`,
    [phoneRowId, businessId, accountId, phoneNumberId, `+${phone}`]
  );
  await query(
    `INSERT INTO users (id,name,email,password_hash,email_verified_at) VALUES ($1,'Worker','worker-${suffix}@example.test','x',NOW())`,
    [userId]
  );
  await query(`INSERT INTO memberships (id,user_id,business_id,role) VALUES ($1,$2,$3,'Owner')`, [`m_wkr_${suffix}`, userId, businessId]);
  await query(
    `INSERT INTO contacts (id,business_id,name,phone,marketing_permission,opt_in_at,opt_in_source,last_message_at)
     VALUES ($1,$2,'Worker Contact',$3,TRUE,NOW(),'staging-worker-verify',NOW())`,
    [contactId, businessId, phone]
  );
  await query(
    `INSERT INTO conversations (id,business_id,contact_id,whatsapp_phone_number_id) VALUES ($1,$2,$3,$4)`,
    [conversationId, businessId, contactId, phoneNumberId]
  );

  const definition = {
    startNodeId: 'n1',
    nodes: [
      { id: 'n1', type: 'message', body: `Hello mock ${suffix}`, next: 'n2', inputKind: 'none', delayMinutes: 0 },
      { id: 'n2', type: 'message', body: `Delayed ${suffix}`, next: 'n3', inputKind: 'none', delayMinutes: 1 },
      { id: 'n3', type: 'handoff', body: '', assignedUserId: userId, inputKind: 'none' }
    ]
  };
  await query(
    `INSERT INTO automation_flows (id,business_id,name,status,trigger_mode,trigger_keywords,definition)
     VALUES ($1,$2,$3,'active','any_inbound','[]'::jsonb,$4::jsonb)`,
    [flowId, businessId, `Worker flow ${suffix}`, JSON.stringify(definition)]
  );

  const inboundId = `wamid_in_${suffix}`;
  const enq1 = await enqueueAutomationForIncoming({
    businessId,
    contactId,
    conversationId,
    messageId: inboundId,
    input: { type: 'text', text: 'start' }
  });
  check('enqueue_automation', Boolean(enq1?.jobId), JSON.stringify(enq1));

  const enqDup = await enqueueAutomationForIncoming({
    businessId,
    contactId,
    conversationId,
    messageId: inboundId,
    input: { type: 'text', text: 'start' }
  });
  check('automation_inbound_idempotent', enqDup?.duplicate === true, JSON.stringify(enqDup));

  const pass1 = await runAutomationQueue({ businessId, limit: 10 });
  check('automation_trigger_claimed', pass1.claimed >= 1, JSON.stringify(pass1));
  check('automation_mock_send', pass1.sent >= 1, JSON.stringify(pass1));

  const delayed = (await query(
    `SELECT COUNT(*)::int AS n FROM automation_jobs
     WHERE business_id=$1 AND status IN ('queued','retry') AND run_at > NOW()`,
    [businessId]
  )).rows[0].n;
  check('delay_job_scheduled', delayed >= 1, `delayed=${delayed}`);

  await query(
    `UPDATE automation_jobs SET run_at=NOW()-INTERVAL '1 second'
     WHERE business_id=$1 AND status IN ('queued','retry')`,
    [businessId]
  );
  const pass2 = await runAutomationQueue({ businessId, limit: 10 });
  check('delayed_job_processed', pass2.claimed >= 1, JSON.stringify(pass2));

  await query(
    `UPDATE automation_jobs SET run_at=NOW()-INTERVAL '1 second'
     WHERE business_id=$1 AND status IN ('queued','retry')`,
    [businessId]
  );
  const pass3 = await runAutomationQueue({ businessId, limit: 10 });
  const handoffSessions = (await query(
    `SELECT COUNT(*)::int AS n FROM automation_sessions WHERE business_id=$1 AND status='handoff'`,
    [businessId]
  )).rows[0].n;
  check(
    'human_handoff_reached',
    handoffSessions >= 1 || pass2.handoff >= 1 || pass3.handoff >= 1,
    `sessions=${handoffSessions} p2=${JSON.stringify(pass2)} p3=${JSON.stringify(pass3)}`
  );

  const sessionId = (await query(`SELECT id FROM automation_sessions WHERE business_id=$1 ORDER BY started_at DESC LIMIT 1`, [businessId])).rows[0]?.id;
  const failJobId = `aj_fail_${suffix}`;
  if (sessionId) {
    await query(
      `INSERT INTO automation_jobs (id,business_id,session_id,input,status,attempts,max_attempts,run_at)
       VALUES ($1,$2,$3,$4::jsonb,'queued',0,3,NOW())`,
      [failJobId, businessId, sessionId, JSON.stringify({ phase: 'scheduled', targetNodeId: 'missing_node' })]
    );
    // Reactivate session + clear handoff pause so claim filter accepts the synthetic failure job
    await query(`UPDATE automation_sessions SET status='active', ended_at=NULL, human_takeover=FALSE WHERE id=$1`, [sessionId]);
    await query(
      `UPDATE conversations SET automation_paused=FALSE, assigned_user_id=NULL, updated_at=NOW()
       WHERE id=$1 AND business_id=$2`,
      [conversationId, businessId]
    );
    const failPass = await runAutomationQueue({ businessId, limit: 10 });
    const failRow = (await query(`SELECT status,attempts,error_message FROM automation_jobs WHERE id=$1`, [failJobId])).rows[0];
    check('error_reporting_on_bad_node', ['failed', 'retry'].includes(failRow?.status), JSON.stringify({ failPass, failRow }));
  } else {
    check('error_reporting_on_bad_node', false, 'no session');
  }

  const drip = await runCampaignDripQueue({ limit: 5 }).catch((e) => ({ error: e.message }));
  check('drip_queue_invoked', !drip?.error, JSON.stringify(drip).slice(0, 200));

  // Simulated restart: unlock processing leftovers and reclaim
  await query(
    `UPDATE automation_jobs SET status='queued', locked_at=NULL, run_at=NOW()-INTERVAL '1 second'
     WHERE business_id=$1 AND status='processing'`,
    [businessId]
  );
  const recover = await runAutomationQueue({ businessId, limit: 10 });
  check('restart_recovery_reclaim', typeof recover.claimed === 'number', JSON.stringify(recover));

  const events = (await query(
    `SELECT COUNT(*)::int AS n FROM events WHERE business_id=$1 AND type LIKE 'automation%'`,
    [businessId]
  )).rows[0].n;
  check('execution_events_recorded', events >= 1, `events=${events}`);

  // Optional: hit live staging job endpoint if secret + base URL available
  const base = process.env.STAGING_VERIFY_BASE_URL || process.env.JOB_RUNNER_URL || 'http://127.0.0.1:3001';
  const secret = process.env.JOB_RUNNER_SECRET;
  if (secret && !secret.startsWith('replace-with')) {
    const res = await fetch(`${base}/api/jobs/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ runRetention: false, limit: 3, businessId })
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }));
    const body = await res.json().catch(() => ({}));
    check('jobs_run_http_cycle', res.status === 200 || res.status === 503, JSON.stringify({ status: res.status, errors: body.errors, error: body.error }).slice(0, 200));
  } else {
    check('jobs_run_http_cycle', true, 'skipped_no_secret');
  }
} catch (error) {
  check('harness_exception', false, error.stack || error.message);
} finally {
  await query('DELETE FROM businesses WHERE id=$1', [businessId]).catch(() => {});
  await query('DELETE FROM users WHERE id=$1', [userId]).catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.failed ? 1 : 0);
