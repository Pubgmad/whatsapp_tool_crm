import assert from 'node:assert/strict';
import test from 'node:test';
import { URLSearchParams } from 'node:url';
import {
  CAMPAIGN_SOURCE_KINDS,
  campaignSourceFilter,
  campaignSourceForWorkspaceCreate,
  normalizeCampaignSourceKind
} from '../lib/campaign-source.js';

test('campaign source taxonomy is closed and safely normalizes unknown values', () => {
  assert.deepEqual(CAMPAIGN_SOURCE_KINDS, [
    'workspace_broadcast', 'public_api', 'drip', 'recurring_child', 'retarget', 'legacy', 'unknown'
  ]);
  assert.equal(normalizeCampaignSourceKind('DRIP'), 'drip');
  assert.equal(normalizeCampaignSourceKind('invented'), 'unknown');
});

test('workspace campaigns distinguish broadcasts from retargets', () => {
  assert.deepEqual(
    campaignSourceForWorkspaceCreate({ campaignId: 'camp_1' }),
    { sourceKind: 'workspace_broadcast', sourceId: 'camp_1' }
  );
  assert.deepEqual(
    campaignSourceForWorkspaceCreate({ campaignId: 'camp_2', retargetSourceCampaignId: 'camp_1' }),
    { sourceKind: 'retarget', sourceId: 'camp_1' }
  );
});

test('campaign source filters reject unsupported kinds', () => {
  assert.deepEqual(
    campaignSourceFilter(new URLSearchParams('sourceKind=public_api&sourceId=req_1')),
    { sourceKind: 'public_api', sourceId: 'req_1' }
  );
  assert.deepEqual(
    campaignSourceFilter(new URLSearchParams('sourceKind=private_override')),
    { sourceKind: '', sourceId: '' }
  );
});
