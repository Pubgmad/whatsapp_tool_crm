import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import process from 'node:process';
import test from 'node:test';
import { campaignSourceAnalytics } from '../lib/campaign-source-analytics.js';
import { enterSystemContext, query } from '../lib/db.js';
import { journeyUnifiedReport } from '../lib/journey-unified-report.js';

test('source analytics and journey filters remain tenant scoped', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix = crypto.randomBytes(6).toString('hex');
  const business = `src_b_${suffix}`, other = `src_o_${suffix}`;
  const template = `src_t_${suffix}`, otherTemplate = `src_ot_${suffix}`;
  const campaign = `src_k_${suffix}`, otherCampaign = `src_ok_${suffix}`;
  const contact = `src_c_${suffix}`, otherContact = `src_oc_${suffix}`;
  try {
    await query('INSERT INTO businesses(id,name,slug) VALUES($1,$1,$1),($2,$2,$2)', [business, other]);
    await query("INSERT INTO templates(id,business_id,name,body,status) VALUES($1,$2,'Source','Hello','Approved'),($3,$4,'Other','Hello','Approved')", [template, business, otherTemplate, other]);
    await query("INSERT INTO contacts(id,business_id,name,phone) VALUES($1,$2,'Source','15550001111'),($3,$4,'Other','15550002222')", [contact, business, otherContact, other]);
    await query("INSERT INTO campaigns(id,business_id,name,template_id,source_kind,source_id) VALUES($1,$2,'Retarget',$3,'retarget','origin_1'),($4,$5,'Foreign',$6,'retarget','origin_1')", [campaign, business, template, otherCampaign, other, otherTemplate]);
    await query("INSERT INTO campaign_recipients(id,campaign_id,contact_id,message,status) VALUES($1,$2,$3,'Hello','read'),($4,$5,$6,'Hello','read')", [`src_r_${suffix}`, campaign, contact, `src_or_${suffix}`, otherCampaign, otherContact]);

    const analytics = await campaignSourceAnalytics(business, { sourceKind: 'retarget', sourceId: 'origin_1' });
    assert.equal(analytics.length, 1);
    assert.deepEqual(analytics[0], {
      sourceKind: 'retarget', sourceId: 'origin_1', campaigns: 1, recipients: 1, delivered: 1, read: 1, failed: 0
    });
    const journey = await journeyUnifiedReport(business, { sourceKind: 'retarget', sourceId: 'origin_1' });
    assert.equal(journey.length, 1);
    assert.equal(journey[0].contactId, contact);
    assert.deepEqual(journey[0].campaignSources, { retarget: 1 });
  } finally {
    enterSystemContext();
    await query('DELETE FROM businesses WHERE id IN ($1,$2)', [business, other]);
  }
});
