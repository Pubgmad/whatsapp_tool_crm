/**
 * Additive Free/Pro entitlement reconcile (safe to re-run).
 * Does not charge customers or touch Meta credentials.
 *
 * Usage:
 *   node scripts/reconcile-automation-plan-entitlements.mjs --dry-run
 *   node scripts/reconcile-automation-plan-entitlements.mjs
 */
import nextEnv from '@next/env';
import { enterSystemContext, query, transaction } from '../lib/db.js';
import {
  builtInSubscriptionPlans,
  mergeCatalogueEntitlements,
  reconcileSubscriptionPlanEntitlements
} from '../lib/default-plans.js';
import { planAllowsFeature } from '../lib/plan-features.js';

nextEnv.loadEnvConfig(process.cwd());
enterSystemContext();

const dryRun = process.argv.includes('--dry-run');
const catalogue = builtInSubscriptionPlans();

if (dryRun) {
  const plans = (
    await query(`SELECT code, features FROM subscription_plans WHERE code IN ('free','pro') ORDER BY 1`)
  ).rows;
  const report = plans.map((row) => {
    const plan = catalogue.find((item) => item.code === row.code);
    const current = Array.isArray(row.features) ? row.features : [];
    const { features, added } = mergeCatalogueEntitlements(current, plan?.features || []);
    return {
      code: row.code,
      wouldAdd: added,
      allowsSegmentsAfter: planAllowsFeature(features, 'segments'),
      allowsInboxAfter: planAllowsFeature(features, 'inbox'),
      allowsCampaignsAfter: planAllowsFeature(features, 'campaigns')
    };
  });
  console.log(JSON.stringify({ dryRun: true, report }, null, 2));
  process.exit(0);
}

const results = await transaction(async (client) => reconcileSubscriptionPlanEntitlements(client, ['free', 'pro']));
const after = (
  await query(`SELECT code, features FROM subscription_plans WHERE code IN ('free','pro') ORDER BY 1`)
).rows.map((row) => ({
  code: row.code,
  allowsSegments: planAllowsFeature(row.features, 'segments'),
  allowsInbox: planAllowsFeature(row.features, 'inbox'),
  allowsCampaigns: planAllowsFeature(row.features, 'campaigns')
}));
console.log(JSON.stringify({ dryRun: false, results, after }, null, 2));
