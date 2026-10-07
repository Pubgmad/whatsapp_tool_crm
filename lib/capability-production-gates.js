import fs from 'node:fs';
import path from 'node:path';
import { PRODUCT_CAPABILITIES } from './product-capability-registry-data.js';

const root = process.cwd();

/** Extra test name fragments when evidence paths do not map 1:1 to test files. */
export const CAPABILITY_TEST_ALIASES = Object.freeze({
  multi_agent: ['support-policy', 'support-queue', 'inbox-sla', 'workspace-api'],
  campaign_retry: ['campaign-retry', 'campaign-failures', 'campaign-controls', 'production-hub'],
  click_tracking: ['click-tracking', 'audience-rules'],
  templates_rich: ['template-send', 'advanced-template', 'meta-otp'],
  marketing_messages_api: ['meta-send', 'campaign-queue', 'mm-lite'],
  automation_builder: ['automation-simulate', 'whatsapp-workflows'],
  native_flows: ['flow-template', 'whatsapp-flow-crypto', 'whatsapp-experiences'],
  flow_runtime: ['flow-runtime', 'external-availability', 'calendar-fulfillment'],
  flow_screen_funnel: ['flow-screen-analytics', 'flow-analytics'],
  hosted_transactional_pages: ['whatsapp-webviews', 'transactional-webview'],
  ai_support: ['ai-support', 'ai-knowledge'],
  ai_auto_reply: ['ai-auto-replies', 'ai-policy'],
  ai_actions: ['ai-actions', 'ai-booking'],
  ai_autonomous: ['ai-policy', 'ai-actions'],
  ai_intent_routing: ['ai-intent-routing'],
  dialogflow_bridge: ['dialogflow-bot'],
  commerce_catalog: ['whatsapp-commerce'],
  native_whatsapp_payments: ['whatsapp-commerce', 'merchant-payment'],
  merchant_checkout: ['razorpay', 'merchant-payment'],
  checkout_recovery: ['commerce-automation', 'provider-connectors'],
  ctwa_ads: ['whatsapp-ad', 'meta-activation'],
  ads_insights: ['whatsapp-ad', 'whatsapp-referral'],
  ad_advice: ['whatsapp-ad-advice'],
  conversions: ['whatsapp-conversions'],
  journey_analytics: ['whatsapp-referral', 'attribution-confidence'],
  coexistence: ['coexistence'],
  calling: ['whatsapp-expanded', 'booking-notices'],
  whatsapp_groups: ['new-whatsapp-modules', 'whatsapp-groups'],
  mm_lite_optimizer: ['mm-lite-optimizer', 'production-p2'],
  shopify: ['shopify-auth', 'shopify-drafts', 'shopify-settlement'],
  woocommerce: ['provider-connectors', 'woocommerce-connectors'],
  google_calendar: ['calendar-fulfillment', 'external-availability'],
  hubspot_crm: ['hubspot-contacts', 'crm-objects'],
  salesforce_crm: ['salesforce-contacts', 'crm-outbound'],
  workspace_webhooks: ['workspace-integrations', 'whatsapp-workflows'],
  integration_marketplace: ['integration-marketplace', 'production-p2'],
  ai_safety_abuse: ['ai-safety-events', 'ai-policy'],
  lead_website_ads: ['whatsapp-ad-objectives', 'meta-leadgen-ingest'],
  slo_certification: ['slo-certification'],
  a11y_certification: ['a11y-certification', 'a11y-public'],
  public_site_cms: ['public-site'],
  mobile_e2e: ['workspace-mobile'],
  production_certification: ['production-hub', 'production.integration', 'meta-health']
});

let cachedTestFiles = null;
let cachedE2eFiles = null;

function listTestFiles() {
  if (cachedTestFiles) return cachedTestFiles;
  const dir = path.join(root, 'tests');
  cachedTestFiles = fs.readdirSync(dir).filter((name) => name.endsWith('.test.mjs') || name.endsWith('.integration.test.mjs'));
  return cachedTestFiles;
}

function listE2eFiles() {
  if (cachedE2eFiles) return cachedE2eFiles;
  const dir = path.join(root, 'e2e');
  cachedE2eFiles = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.spec.js')) : [];
  return cachedE2eFiles;
}

function evidenceExists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function basenameTokens(relativePath) {
  const base = path.basename(relativePath).replace(/\.(js|ts|tsx)$/, '');
  return [base, base.replace(/-/g, '')];
}

function capabilityHasTests(capability) {
  const aliases = CAPABILITY_TEST_ALIASES[capability.id] || [];
  const tokens = new Set([
    capability.id,
    capability.id.replace(/_/g, '-'),
    ...aliases,
    ...capability.evidence.flatMap(basenameTokens)
  ]);
  const tests = listTestFiles();
  const e2e = listE2eFiles();
  const pool = [...tests, ...e2e];
  return pool.some((file) => {
    const normalized = file.toLowerCase();
    for (const token of tokens) {
      const t = String(token).toLowerCase();
      if (t.length >= 4 && normalized.includes(t)) return true;
    }
    return false;
  });
}

export function certifyCapabilityProduction(capability) {
  const failures = [];
  if (capability.codeStatus !== 'strong') {
    failures.push(`registry codeStatus must be strong (got ${capability.codeStatus})`);
  }
  for (const file of capability.evidence || []) {
    if (!evidenceExists(file)) failures.push(`missing evidence file ${file}`);
  }
  if (!capabilityHasTests(capability)) {
    failures.push(`no unit/integration/e2e test covers ${capability.id}`);
  }
  return { id: capability.id, pass: failures.length === 0, failures };
}

export function certifyAllProductCapabilities() {
  const results = PRODUCT_CAPABILITIES.map(certifyCapabilityProduction);
  const failures = results.filter((item) => !item.pass);
  return {
    pass: failures.length === 0,
    total: results.length,
    strong: PRODUCT_CAPABILITIES.filter((item) => item.codeStatus === 'strong').length,
    results,
    failures
  };
}
