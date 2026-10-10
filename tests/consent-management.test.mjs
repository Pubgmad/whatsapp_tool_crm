import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchConsentKeyword,
  normalizeKeywordList,
  getBusinessConsentSettings,
  processInboundConsentKeywords,
  cancelOutboundForContact
} from '../lib/consent-management.js';
import { evaluateMarketingEligibility } from '../lib/messaging-eligibility.js';
import { isLikelyBotUserAgent } from '../lib/click-tracking.js';

test('consent keywords normalize, cap at five, and match case-insensitively', () => {
  const keywords = normalizeKeywordList([' stop ', 'STOP', 'unsubscribe', 'opt out', 'quit', 'enough', 'extra'], ['STOP']);
  assert.deepEqual(keywords, ['STOP', 'UNSUBSCRIBE', 'OPT OUT', 'QUIT', 'ENOUGH']);
  assert.equal(matchConsentKeyword('  Stop  ', keywords), 'STOP');
  assert.equal(matchConsentKeyword('please stop', keywords), null);
  assert.equal(matchConsentKeyword('OPT OUT', keywords), 'OPT OUT');
});

test('bot user-agent detector marks scrapers but not normal browsers', () => {
  assert.equal(isLikelyBotUserAgent(''), true);
  assert.equal(isLikelyBotUserAgent('curl/8.0'), true);
  assert.equal(isLikelyBotUserAgent('facebookexternalhit/1.1'), true);
  assert.equal(isLikelyBotUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'), false);
});

test('marketing eligibility fails closed for suppressions and workspace toggle', async () => {
  const rows = {
    settings: { marketing_messaging_enabled: false, opt_out_keywords: ['STOP'], opt_in_keywords: ['START'], opt_out_auto_reply: '', opt_in_auto_reply: '' },
    contact: {
      id: 'c1', phone: '15551234567', name: 'Ada', marketing_permission: true, unsubscribed: false,
      opt_in_at: new Date(), opt_in_source: 'web', suppressed: false
    }
  };
  const run = async (sql) => {
    if (sql.includes('business_consent_settings')) return { rows: [rows.settings] };
    if (sql.includes('FROM contacts')) return { rows: [rows.contact] };
    return { rows: [] };
  };
  const disabled = await evaluateMarketingEligibility({ businessId: 'b1', contactId: 'c1' }, run);
  assert.equal(disabled.eligible, false);
  assert.match(disabled.reasons[0], /marketing messaging is disabled/i);

  rows.settings.marketing_messaging_enabled = true;
  rows.contact.suppressed = true;
  const suppressed = await evaluateMarketingEligibility({ businessId: 'b1', contactId: 'c1' }, run);
  assert.equal(suppressed.eligible, false);
  assert.match(suppressed.reasons.join(' '), /suppression/i);
});

test('inbound STOP writes suppression, consent history, and cancels outbound work', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const crypto = await import('node:crypto');
  const { enterSystemContext, query, transaction } = await import('../lib/db.js');
  enterSystemContext();
  const suffix = crypto.randomBytes(6).toString('hex');
  const businessId = `crm_b_${suffix}`;
  const contactId = `crm_c_${suffix}`;
  const campaignId = `crm_camp_${suffix}`;
  const recipientId = `crm_cr_${suffix}`;
  const jobId = `crm_j_${suffix}`;
  const templateId = `crm_t_${suffix}`;
  try {
    await query('INSERT INTO businesses (id,name,slug,review_access) VALUES ($1,$1,$1,TRUE)', [businessId]);
    await query(
      `INSERT INTO contacts (id,business_id,name,phone,marketing_permission,unsubscribed,opt_in_at,opt_in_source)
       VALUES ($1,$2,'Ada','91${suffix.slice(0, 10)}',TRUE,FALSE,NOW(),'test')`,
      [contactId, businessId]
    );
    await query(
      `INSERT INTO templates (id,business_id,name,body,status,category) VALUES ($1,$2,'Hello','Hi','Approved','MARKETING')`,
      [templateId, businessId]
    );
    await query(
      `INSERT INTO campaigns (id,business_id,name,template_id,mode,status) VALUES ($1,$2,'Blast',$3,'Live Meta','queued')`,
      [campaignId, businessId, templateId]
    );
    await query(
      `INSERT INTO campaign_recipients (id,campaign_id,contact_id,message,status) VALUES ($1,$2,$3,'Hi','queued')`,
      [recipientId, campaignId, contactId]
    );
    await query(
      `INSERT INTO campaign_jobs (id,campaign_recipient_id,status,run_at) VALUES ($1,$2,'queued',NOW())`,
      [jobId, recipientId]
    );

    await transaction(async (client) => {
      const result = await processInboundConsentKeywords(client, {
        businessId,
        contactId,
        text: 'STOP'
      });
      assert.equal(result.action, 'opt_out');
      assert.ok(result.cancelled.campaignJobs >= 1);
    });

    const contact = (await query('SELECT marketing_permission,unsubscribed FROM contacts WHERE id=$1', [contactId])).rows[0];
    assert.equal(contact.marketing_permission, false);
    assert.equal(contact.unsubscribed, true);
    const suppression = (await query(
      `SELECT active,reason FROM contact_suppressions WHERE business_id=$1 AND contact_id=$2`,
      [businessId, contactId]
    )).rows[0];
    assert.equal(suppression.active, true);
    assert.equal(suppression.reason, 'opt_out');
    const job = (await query('SELECT status FROM campaign_jobs WHERE id=$1', [jobId])).rows[0];
    assert.equal(job.status, 'failed');
    const settings = await getBusinessConsentSettings(businessId);
    assert.equal(settings.marketingMessagingEnabled, true);
    assert.ok(settings.optOutKeywords.includes('STOP'));
  } finally {
    await query('DELETE FROM businesses WHERE id=$1', [businessId]);
  }
});

test('cancelOutboundForContact is idempotent for already-clear queues', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const crypto = await import('node:crypto');
  const { enterSystemContext, query, transaction } = await import('../lib/db.js');
  enterSystemContext();
  const suffix = crypto.randomBytes(5).toString('hex');
  const businessId = `crm_b2_${suffix}`;
  const contactId = `crm_c2_${suffix}`;
  try {
    await query('INSERT INTO businesses (id,name,slug,review_access) VALUES ($1,$1,$1,TRUE)', [businessId]);
    await query(
      `INSERT INTO contacts (id,business_id,name,phone,marketing_permission,unsubscribed)
       VALUES ($1,$2,'Bo','92${suffix}',TRUE,FALSE)`,
      [contactId, businessId]
    );
    const summary = await transaction(async (client) => cancelOutboundForContact(client, businessId, contactId));
    assert.equal(summary.campaignJobs, 0);
    assert.equal(summary.dripEnrollments, 0);
  } finally {
    await query('DELETE FROM businesses WHERE id=$1', [businessId]);
  }
});
