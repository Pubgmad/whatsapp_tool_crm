/* global process, Request */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createSessionToken } from '../lib/auth.js';
import {
  campaignDripRequest,
  normalizeCampaignDripDefinition,
  runCampaignDripQueue,
  validateCampaignDripTimezone
} from '../lib/campaign-drip.js';
import { enterSystemContext, query } from '../lib/db.js';
import { createCsrfToken } from '../lib/security.js';

test('drip definitions enforce names, IANA timezones, ordered delays and variable objects', () => {
  assert.equal(validateCampaignDripTimezone('Asia/Kolkata'), 'Asia/Kolkata');
  assert.throws(() => validateCampaignDripTimezone('Mars/Olympus'), { code: 'DRIP_TIMEZONE_INVALID' });
  assert.throws(() => normalizeCampaignDripDefinition({ name: '', timezone: 'UTC', steps: [] }), { code: 'DRIP_NAME_INVALID' });
  assert.throws(() => normalizeCampaignDripDefinition({
    name: 'Welcome', timezone: 'UTC', steps: [{ templateId: 't1', offsetMinutes: 1.5, variables: {} }]
  }), { code: 'DRIP_STEP_INVALID' });
  const definition = normalizeCampaignDripDefinition({
    name: ' Welcome ',
    timezone: 'UTC',
    segmentId: ' segment_1 ',
    steps: [
      { templateId: 'template_1', offsetMinutes: 0, variables: { name: 'Customer' } },
      { templateId: 'template_2', offsetMinutes: 60, variables: {} }
    ]
  });
  assert.equal(definition.name, 'Welcome');
  assert.equal(definition.segmentId, 'segment_1');
  assert.deepEqual(definition.steps.map((step) => step.stepOrder), [0, 1]);
});

test('drip API validates tenancy and consent, audits lifecycle, and queues every due step', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix = crypto.randomBytes(7).toString('hex');
  const business = `drip_b_${suffix}`;
  const other = `drip_o_${suffix}`;
  const user = `drip_u_${suffix}`;
  const templateOne = `drip_t1_${suffix}`;
  const templateTwo = `drip_t2_${suffix}`;
  const foreignTemplate = `drip_tx_${suffix}`;
  const allowedContact = `drip_c1_${suffix}`;
  const blockedContact = `drip_c2_${suffix}`;
  const oldAuth = process.env.AUTH_SECRET;
  const oldCsrf = process.env.CSRF_SECRET;
  process.env.AUTH_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.CSRF_SECRET = crypto.randomBytes(32).toString('hex');
  const csrf = createCsrfToken();
  const token = createSessionToken({ userId: user, businessId: business, role: 'Manager', sessionVersion: 0 });
  const request = (body) => new Request('https://example.test/api/workspace/campaign-drip', {
    method: 'POST',
    headers: {
      cookie: `wcrm_session=${encodeURIComponent(token)}; wcrm_csrf=${encodeURIComponent(csrf)}`,
      origin: 'https://example.test',
      'x-csrf-token': csrf,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const post = async (body, expected = 200) => {
    const response = await campaignDripRequest(request(body));
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  };
  try {
    await query('INSERT INTO businesses (id,name,slug,review_access) VALUES ($1,$1,$1,TRUE),($2,$2,$2,TRUE)', [business, other]);
    await query("INSERT INTO users (id,name,email,password_hash,email_verified_at) VALUES ($1,$1,$2,'unused',NOW())", [user, `${user}@example.test`]);
    await query("INSERT INTO memberships (id,user_id,business_id,role) VALUES ($1,$2,$3,'Manager')", [`drip_m_${suffix}`, user, business]);
    await query(
      `INSERT INTO templates (id,business_id,name,body,status) VALUES
       ($1,$2,'Welcome','Hello {{name}}','Approved'),($3,$2,'Follow up','Still interested?','Approved'),($4,$5,'Foreign','No','Approved')`,
      [templateOne, business, templateTwo, foreignTemplate, other]
    );
    await query(
      `INSERT INTO contacts (id,business_id,name,phone,marketing_permission,unsubscribed) VALUES
       ($1,$2,'Allowed',$3,TRUE,FALSE),($4,$2,'Blocked',$5,FALSE,FALSE)`,
      [allowedContact, business, `1555${suffix.slice(0, 7)}1`, blockedContact, `1555${suffix.slice(0, 7)}2`]
    );

    const rejected = await post({
      action: 'create', name: 'Foreign sequence', timezone: 'UTC',
      steps: [{ templateId: foreignTemplate, offsetMinutes: 0, variables: {} }]
    }, 400);
    assert.equal(rejected.code, 'DRIP_TEMPLATE_INVALID');

    const created = await post({
      action: 'create',
      name: 'Customer onboarding',
      timezone: 'Asia/Kolkata',
      steps: [
        { templateId: templateOne, offsetMinutes: 0, variables: { name: 'Customer' } },
        { templateId: templateTwo, offsetMinutes: 5, variables: {} }
      ]
    }, 201);
    await post({ action: 'activate', id: created.id });
    const enrolled = await post({ action: 'enroll', sequenceId: created.id, contactIds: [allowedContact, blockedContact] });
    assert.deepEqual({ requested: enrolled.requested, eligible: enrolled.eligible, enrolled: enrolled.enrolled, skipped: enrolled.skipped }, {
      requested: 2, eligible: 1, enrolled: 1, skipped: 1
    });

    enterSystemContext();
    const firstRun = await runCampaignDripQueue({ limit: 100 });
    assert.equal(firstRun.spawned >= 1, true);
    const firstCampaign = (await query(
      `SELECT c.id FROM campaigns c
       JOIN campaign_recipients r ON r.campaign_id=c.id
       WHERE c.business_id=$1 AND r.contact_id=$2 ORDER BY c.created_at DESC LIMIT 1`,
      [business, allowedContact]
    )).rows[0];
    assert.ok(firstCampaign?.id);
    assert.equal((await query(
      'SELECT COUNT(*)::int AS count FROM campaign_jobs j JOIN campaign_recipients r ON r.id=j.campaign_recipient_id WHERE r.campaign_id=$1',
      [firstCampaign.id]
    )).rows[0].count, 1);

    await post({ action: 'pause', id: created.id });
    enterSystemContext();
    await query('UPDATE campaign_drip_enrollments SET next_run_at=NOW() WHERE sequence_id=$1', [created.id]);
    assert.equal((await runCampaignDripQueue({ limit: 100 })).spawned, 0);
    await post({ action: 'resume', id: created.id });
    enterSystemContext();
    assert.equal((await runCampaignDripQueue({ limit: 100 })).spawned >= 1, true);
    assert.equal((await query('SELECT status FROM campaign_drip_enrollments WHERE sequence_id=$1', [created.id])).rows[0].status, 'completed');

    await post({ action: 'enroll', sequenceId: created.id, contactIds: [allowedContact] });
    const cancelled = await post({ action: 'cancel', sequenceId: created.id, all: true });
    assert.equal(cancelled.cancelled, 1);
    await post({ action: 'archive', id: created.id });
    enterSystemContext();
    assert.equal((await query('SELECT status FROM campaign_drip_sequences WHERE id=$1 AND business_id=$2', [created.id, business])).rows[0].status, 'archived');
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM audit_logs WHERE business_id=$1 AND action LIKE 'campaign_drip_%'", [business])).rows[0].count >= 7, true);
  } finally {
    enterSystemContext();
    await query('DELETE FROM businesses WHERE id IN ($1,$2)', [business, other]);
    await query('DELETE FROM users WHERE id=$1', [user]);
    if (oldAuth === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = oldAuth;
    if (oldCsrf === undefined) delete process.env.CSRF_SECRET; else process.env.CSRF_SECRET = oldCsrf;
  }
});
