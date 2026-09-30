import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignFrequencyHours,campaignReportStatus,assertCampaignReviewAction} from '../lib/campaign-controls.js';

test('campaign frequency accepts explicit whole hours without silently clamping invalid values',()=>{
  assert.equal(campaignFrequencyHours(undefined),0);
  assert.equal(campaignFrequencyHours('48'),48);
  for (const value of [-1,1.5,'bad',8761,Infinity,true,[],{}]) assert.throws(()=>campaignFrequencyHours(value),{code:'CAMPAIGN_FREQUENCY_INVALID'});
});

test('campaign reporting preserves approval gates instead of presenting draft recipients as active sends',()=>{
  const stats={total:5,queued:5,failed:0};
  for(const status of ['draft','pending_approval','paused','cancelled'])assert.equal(campaignReportStatus({status},stats),status);
  assert.equal(campaignReportStatus({status:'queued'},stats),'processing');
  assert.equal(campaignReportStatus({status:'queued',scheduledAt:'2030-01-01T00:00:00Z'},stats,0),'scheduled');
  assert.equal(campaignReportStatus({status:'processing'},{total:2,queued:0,failed:2}),'failed');
});

test('campaign review is owner-only and cannot approve a draft or already approved campaign',()=>{
  const pending={status:'pending_approval',approval_status:'pending'};
  assert.doesNotThrow(()=>assertCampaignReviewAction(pending,'approve','Owner'));
  assert.throws(()=>assertCampaignReviewAction(pending,'approve','Manager'),{code:'CAMPAIGN_REVIEW_FORBIDDEN'});
  assert.throws(()=>assertCampaignReviewAction({status:'queued',approval_status:'approved'},'approve','Owner'),{code:'CAMPAIGN_NOT_PENDING'});
  assert.doesNotThrow(()=>assertCampaignReviewAction({status:'draft',approval_status:'rejected'},'submit','Manager'));
  assert.throws(()=>assertCampaignReviewAction(pending,'submit','Manager'),{code:'CAMPAIGN_NOT_DRAFT'});
  assert.throws(()=>assertCampaignReviewAction(pending,'activate','Owner'),{code:'VALIDATION_ERROR'});
});
