import { workspaceRoutes } from '../components/workspace/nav-config.js';

/** Canonical post-auth landing when no feature destination was requested. */
export const DEFAULT_POST_AUTH_PATH = '/';

/** Primary CRM module entry (not the generic dashboard). */
export const DEFAULT_WORKSPACE_PATH = '/app/inbox';

const ALLOWED_APP_PREFIXES = [
  '/app/',
  '/invite/',
  '/features/',
  '/products/',
  '/solutions/',
  '/resources/',
  '/integrations',
  '/pricing',
  '/about',
  '/contact',
  '/how-it-works',
  '/security',
  '/privacy-policy',
  '/terms'
];

/** Public marketing feature/product slugs → authenticated CRM workspace routes. */
export const FEATURE_WORKSPACE_BY_SLUG = Object.freeze({
  'whatsapp-calling': workspaceRoutes.calling,
  calling: workspaceRoutes.calling,
  'whatsapp-broadcasting': workspaceRoutes.campaigns,
  broadcasting: workspaceRoutes.campaigns,
  'automation-platform': workspaceRoutes.automation,
  'ads-commerce': workspaceRoutes.ads,
  'whatsapp-inbox': workspaceRoutes.inbox,
  'shared-inbox': workspaceRoutes.inbox,
  inbox: workspaceRoutes.inbox,
  'whatsapp-automation': workspaceRoutes.automation,
  automation: workspaceRoutes.automation,
  'whatsapp-chatbots': workspaceRoutes.automation,
  'whatsapp-flows': workspaceRoutes.flows,
  'whatsapp-ads': workspaceRoutes.ads,
  'click-to-whatsapp-ads': workspaceRoutes.ads,
  'whatsapp-analytics': workspaceRoutes.results,
  'campaign-analytics': workspaceRoutes.results,
  analytics: workspaceRoutes.results,
  'whatsapp-commerce': workspaceRoutes.commerce,
  'commerce-payments': workspaceRoutes.commerce,
  commerce: workspaceRoutes.commerce,
  'whatsapp-retargeting': workspaceRoutes.results,
  templates: workspaceRoutes.templates,
  'whatsapp-templates': workspaceRoutes.templates,
  contacts: workspaceRoutes.contacts,
  audience: workspaceRoutes.contacts,
  integrations: workspaceRoutes.integrations,
  'whatsapp-ai-agents': workspaceRoutes.ai_agents,
  'ai-agents': workspaceRoutes.ai_agents,
  'whatsapp-crm': workspaceRoutes.inbox
});

/** Map /features/{slug} or /products/{slug} public paths to CRM workspaces when present. */
export function workspacePathForPublicHref(href) {
  const raw = String(href || '').trim().split('?')[0].split('#')[0];
  const match = raw.match(/^\/(features|products)\/([a-z0-9-]+)\/?$/i);
  if (!match) return '';
  return workspacePathForSlug(match[2]);
}

export function workspacePathForSlug(slug) {
  const key = String(slug || '').trim().toLowerCase();
  return FEATURE_WORKSPACE_BY_SLUG[key] || '';
}

export function workspacePathForMarketingPage(page) {
  if (!page) return '';
  if (page.kind === 'feature' || page.kind === 'product') return workspacePathForSlug(page.slug);
  return '';
}

/**
 * Allow only same-origin relative paths used by the product.
 * Defaults to the root marketing entry (not /app/dashboard).
 */
export function safeAuthReturnPath(input, fallback = DEFAULT_POST_AUTH_PATH) {
  const raw = String(input || '').trim();
  const path = raw || fallback;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('\n') || path.includes('\r')) {
    return fallback;
  }
  if (path.startsWith('/super-admin') || path.startsWith('/api/')) return fallback;
  if (path === '/') return '/';
  if (path === '/login' || path === '/signup' || path.startsWith('/login?') || path.startsWith('/signup?')) return fallback;
  if (path.startsWith('/app')) {
    const allowed = Object.values(workspaceRoutes);
    if (path === '/app' || path === '/app/') return DEFAULT_WORKSPACE_PATH;
    if (allowed.includes(path)) return path;
    if (path.startsWith('/app/inbox/')) return path.slice(0, 240);
    if (path.startsWith('/app/settings/')) return path.slice(0, 240);
    return DEFAULT_WORKSPACE_PATH;
  }
  if (ALLOWED_APP_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))) return path.slice(0, 240);
  return fallback;
}

export function withAuthReturn(basePath, nextPath) {
  const raw = String(basePath || '/login');
  const url = new URL(raw, 'https://example.invalid');
  const next = safeAuthReturnPath(nextPath, '');
  if (next && next !== DEFAULT_POST_AUTH_PATH) {
    url.searchParams.set('next', next);
  } else {
    url.searchParams.delete('next');
  }
  return `${url.pathname}${url.search}`;
}

/**
 * Resolve the public "Use feature" CTA for a marketing page based on session.
 */
export function resolveLaunchCta({ page, authenticated = false, labelFallback = '' } = {}) {
  const workspace = workspacePathForMarketingPage(page);
  const title = String(page?.title || 'feature').trim();
  if (workspace) {
    if (authenticated) {
      return { href: workspace, label: labelFallback || `Open ${title}` };
    }
    return {
      href: withAuthReturn('/login', workspace),
      label: labelFallback || `Use ${title}`
    };
  }
  if (authenticated) {
    return { href: DEFAULT_WORKSPACE_PATH, label: labelFallback || 'Open workspace' };
  }
  return { href: withAuthReturn('/signup', DEFAULT_POST_AUTH_PATH), label: labelFallback || 'Get started' };
}

export function isGenericSignupHref(href) {
  const value = String(href || '').trim().toLowerCase();
  return value === '/signup' || value.startsWith('/signup?') || value === '/login' || value.startsWith('/login?');
}
