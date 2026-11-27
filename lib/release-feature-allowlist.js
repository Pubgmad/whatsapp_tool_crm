/**
 * WhatsApp Automation release scope.
 * Central hard allowlist for navigation, routes, APIs, plan entitlements,
 * Features CMS, Super Admin feature catalogues, and integration marketplace.
 *
 * Excluded full-CRM modules remain in the codebase/DB for shared dependencies
 * and historical data, but must not be customer-accessible or re-enabled via SA.
 */

export const RELEASE_PRODUCT = 'whatsapp_automation';

/** Entitlement keys sold / gated in this release. */
export const RELEASE_ALLOWED_FEATURES = Object.freeze([
  'inbox',
  'templates',
  'segments',
  'whatsapp_flows',
  'entry_points',
  'automation',
  'campaigns',
  'marketing_messages',
  'connectors',
  'ai_agent',
  'ai_auto_reply',
  'dialogflow_bot',
  'webviews',
  'sheets_bot',
  'reply_bots',
  'assisted_onboarding',
  'simple_mode'
]);

/** Full-CRM keys hard-blocked for this release (cannot be re-enabled). */
export const RELEASE_EXCLUDED_FEATURES = Object.freeze([
  'ads',
  'calling',
  'commerce',
  'conversions',
  'checkout_recovery',
  'crm_sync',
  'whatsapp_groups',
  'ecommerce_playbooks'
]);

const allowedFeatureSet = new Set(RELEASE_ALLOWED_FEATURES);
const excludedFeatureSet = new Set(RELEASE_EXCLUDED_FEATURES);

/** Workspace views removed from this release (hard block). */
export const RELEASE_EXCLUDED_VIEWS = Object.freeze([
  'ads',
  'calling',
  'commerce',
  'catalog',
  'conversions',
  'groups',
  'journeys',
  'meta_analytics'
]);

const excludedViewSet = new Set(RELEASE_EXCLUDED_VIEWS);

/** Integration marketplace / catalog ids removed from this release. */
export const RELEASE_EXCLUDED_INTEGRATION_IDS = Object.freeze([
  'shopify',
  'woocommerce',
  'hubspot',
  'salesforce',
  'razorpay_merchant',
  'zoho',
  'zoho_crm'
]);

const excludedIntegrationSet = new Set(RELEASE_EXCLUDED_INTEGRATION_IDS);

/** Public Features / Products CMS slugs blocked in this release. */
export const RELEASE_EXCLUDED_FEATURE_SLUGS = Object.freeze([
  'whatsapp-ads',
  'whatsapp-calling',
  'whatsapp-commerce'
]);

export const RELEASE_EXCLUDED_PRODUCT_SLUGS = Object.freeze(['ads-commerce']);

const excludedFeatureSlugSet = new Set(RELEASE_EXCLUDED_FEATURE_SLUGS);
const excludedProductSlugSet = new Set(RELEASE_EXCLUDED_PRODUCT_SLUGS);

/**
 * App path prefixes blocked for HTML navigations (exact or child paths).
 * Keep Meta connection / flows / media / entry-points / capabilities.
 */
export const RELEASE_BLOCKED_APP_PATHS = Object.freeze([
  '/app/ads',
  '/app/commerce',
  '/app/calling',
  '/app/conversions',
  '/app/settings/whatsapp/catalog',
  '/app/settings/whatsapp/groups',
  '/app/settings/whatsapp/journeys',
  '/app/settings/whatsapp/analytics'
]);

/** API path prefixes that must return 404/410 for tenant sessions. */
export const RELEASE_BLOCKED_API_PREFIXES = Object.freeze([
  '/api/whatsapp/ads',
  '/api/whatsapp/commerce',
  '/api/whatsapp/calling',
  '/api/whatsapp/conversions',
  '/api/whatsapp/groups',
  '/api/commerce/playbooks',
  '/api/workspace/ad-optimization',
  '/api/workspace/groups-inbox',
  '/api/shopify',
  '/api/woocommerce',
  '/api/hubspot',
  '/api/salesforce'
]);

/** Product capability registry ids excluded from public/operator catalogues. */
export const RELEASE_EXCLUDED_CAPABILITY_IDS = Object.freeze([
  'commerce_catalog',
  'native_whatsapp_payments',
  'merchant_checkout',
  'checkout_recovery',
  'ctwa_ads',
  'ads_insights',
  'ad_credits_wallet',
  'ad_advice',
  'conversions',
  'journey_analytics',
  'calling',
  'whatsapp_groups',
  'shopify',
  'woocommerce',
  'hubspot_crm',
  'salesforce_crm',
  'ecommerce_playbooks',
  'lead_website_ads'
]);

const excludedCapabilitySet = new Set(RELEASE_EXCLUDED_CAPABILITY_IDS);

export function isReleaseFeatureAllowed(feature) {
  const key = String(feature || '').trim();
  if (!key) return false;
  if (excludedFeatureSet.has(key)) return false;
  if (allowedFeatureSet.has(key)) return true;
  // Unknown keys are not sold in this release.
  return false;
}

export function isReleaseFeatureExcluded(feature) {
  return excludedFeatureSet.has(String(feature || '').trim());
}

export function isReleaseViewAllowed(view) {
  return !excludedViewSet.has(String(view || '').trim());
}

export function isReleaseIntegrationAllowed(id) {
  return !excludedIntegrationSet.has(String(id || '').trim().toLowerCase());
}

export function isReleaseFeatureSlugAllowed(slug) {
  return !excludedFeatureSlugSet.has(String(slug || '').trim().toLowerCase());
}

export function isReleaseProductSlugAllowed(slug) {
  return !excludedProductSlugSet.has(String(slug || '').trim().toLowerCase());
}

export function isReleaseCapabilityAllowed(capability) {
  if (!capability) return false;
  if (excludedCapabilitySet.has(capability.id)) return false;
  if (capability.feature && excludedFeatureSet.has(capability.feature)) return false;
  return true;
}

function normalizePath(pathname) {
  const raw = String(pathname || '').split('?')[0].split('#')[0];
  if (!raw) return '/';
  const trimmed = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
  return trimmed || '/';
}

function pathMatchesPrefix(pathname, prefix) {
  const path = normalizePath(pathname);
  const base = normalizePath(prefix);
  return path === base || path.startsWith(`${base}/`);
}

export function isReleaseAppPathBlocked(pathname) {
  const path = normalizePath(pathname);
  return RELEASE_BLOCKED_APP_PATHS.some((prefix) => pathMatchesPrefix(path, prefix));
}

export function isReleaseApiPathBlocked(pathname) {
  const path = normalizePath(pathname);
  return RELEASE_BLOCKED_API_PREFIXES.some((prefix) => pathMatchesPrefix(path, prefix));
}

/** Filter WORKSPACE_FEATURES-style maps to allowed keys only (for SA / plan editors). */
export function filterWorkspaceFeatureLabels(featureMap = {}) {
  return Object.fromEntries(
    Object.entries(featureMap || {}).filter(([key]) => isReleaseFeatureAllowed(key))
  );
}

/** Strip excluded entitlement keys from plan.features arrays (keep marketing bullets). */
export function filterPlanFeatureList(features) {
  if (!Array.isArray(features)) return [];
  return features.filter((item) => {
    const raw = String(item || '')
      .trim()
      .toLowerCase()
      .replace(/^feature_/, '')
      .replace(/-/g, '_');
    if (!raw) return false;
    if (excludedFeatureSet.has(raw)) return false;
    if (allowedFeatureSet.has(raw)) return true;
    // Marketing copy / unknown — keep if it does not match an excluded key.
    return !Object.values(RELEASE_EXCLUDED_FEATURES).includes(raw);
  });
}

export function filterNavGroups(navGroups = []) {
  return (navGroups || [])
    .map((group) => ({
      ...group,
      items: (group.items || []).filter((item) => isReleaseViewAllowed(item.id))
    }))
    .filter((group) => (group.items || []).length > 0);
}

export function filterIntegrationCatalog(items = []) {
  return (items || []).filter((item) => isReleaseIntegrationAllowed(item?.id));
}

export function filterProductCapabilities(items = []) {
  return (items || []).filter((item) => isReleaseCapabilityAllowed(item));
}

/**
 * Runtime CMS sanitizer so production DB documents cannot resurface excluded CRM pages.
 * Hides products/features by slug and strips cards/links pointing at blocked hrefs.
 */
export function sanitizeCmsDocumentForRelease(document) {
  if (!document || typeof document !== 'object') return document;
  const next = { ...document };

  if (Array.isArray(next.products)) {
    next.products = next.products
      .filter((product) => isReleaseProductSlugAllowed(product?.slug))
      .map((product) => ({
        ...product,
        features: Array.isArray(product.features)
          ? product.features.filter((feature) => {
              const href = String(feature?.href || '');
              const slug = href.replace(/^\/features\//, '').split('/')[0];
              return !slug || isReleaseFeatureSlugAllowed(slug);
            })
          : product.features,
        benefits: Array.isArray(product.benefits)
          ? product.benefits.filter((text) => !/(ctwa|click-to-whatsapp|calling|catalog|commerce payment)/i.test(String(text)))
          : product.benefits
      }));
  }

  if (Array.isArray(next.pages)) {
    next.pages = next.pages
      .filter((page) => {
        if (page?.kind === 'feature' && !isReleaseFeatureSlugAllowed(page.slug)) return false;
        if (page?.kind === 'product' && !isReleaseProductSlugAllowed(page.slug)) return false;
        return true;
      })
      .map((page) => sanitizeCmsPageBlocks(page));
  }

  if (Array.isArray(next.navigation)) {
    next.navigation = next.navigation
      .map((item) => {
        if (!item || typeof item !== 'object') return item;
        if (isBlockedMarketingHref(item.href)) return null;
        const children = Array.isArray(item.children)
          ? item.children.filter((child) => !isBlockedMarketingHref(child?.href))
          : item.children;
        return { ...item, children, href: scrubHref(item.href) };
      })
      .filter(Boolean);
  }

  if (next.footer && typeof next.footer === 'object') {
    next.footer = {
      ...next.footer,
      ctaHref: scrubHref(next.footer.ctaHref),
      links: Array.isArray(next.footer.links)
        ? next.footer.links.filter((link) => !isBlockedMarketingHref(link?.href))
        : next.footer.links
    };
  }

  return next;
}

function isBlockedMarketingHref(href) {
  const value = String(href || '').trim();
  if (!value) return false;
  if (RELEASE_EXCLUDED_FEATURE_SLUGS.some((slug) => value === `/features/${slug}` || value.startsWith(`/features/${slug}/`))) {
    return true;
  }
  if (RELEASE_EXCLUDED_PRODUCT_SLUGS.some((slug) => value === `/products/${slug}` || value.startsWith(`/products/${slug}/`))) {
    return true;
  }
  if (isReleaseAppPathBlocked(value)) return true;
  return false;
}

function isBlockedMarketingBlock(block) {
  if (!block || typeof block !== 'object') return false;
  if (isBlockedMarketingHref(block.href)) return true;
  const blob = `${block.title || ''} ${block.text || ''} ${block.label || ''}`.toLowerCase();
  return /(click-to-whatsapp|\bctwa\b|whatsapp calling|\bcalling\b|commerce & payments|catalog and payment|hubspot|salesforce|\bshopify\b|woocommerce|crm sync)/i.test(
    blob
  );
}

function scrubHref(value) {
  return isBlockedMarketingHref(value) ? '' : value;
}

function sanitizeCmsPageBlocks(page) {
  if (!page || typeof page !== 'object') return page;
  const hero = page.hero
    ? {
        ...page.hero,
        ctaHref: scrubHref(page.hero.ctaHref),
        secondaryCTA: page.hero.secondaryCTA
          ? { ...page.hero.secondaryCTA, href: scrubHref(page.hero.secondaryCTA.href) }
          : page.hero.secondaryCTA
      }
    : page.hero;
  const sections = Array.isArray(page.sections)
    ? page.sections
        .map((section) => {
          if (!section || typeof section !== 'object') return section;
          if (isBlockedMarketingHref(section.ctaHref)) {
            // Drop "Part of a product suite" CTAs that pointed at removed CRM products.
            return null;
          }
          const blocks = Array.isArray(section.blocks)
            ? section.blocks.filter((block) => !isBlockedMarketingBlock(block))
            : section.blocks;
          return { ...section, blocks, ctaHref: scrubHref(section.ctaHref) };
        })
        .filter(Boolean)
    : page.sections;
  return { ...page, hero, sections };
}

export function releaseBlockedResponse(kind = 'feature') {
  return {
    error:
      kind === 'api'
        ? 'This capability is not included in the WhatsApp Automation release.'
        : 'This page is not available in the WhatsApp Automation product.',
    code: 'RELEASE_SCOPE_EXCLUDED',
    status: 404
  };
}
