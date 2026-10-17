import { AppError } from './db.js';
import { DESIGN_HTML_MAX_CHARS, sanitizeDesignMarkup } from './public-site-html.js';

const PAGE_KINDS = new Set(['home', 'page', 'feature', 'product', 'solution', 'resource', 'about', 'contact', 'faq', 'pricing', 'legal', 'integrations', 'security']);
const SECTION_PRESETS = new Set(['plain', 'split-media', 'feature-grid', 'cards', 'steps', 'cta-band', 'faq', 'stats', 'rich', 'columns', 'product-showcase']);
const BACKGROUNDS = new Set(['default', 'muted', 'brand', 'dark', 'accent-soft']);
const PADDINGS = new Set(['compact', 'normal', 'spacious']);
const ALIGNMENTS = new Set(['left', 'center']);
const MEDIA_SIDES = new Set(['left', 'right', 'none']);
const BLOCK_TYPES = new Set(['heading', 'paragraph', 'list', 'quote', 'link', 'image', 'button', 'card', 'feature-item', 'faq-item', 'stat', 'html', 'video']);
const LINK_TYPES = new Set(['internal', 'external', 'hash', 'menu']);
const MENU_STYLES = new Set(['link', 'dropdown', 'mega']);
const SAFE_VIDEO = /^(https:\/\/(?:www\.)?(?:youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/)[A-Za-z0-9_-]+(?:\?[^\s]*)?)$/;
const ICONS = new Set(['', 'message', 'phone', 'megaphone', 'bot', 'spark', 'workflow', 'form', 'grid', 'shield', 'integrations', 'products', 'automation']);

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const fail = (message = 'Invalid website content.') => {
  throw new AppError(message, 400, 'SITE_INVALID');
};
const clean = (input, max, message) => {
  if (typeof input !== 'string' || input.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input)) fail(message || 'Invalid website content.');
  return input.trim();
};
const optional = (input, max) => clean(input || '', max);

function validateStringList(input, maxItems, maxLen) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, maxItems)
    .map((line) => optional(line, maxLen))
    .filter(Boolean);
}

function localPath(input, allowEmpty = true) {
  const path = optional(input, 240);
  if (!path) return allowEmpty ? '' : fail('Internal links need a path like /features/whatsapp-calling.');
  if (!/^\/(?!\/)[a-zA-Z0-9/_#?=&.%\-]*$/.test(path)) fail(`Invalid internal path: ${path}`);
  return path;
}

function externalHttps(input, allowEmpty = true) {
  const href = optional(input, 400);
  if (!href) return allowEmpty ? '' : fail('External links must use https://');
  if (!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?(?:\/[^\s]*)?$/.test(href)) fail('External links must use a valid https:// URL.');
  return href;
}

function slugValue(input, { allowEmpty = false } = {}) {
  const slug = optional(input, 80).toLowerCase();
  if (!slug) return allowEmpty ? '' : fail('Every page needs a URL slug.');
  if (slug === 'home') return '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug !== '') fail(`Invalid slug "${input}". Use lowercase letters, numbers, and hyphens.`);
  return slug;
}

function hexColor(input, fallback) {
  const value = optional(input, 20) || fallback;
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) fail(`Invalid color ${value}. Use #RRGGBB.`);
  return value.toLowerCase();
}

function validateNavItem(item, depth = 0) {
  if (!isObject(item)) fail('Navigation items are invalid.');
  if (depth > 2) fail('Navigation supports up to two nested levels (product → features).');
  const id = clean(item.id || `nav-${Math.random().toString(36).slice(2, 8)}`, 48);
  const label = clean(item.label, 60, 'Navigation labels are required.');
  const menuStyle = MENU_STYLES.has(item.menuStyle) ? item.menuStyle : (Array.isArray(item.children) && item.children.length ? (depth === 0 ? 'mega' : 'dropdown') : 'link');
  let type = LINK_TYPES.has(item.type) ? item.type : (String(item.href || '').startsWith('http') ? 'external' : 'internal');
  if ((menuStyle === 'mega' || menuStyle === 'dropdown') && !item.href && type !== 'external') type = 'menu';
  let href = '';
  if (type === 'menu') href = '';
  else if (type === 'external') href = externalHttps(item.href, false);
  else if (type === 'hash') {
    href = optional(item.href, 80);
    if (!/^#[a-zA-Z][a-zA-Z0-9_-]*$/.test(href)) fail('Hash links must look like #section-id.');
  } else href = localPath(item.href, menuStyle !== 'link');
  if (menuStyle === 'link' && type !== 'menu' && !href) fail(`Navigation item "${label}" needs a destination.`);
  const children = Array.isArray(item.children)
    ? item.children.slice(0, 16).map((child) => validateNavItem(child, depth + 1))
    : [];
  const icon = ICONS.has(item.icon || '') ? (item.icon || '') : '';
  return {
    id,
    label,
    href,
    type,
    menuStyle: depth === 0 ? menuStyle : (children.length ? 'dropdown' : 'link'),
    description: optional(item.description, 180),
    icon,
    visible: item.visible !== false,
    openInNewTab: Boolean(item.openInNewTab) && type === 'external',
    children
  };
}

function validateProductFeature(feature) {
  if (!isObject(feature)) fail('Product features are invalid.');
  return {
    id: clean(feature.id || `feat-${Math.random().toString(36).slice(2, 8)}`, 48),
    title: clean(feature.title, 80, 'Features need a title.'),
    summary: optional(feature.summary, 200),
    href: feature.href ? (String(feature.href).startsWith('http') ? externalHttps(feature.href) : localPath(feature.href, false)) : '',
    icon: ICONS.has(feature.icon || '') ? (feature.icon || '') : '',
    visible: feature.visible !== false,
    order: Number.isFinite(Number(feature.order)) ? Number(feature.order) : 100
  };
}

function validateProduct(product) {
  if (!isObject(product)) fail('Products are invalid.');
  const features = Array.isArray(product.features)
    ? product.features.slice(0, 24).map(validateProductFeature).sort((a, b) => a.order - b.order)
    : [];
  const ctaLabel = optional(product.ctaLabel, 60);
  return {
    id: clean(product.id || `product-${Math.random().toString(36).slice(2, 8)}`, 48),
    title: clean(product.title, 80, 'Products need a title.'),
    slug: slugValue(product.slug || product.title),
    summary: optional(product.summary, 240),
    href: product.href ? (String(product.href).startsWith('http') ? externalHttps(product.href) : localPath(product.href, false)) : '',
    icon: ICONS.has(product.icon || '') ? (product.icon || 'products') : 'products',
    visible: product.visible !== false,
    order: Number.isFinite(Number(product.order)) ? Number(product.order) : 100,
    features,
    benefits: validateStringList(product.benefits, 8, 160),
    useCases: validateStringList(product.useCases, 8, 160),
    ctaLabel,
    ctaHref: ctaLabel && optional(product.ctaHref, 240)
      ? (String(product.ctaHref).startsWith('http') ? externalHttps(product.ctaHref) : localPath(product.ctaHref, false))
      : '',
    seoTitle: optional(product.seoTitle, 120),
    seoDescription: optional(product.seoDescription, 300),
    heroHeading: optional(product.heroHeading, 160),
    heroSubheading: optional(product.heroSubheading, 400)
  };
}

/** Build a Products mega-menu nav item from the product catalog (suites only — no nested features). */
export function buildProductsMegaNav(products = []) {
  const visible = (Array.isArray(products) ? products : []).filter((product) => product.visible !== false).sort((a, b) => a.order - b.order);
  return {
    id: 'nav-products',
    label: 'Products',
    href: '/products',
    type: 'internal',
    menuStyle: 'mega',
    description: 'Explore product suites',
    icon: 'products',
    visible: true,
    openInNewTab: false,
    children: visible.map((product) => ({
      id: `nav-product-${product.id}`,
      label: product.title,
      href: product.href || `/products/${product.slug || ''}`,
      type: 'internal',
      menuStyle: 'link',
      description: product.summary || '',
      icon: product.icon || 'grid',
      visible: true,
      openInNewTab: false,
      children: []
    }))
  };
}

/** Dropdown of published feature pages for top-level Features nav. */
export function buildFeaturesNav(pages = []) {
  const features = (Array.isArray(pages) ? pages : [])
    .filter((page) => page.kind === 'feature' && page.published !== false)
    .sort((a, b) => (a.navOrder || 100) - (b.navOrder || 100) || String(a.title).localeCompare(String(b.title)));
  return {
    id: 'nav-features',
    label: 'Features',
    href: '/features',
    type: 'internal',
    menuStyle: 'dropdown',
    description: 'Capability deep-dives',
    icon: 'grid',
    visible: true,
    openInNewTab: false,
    children: features.map((page) => ({
      id: `nav-feature-page-${page.id}`,
      label: page.title,
      href: `/features/${page.slug}`,
      type: 'internal',
      menuStyle: 'link',
      description: optional(page.summary, 180),
      icon: '',
      visible: true,
      openInNewTab: false,
      children: []
    }))
  };
}

/** Dropdown of published solution use-case pages. */
export function buildSolutionsNav(pages = []) {
  const solutions = (Array.isArray(pages) ? pages : [])
    .filter((page) => page.kind === 'solution' && page.published !== false)
    .sort((a, b) => (a.navOrder || 100) - (b.navOrder || 100) || String(a.title).localeCompare(String(b.title)));
  return {
    id: 'nav-solutions',
    label: 'Solutions',
    href: '/solutions',
    type: 'internal',
    menuStyle: 'dropdown',
    description: 'Use cases on WhatsApp',
    icon: 'workflow',
    visible: true,
    openInNewTab: false,
    children: solutions.map((page) => ({
      id: `nav-solution-${page.id}`,
      label: page.title,
      href: `/solutions/${page.slug}`,
      type: 'internal',
      menuStyle: 'link',
      description: optional(page.summary, 180),
      icon: '',
      visible: true,
      openInNewTab: false,
      children: []
    }))
  };
}

/** Dropdown of published resource guides for top-level Resources nav. */
export function buildResourcesNav(pages = []) {
  const guides = (Array.isArray(pages) ? pages : [])
    .filter((page) => page.kind === 'resource' && page.published !== false)
    .sort((a, b) => (a.navOrder || 100) - (b.navOrder || 100) || String(a.title).localeCompare(String(b.title)));
  return {
    id: 'nav-resources',
    label: 'Resources',
    href: '/resources',
    type: 'internal',
    menuStyle: 'dropdown',
    description: 'Guides and FAQs',
    icon: 'form',
    visible: true,
    openInNewTab: false,
    children: guides.map((page) => ({
      id: `nav-res-${page.slug}`,
      label: page.title,
      href: `/resources/${page.slug}`,
      type: 'internal',
      menuStyle: 'link',
      description: optional(page.summary, 180),
      icon: '',
      visible: true,
      openInNewTab: false,
      children: []
    }))
  };
}

/** Company links — About, product explanation, contact, and published policy routes. */
export function buildCompanyNav() {
  return {
    id: 'nav-company',
    label: 'Company',
    href: '/about',
    type: 'internal',
    menuStyle: 'dropdown',
    description: 'About, policies, and contact',
    icon: '',
    visible: true,
    openInNewTab: false,
    children: [
      { id: 'nav-company-about', label: 'About', href: '/about', type: 'internal', menuStyle: 'link', description: 'Product mission and approach', icon: '', visible: true, openInNewTab: false, children: [] },
      { id: 'nav-company-how', label: 'How it works', href: '/how-it-works', type: 'internal', menuStyle: 'link', description: 'Public site vs signed-in workspace', icon: 'workflow', visible: true, openInNewTab: false, children: [] },
      { id: 'nav-company-contact', label: 'Contact', href: '/contact', type: 'internal', menuStyle: 'link', description: 'Reach the team', icon: '', visible: true, openInNewTab: false, children: [] },
      { id: 'nav-company-security', label: 'Security', href: '/security', type: 'internal', menuStyle: 'link', description: 'Access controls and auditability', icon: 'shield', visible: true, openInNewTab: false, children: [] },
      { id: 'nav-company-privacy', label: 'Privacy', href: '/privacy-policy', type: 'internal', menuStyle: 'link', description: 'Privacy policy', icon: '', visible: true, openInNewTab: false, children: [] },
      { id: 'nav-company-terms', label: 'Terms', href: '/terms', type: 'internal', menuStyle: 'link', description: 'Terms of use', icon: '', visible: true, openInNewTab: false, children: [] }
    ]
  };
}

function defaultMarketingNavigation(products, pages) {
  return [
    { id: 'nav-home', label: 'Home', href: '/', type: 'internal', menuStyle: 'link', description: '', icon: '', visible: true, openInNewTab: false, children: [] },
    buildProductsMegaNav(products),
    buildFeaturesNav(pages),
    { id: 'nav-integrations', label: 'Integrations', href: '/integrations', type: 'internal', menuStyle: 'link', description: '', icon: 'integrations', visible: true, openInNewTab: false, children: [] },
    buildSolutionsNav(pages),
    buildResourcesNav(pages),
    { id: 'nav-pricing', label: 'Pricing', href: '/pricing', type: 'internal', menuStyle: 'link', description: '', icon: '', visible: true, openInNewTab: false, children: [] },
    buildCompanyNav()
  ];
}

/** Rich multi-column footer defaults — only links to routes that exist in the public site. */
export function buildDefaultFooter(products = [], pages = []) {
  const productLinks = (Array.isArray(products) ? products : [])
    .filter((product) => product.visible !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .slice(0, 8)
    .map((product) => ({
      label: product.title,
      href: product.href || (product.slug ? `/products/${product.slug}` : '/products')
    }));
  const featureLinks = (Array.isArray(pages) ? pages : [])
    .filter((page) => page.kind === 'feature' && page.published !== false)
    .sort((a, b) => (a.navOrder || 100) - (b.navOrder || 100) || String(a.title).localeCompare(String(b.title)))
    .slice(0, 8)
    .map((page) => ({ label: page.title, href: `/features/${page.slug}` }));
  const solutionLinks = (Array.isArray(pages) ? pages : [])
    .filter((page) => page.kind === 'solution' && page.published !== false)
    .sort((a, b) => (a.navOrder || 100) - (b.navOrder || 100))
    .slice(0, 8)
    .map((page) => ({ label: page.title, href: `/solutions/${page.slug}` }));
  const resourceLinks = (Array.isArray(pages) ? pages : [])
    .filter((page) => page.kind === 'resource' && page.published !== false)
    .sort((a, b) => (a.navOrder || 100) - (b.navOrder || 100))
    .slice(0, 8)
    .map((page) => ({ label: page.title, href: `/resources/${page.slug}` }));

  return {
    blurb: 'WhatsApp Business CRM for shared inbox, approved broadcasts, automation, ads entry, and commerce workflows — governed from one workspace.',
    // Workspace creation stays in header / signup — not in the public footer.
    ctaLabel: '',
    ctaHref: '',
    ctaText: '',
    copyright: '',
    columns: [
      {
        id: 'footer-products',
        title: 'Products',
        visible: true,
        links: productLinks.length
          ? [{ label: 'All products', href: '/products' }, ...productLinks]
          : [{ label: 'All products', href: '/products' }]
      },
      {
        id: 'footer-features',
        title: 'Features',
        visible: true,
        links: featureLinks.length
          ? [{ label: 'All features', href: '/features' }, ...featureLinks]
          : [{ label: 'All features', href: '/features' }]
      },
      {
        id: 'footer-integrations',
        title: 'Integrations',
        visible: true,
        links: [
          { label: 'Integrations overview', href: '/integrations' },
          { label: 'Shopify', href: '/integrations#integrations-connectors' },
          { label: 'WooCommerce', href: '/integrations#integrations-connectors' },
          { label: 'HubSpot CRM', href: '/integrations#integrations-connectors' },
          { label: 'Salesforce CRM', href: '/integrations#integrations-connectors' },
          { label: 'Automation webhooks', href: '/integrations#integrations-note' }
        ]
      },
      {
        id: 'footer-solutions',
        title: 'Solutions',
        visible: true,
        links: solutionLinks.length
          ? [{ label: 'All solutions', href: '/solutions' }, ...solutionLinks]
          : [{ label: 'All solutions', href: '/solutions' }]
      },
      {
        id: 'footer-resources',
        title: 'Resources',
        visible: true,
        links: resourceLinks.length
          ? [{ label: 'Resource hub', href: '/resources' }, ...resourceLinks]
          : [
            { label: 'Resource hub', href: '/resources' },
            { label: 'Getting started', href: '/resources/getting-started' },
            { label: 'FAQ', href: '/resources/faq' }
          ]
      },
      {
        id: 'footer-company',
        title: 'Company',
        visible: true,
        links: [
          { label: 'About us', href: '/about' },
          { label: 'How it works', href: '/how-it-works' },
          { label: 'Security', href: '/security' },
          { label: 'Contact', href: '/contact' },
          { label: 'Pricing', href: '/pricing' }
        ]
      },
      {
        id: 'footer-legal',
        title: 'Legal',
        visible: true,
        links: [
          { label: 'Privacy policy', href: '/privacy-policy' },
          { label: 'Terms of service', href: '/terms' }
        ]
      }
    ],
    links: [
      { label: 'Privacy', href: '/privacy-policy' },
      { label: 'Terms', href: '/terms' }
    ],
    socialLinks: []
  };
}

/** Strip workspace-signup CTAs from public footers (signup belongs in header/auth). */
function scrubFooterWorkspaceActions(footer) {
  if (!footer || typeof footer !== 'object') return footer;
  const next = { ...footer };
  const ctaHref = String(next.ctaHref || '').trim().toLowerCase();
  const ctaLabel = String(next.ctaLabel || '').trim().toLowerCase();
  if (ctaHref === '/signup' || ctaHref.startsWith('/signup') || ctaLabel.includes('create workspace') || ctaLabel.includes('get started')) {
    next.ctaLabel = '';
    next.ctaHref = '';
    next.ctaText = '';
  }
  if (Array.isArray(next.columns)) {
    next.columns = next.columns.map((column) => ({
      ...column,
      links: Array.isArray(column.links)
        ? column.links.filter((link) => {
          const href = String(link?.href || '').toLowerCase();
          const label = String(link?.label || '').toLowerCase();
          if (href === '/signup' || href.startsWith('/signup')) return false;
          if (label.includes('create workspace')) return false;
          return true;
        })
        : []
    }));
  }
  return next;
}

function isThinFooter(footer) {
  if (!footer || typeof footer !== 'object') return true;
  const columns = Array.isArray(footer.columns) ? footer.columns : [];
  const visibleColumns = columns.filter((column) => column && column.visible !== false && Array.isArray(column.links) && column.links.length);
  return visibleColumns.length === 0;
}

function ensureMarketingNavigation(document) {
  const products = Array.isArray(document.products) && document.products.length ? document.products : defaultProducts();
  const pages = Array.isArray(document.pages) ? document.pages : [];
  let navigation = Array.isArray(document.navigation) ? document.navigation.map((item) => ({ ...item })) : [];

  const productsNav = buildProductsMegaNav(products);
  const productsIdx = navigation.findIndex((item) => item.id === 'nav-products' || (item.menuStyle === 'mega' && item.label === 'Products'));
  if (productsIdx >= 0) {
    navigation[productsIdx] = { ...navigation[productsIdx], ...productsNav, children: productsNav.children };
  } else {
    const homeIdx = navigation.findIndex((item) => item.id === 'nav-home' || item.href === '/');
    navigation.splice(homeIdx >= 0 ? homeIdx + 1 : 0, 0, productsNav);
  }

  const insertAfter = (afterId, item) => {
    if (navigation.some((nav) => nav.id === item.id)) return;
    const idx = navigation.findIndex((nav) => nav.id === afterId);
    navigation.splice(idx >= 0 ? idx + 1 : navigation.length, 0, item);
  };

  insertAfter('nav-products', buildFeaturesNav(pages));
  insertAfter('nav-features', {
    id: 'nav-integrations',
    label: 'Integrations',
    href: '/integrations',
    type: 'internal',
    menuStyle: 'link',
    description: '',
    icon: 'integrations',
    visible: true,
    openInNewTab: false,
    children: []
  });
  insertAfter('nav-integrations', buildSolutionsNav(pages));
  insertAfter('nav-solutions', buildResourcesNav(pages));
  insertAfter('nav-resources', buildCompanyNav());

  const refreshDropdown = (id, factory) => {
    const idx = navigation.findIndex((item) => item.id === id);
    if (idx >= 0) navigation[idx] = factory();
  };
  refreshDropdown('nav-features', () => buildFeaturesNav(pages));
  refreshDropdown('nav-solutions', () => buildSolutionsNav(pages));
  refreshDropdown('nav-resources', () => buildResourcesNav(pages));
  refreshDropdown('nav-company', () => buildCompanyNav());

  navigation = navigation.filter((item) => item.id !== 'nav-about' && item.id !== 'nav-contact');

  for (const item of navigation) {
    if (item.id === 'nav-products' && (!item.href || item.href === '/features')) item.href = '/products';
  }

  return navigation;
}

function defaultProducts() {
  return [
    {
      id: 'product-whatsapp-crm',
      title: 'WhatsApp CRM',
      slug: 'whatsapp-crm',
      summary: 'One shared inbox, contact timeline, and team workflows on your Business number.',
      href: '/products/whatsapp-crm',
      icon: 'message',
      visible: true,
      order: 10,
      benefits: ['Shared inbox with assignment and notes', 'Contact history across chat and campaigns', 'Calling context on the same timeline'],
      useCases: ['Support teams', 'Inside sales', 'Account management'],
      ctaLabel: 'Explore inbox',
      features: [
        { id: 'f-inbox', title: 'Shared Inbox', summary: 'Multi-agent live chat on one WhatsApp number', href: '/features/whatsapp-inbox', icon: 'message', visible: true, order: 10 },
        { id: 'f-calling', title: 'WhatsApp Calling', summary: 'Voice context in your CRM timeline', href: '/features/whatsapp-calling', icon: 'phone', visible: true, order: 20 },
        { id: 'f-ai', title: 'AI Agents', summary: 'Assisted replies with human handoff', href: '/features/whatsapp-ai-agents', icon: 'spark', visible: true, order: 30 }
      ]
    },
    {
      id: 'product-broadcasting',
      title: 'Broadcasting',
      slug: 'broadcasting',
      summary: 'Template campaigns, audience controls, and delivery analytics built for WhatsApp policy.',
      href: '/products/broadcasting',
      icon: 'megaphone',
      visible: true,
      order: 20,
      benefits: ['Approved-template broadcasts at scale', 'Segment and retarget from results', 'Delivery, read, and reply tracking'],
      useCases: ['Promotions', 'Renewal reminders', 'Re-engagement'],
      ctaLabel: 'See broadcasting',
      features: [
        { id: 'f-broadcast', title: 'WhatsApp Broadcasting', summary: 'Approved template campaigns at scale', href: '/features/whatsapp-broadcasting', icon: 'megaphone', visible: true, order: 10 },
        { id: 'f-retarget', title: 'WhatsApp Retargeting', summary: 'Re-engage audiences with intent', href: '/features/whatsapp-retargeting', icon: 'workflow', visible: true, order: 20 },
        { id: 'f-analytics', title: 'Campaign Analytics', summary: 'Delivery, reads, and reply insights', href: '/features/whatsapp-analytics', icon: 'grid', visible: true, order: 30 }
      ]
    },
    {
      id: 'product-automation',
      title: 'Automation Builder',
      slug: 'automation-platform',
      summary: 'Chatbots, WhatsApp Flows, and event-driven journeys that hand off to humans cleanly.',
      href: '/products/automation-platform',
      icon: 'automation',
      visible: true,
      order: 30,
      benefits: ['Visual automation for tags and events', 'Native Flows for structured capture', 'Human handoff with full context'],
      useCases: ['Lead qualification', 'Onboarding', 'After-hours coverage'],
      ctaLabel: 'See automation',
      features: [
        { id: 'f-bots', title: 'Chatbots', summary: 'Guided journeys that qualify leads', href: '/features/whatsapp-chatbots', icon: 'bot', visible: true, order: 10 },
        { id: 'f-flows', title: 'Flows & Forms', summary: 'Structured capture inside WhatsApp', href: '/features/whatsapp-flows', icon: 'form', visible: true, order: 20 },
        { id: 'f-auto', title: 'Event automation', summary: 'Trigger the right message at the right time', href: '/features/whatsapp-automation', icon: 'workflow', visible: true, order: 30 }
      ]
    },
    {
      id: 'product-growth',
      title: 'Ads & Commerce',
      slug: 'ads-commerce',
      summary: 'Click-to-WhatsApp ads, catalog workflows, and commerce tooling beside your inbox.',
      href: '/products/ads-commerce',
      icon: 'megaphone',
      visible: true,
      order: 40,
      benefits: ['CTWA campaigns tied to your number', 'Catalog and cart workflows where enabled', 'Conversation entry measurement'],
      useCases: ['Performance marketing', 'Social commerce', 'Order support'],
      ctaLabel: 'Explore growth tools',
      features: [
        { id: 'f-ads', title: 'Click-to-WhatsApp Ads', summary: 'Run ads that open WhatsApp conversations', href: '/features/whatsapp-ads', icon: 'megaphone', visible: true, order: 10 },
        { id: 'f-commerce', title: 'Commerce & Payments', summary: 'Catalogs and in-chat commerce workflows', href: '/features/whatsapp-commerce', icon: 'grid', visible: true, order: 20 }
      ]
    }
  ];
}

function looksLikeDesignMarkup(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  return /<!DOCTYPE\s+html/i.test(raw) || /<html[\s>]/i.test(raw) || (/<style[\s>]/i.test(raw) && /<\/style>/i.test(raw) && /<(?:div|section|article|main|header|body)[\s>]/i.test(raw));
}

function validateBlock(block) {
  if (!isObject(block) || !BLOCK_TYPES.has(block.type)) fail('Unsupported content block type.');
  if (block.type === 'html' || (typeof block.text === 'string' && looksLikeDesignMarkup(block.text))) {
    if (typeof block.text !== 'string' || block.text.length > DESIGN_HTML_MAX_CHARS) {
      fail(`HTML import blocks are limited to ${DESIGN_HTML_MAX_CHARS} characters.`);
    }
    return { type: 'html', text: sanitizeDesignMarkup(block.text), emphasis: 'none' };
  }
  if (block.type === 'video') {
    const href = clean(block.href || '', 400, 'Video embeds need an https URL.');
    if (!SAFE_VIDEO.test(href)) fail('Videos must use YouTube embed or Vimeo player https URLs.');
    return { type: 'video', href, title: optional(block.title || block.text, 120), text: optional(block.title || block.text, 120), emphasis: 'none' };
  }
  if (block.type === 'link' || block.type === 'button') {
    const label = clean(block.label || block.text || '', 120, 'Buttons and links need a label.');
    const linkType = LINK_TYPES.has(block.linkType) ? block.linkType : 'internal';
    const href = linkType === 'external' ? externalHttps(block.href, false) : localPath(block.href, false);
    return {
      type: block.type,
      label,
      text: label,
      href,
      linkType,
      style: ['primary', 'secondary', 'text'].includes(block.style) ? block.style : (block.type === 'button' ? 'primary' : 'text'),
      openInNewTab: Boolean(block.openInNewTab) && linkType === 'external',
      emphasis: 'none'
    };
  }
  if (block.type === 'image') {
    const asset = ['logo', 'hero', 'custom'].includes(block.asset) ? block.asset : 'custom';
    const href = asset === 'custom' ? externalHttps(block.href, false) : '';
    const alt = optional(block.alt || block.text || '', 160);
    return { type: 'image', asset, href, alt, text: alt, width: ['narrow', 'normal', 'wide', 'full'].includes(block.width) ? block.width : 'normal' };
  }
  if (block.type === 'card' || block.type === 'feature-item') {
    return {
      type: block.type,
      title: clean(block.title || '', 120, 'Cards need a title.'),
      text: optional(block.text, 800),
      href: block.href ? (String(block.href).startsWith('http') ? externalHttps(block.href) : localPath(block.href)) : '',
      icon: optional(block.icon, 40),
      imageUrl: block.imageUrl ? externalHttps(block.imageUrl) : '',
      emphasis: 'none'
    };
  }
  if (block.type === 'faq-item') {
    return {
      type: 'faq-item',
      title: clean(block.title || block.question || '', 200, 'FAQ items need a question.'),
      text: clean(block.text || block.answer || '', 2000, 'FAQ items need an answer.'),
      emphasis: 'none'
    };
  }
  if (block.type === 'stat') {
    return {
      type: 'stat',
      title: clean(block.title || block.value || '', 40, 'Stats need a value.'),
      text: optional(block.text || block.label, 80),
      emphasis: 'none'
    };
  }
  const text = clean(block.text || '', block.type === 'list' ? 4000 : 4000, 'Text blocks cannot be empty.');
  if (!text) fail('Text blocks cannot be empty.');
  return {
    type: block.type,
    text,
    emphasis: ['none', 'bold', 'italic'].includes(block.emphasis) ? block.emphasis : 'none'
  };
}

function validateSection(section) {
  if (!isObject(section)) fail('Invalid page section.');
  const id = clean(section.id, 48, 'Section ids are required.');
  if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(`Invalid section id "${section.id}".`);
  if (!Array.isArray(section.blocks) || section.blocks.length > 24) fail('Sections support up to 24 blocks.');
  const title = optional(section.title, 160);
  const ctaLabel = optional(section.ctaLabel, 60);
  const ctaHref = ctaLabel ? localPath(section.ctaHref || '', false) : '';
  return {
    id,
    title,
    eyebrow: optional(section.eyebrow, 80),
    summary: optional(section.summary, 280),
    visible: section.visible !== false,
    preset: SECTION_PRESETS.has(section.preset || section.layout) ? (section.preset || section.layout) : 'plain',
    align: ALIGNMENTS.has(section.align) ? section.align : 'left',
    background: BACKGROUNDS.has(section.background) ? section.background : 'default',
    padding: PADDINGS.has(section.padding) ? section.padding : 'normal',
    mediaSide: MEDIA_SIDES.has(section.mediaSide) ? section.mediaSide : 'none',
    blocks: section.blocks.map(validateBlock),
    ctaLabel,
    ctaHref
  };
}

function validatePage(page, usedSlugs) {
  if (!isObject(page)) fail('Invalid page.');
  const id = clean(page.id, 48);
  const kind = PAGE_KINDS.has(page.kind) ? page.kind : 'page';
  let slug = kind === 'home' ? '' : slugValue(page.slug || page.id);
  if (kind === 'feature' && !slug.startsWith('features/')) {
    // stored without prefix; public path is /features/{slug}
    slug = slug.replace(/^features\//, '');
  }
  if (kind === 'solution' && !slug.startsWith('solutions/')) {
    slug = slug.replace(/^solutions\//, '');
  }
  if (kind === 'resource' && !slug.startsWith('resources/')) {
    slug = slug.replace(/^resources\//, '');
  }
  const routeKey = kind === 'home' ? 'home' : kind === 'feature' ? `features/${slug}` : kind === 'solution' ? `solutions/${slug}` : kind === 'resource' ? `resources/${slug}` : slug;
  if (usedSlugs.has(routeKey)) fail(`Duplicate page route: /${routeKey === 'home' ? '' : routeKey}`);
  usedSlugs.add(routeKey);
  if (!Array.isArray(page.sections) || page.sections.length > 30) fail('Pages support up to 30 sections.');
  const sectionIds = new Set();
  const sections = page.sections.map((section) => {
    const next = validateSection(section);
    if (sectionIds.has(next.id)) fail(`Duplicate section id "${next.id}" on page ${routeKey}.`);
    sectionIds.add(next.id);
    return next;
  });
  const hero = isObject(page.hero) ? {
    enabled: Boolean(page.hero.enabled),
    title: optional(page.hero.title, 160),
    subtitle: optional(page.hero.subtitle, 400),
    ctaLabel: optional(page.hero.ctaLabel, 60),
    ctaHref: page.hero.ctaLabel ? localPath(page.hero.ctaHref || '/signup', false) : '',
    image: ['none', 'hero', 'custom'].includes(page.hero.image) ? page.hero.image : 'none',
    imageUrl: page.hero.image === 'custom' ? externalHttps(page.hero.imageUrl, false) : ''
  } : { enabled: false, title: '', subtitle: '', ctaLabel: '', ctaHref: '', image: 'none', imageUrl: '' };

  return {
    id,
    slug,
    title: clean(page.title, 120, 'Pages need a title.'),
    kind,
    published: page.published !== false,
    showInNav: Boolean(page.showInNav),
    navOrder: Number.isFinite(Number(page.navOrder)) ? Number(page.navOrder) : 100,
    seoTitle: optional(page.seoTitle, 120),
    seoDescription: optional(page.seoDescription, 300),
    eyebrow: optional(page.eyebrow, 80),
    summary: optional(page.summary, 400),
    layout: ['default', 'feature', 'landing'].includes(page.layout) ? page.layout : 'default',
    hero,
    sections
  };
}

function defaultTheme() {
  return {
    primary: '#4F46E5',
    accent: '#0D9488',
    surface: '#F8FAFC',
    ink: '#0F172A',
    displayFont: 'Fraunces',
    bodyFont: 'Source Sans 3'
  };
}

function solutionPage(slug, title, summary, body, capabilityLinks = [], options = {}) {
  const sections = [
    {
      id: `${slug}-overview`,
      title: options.overviewTitle || 'The workflow',
      eyebrow: 'Overview',
      visible: true,
      preset: options.overviewPreset || 'split-media',
      align: 'left',
      background: 'default',
      padding: options.overviewPreset === 'plain' ? 'normal' : 'spacious',
      mediaSide: options.overviewPreset === 'plain' ? 'none' : 'right',
      ctaLabel: options.overviewCtaLabel || '',
      ctaHref: options.overviewCtaHref || '',
      blocks: [
        { type: 'paragraph', text: body, emphasis: 'none' },
        ...(options.overviewPreset === 'plain' ? [] : [{ type: 'image', asset: 'hero', href: '', alt: title, text: title, width: 'wide' }])
      ]
    }
  ];
  if (options.steps?.length) {
    sections.push({
      id: `${slug}-steps`,
      title: options.stepsTitle || 'How teams run it',
      eyebrow: 'Workflow',
      visible: true,
      preset: 'steps',
      align: 'left',
      background: 'muted',
      padding: 'normal',
      mediaSide: 'none',
      summary: options.stepsSummary || '',
      ctaLabel: '',
      ctaHref: '',
      blocks: options.steps.map((step) => ({ type: 'card', title: step.title, text: step.text, href: step.href || '', icon: step.icon || '', imageUrl: '' }))
    });
  }
  if (capabilityLinks.length) {
    sections.push({
      id: `${slug}-capabilities`,
      title: options.capabilitiesTitle || 'CRM capabilities involved',
      eyebrow: 'Capabilities',
      visible: true,
      preset: 'feature-grid',
      align: 'left',
      background: 'accent-soft',
      padding: 'normal',
      mediaSide: 'none',
      ctaLabel: '',
      ctaHref: '',
      blocks: capabilityLinks.map((item) => ({
        type: 'feature-item',
        title: item.title,
        text: item.text,
        href: item.href,
        icon: item.icon || '',
        imageUrl: ''
      }))
    });
  }
  if (options.benefitCards?.length) {
    sections.push({
      id: `${slug}-benefits`,
      title: options.benefitsTitle || 'Why WhatsApp for this job',
      eyebrow: 'Benefits',
      visible: true,
      preset: 'cards',
      align: 'left',
      background: 'default',
      padding: 'normal',
      mediaSide: 'none',
      ctaLabel: '',
      ctaHref: '',
      blocks: options.benefitCards.map((card) => ({ type: 'card', title: card.title, text: card.text, href: card.href || '', icon: card.icon || '', imageUrl: '' }))
    });
  }
  const faq = marketingFaqSection(slug, options.faqTitle || 'Common questions', options.faq);
  if (faq) sections.push(faq);
  sections.push(marketingCtaSection(slug, options.ctaCopy || 'Create a workspace to connect WhatsApp and run this use case with inbox, templates, and automation tools already in the product.', options.ctaLabel, options.ctaHref));

  return {
    id: `solution-${slug}`,
    slug,
    title,
    kind: 'solution',
    published: true,
    showInNav: false,
    navOrder: options.navOrder || 100,
    seoTitle: options.seoTitle || `${title} — WhatsApp CRM`,
    seoDescription: summary,
    eyebrow: 'Solution',
    summary,
    layout: 'feature',
    hero: {
      enabled: true,
      title,
      subtitle: summary,
      ctaLabel: 'Create workspace',
      ctaHref: '/signup',
      image: 'none',
      imageUrl: ''
    },
    sections
  };
}

function defaultSolutionPages() {
  return [
    solutionPage(
      'customer-support',
      'Customer support',
      'Route WhatsApp support chats through a shared inbox with assignment, templates, and clean handoff from automation.',
      'Customers message your WhatsApp Business number; agents work from one inbox with contact history, internal notes, and approved reply templates — not scattered personal phones.',
      [
        { title: 'Shared inbox', text: 'Assign threads, collaborate with notes, and respond from one Business number.', href: '/features/whatsapp-inbox', icon: 'message' },
        { title: 'Automation handoff', text: 'Bots and flows can qualify intent, then escalate to humans with context.', href: '/features/whatsapp-automation', icon: 'workflow' },
        { title: 'AI assist', text: 'Suggested replies with human approval before anything sends.', href: '/features/whatsapp-ai-agents', icon: 'spark' }
      ],
      {
        navOrder: 10,
        overviewPreset: 'split-media',
        stepsTitle: 'Support flow on WhatsApp',
        steps: [
          { title: 'Customer writes in', text: 'Messages arrive in the shared inbox with contact profile and recent activity.' },
          { title: 'Route or automate', text: 'Use tags, assignment rules, or automation to queue the right agent.' },
          { title: 'Resolve with templates', text: 'Reply with approved templates and notes; suppression flags stay visible for outbound.' }
        ],
        faq: [
          { q: 'Can automation replace agents?', a: 'Automation can answer common intents and collect details, but the CRM is built for human handoff when conversations need judgment or policy exceptions.' }
        ]
      }
    ),
    solutionPage(
      'sales-lead-follow-up',
      'Sales & lead follow-up',
      'Keep pipeline conversations in WhatsApp with inbox ownership, calling context, and follow-up automation.',
      'Prospects often prefer WhatsApp over email. Teams capture leads from ads or inbound chat, assign owners, and follow up with templates and timed automations — with calling context on the same timeline where Meta allows.',
      [
        { title: 'Shared inbox', text: 'Claim and assign lead threads so nothing sits unowned.', href: '/features/whatsapp-inbox', icon: 'message' },
        { title: 'Click-to-WhatsApp ads', text: 'Drive ad clicks into WhatsApp threads you can measure.', href: '/features/whatsapp-ads', icon: 'megaphone' },
        { title: 'Event automation', text: 'Trigger follow-ups from tags, segments, or workflow events.', href: '/features/whatsapp-automation', icon: 'workflow' },
        { title: 'WhatsApp Calling', text: 'Voice context beside chat when your number setup supports calling.', href: '/features/whatsapp-calling', icon: 'phone' }
      ],
      {
        navOrder: 20,
        overviewPreset: 'plain',
        benefitCards: [
          { title: 'One timeline', text: 'Chat, campaign touches, and calling notes on the same contact record.' },
          { title: 'Structured capture', text: 'Flows and forms collect qualification fields inside WhatsApp.', href: '/features/whatsapp-flows' },
          { title: 'Human control', text: 'AI suggestions stay agent-approved — no unsupervised auto-send in sales threads.' }
        ]
      }
    ),
    solutionPage(
      'ecommerce-order-care',
      'E-commerce order care',
      'Handle order questions and shipment updates on WhatsApp with inbox context and connector-aware automations.',
      'Shoppers message about orders on the channel they already use. Agents see contact history beside commerce events; automations can notify when integrations are enabled — without promising every storefront connects on day one.',
      [
        { title: 'Shared inbox', text: 'Order support stays on the customer timeline with tags and templates.', href: '/features/whatsapp-inbox', icon: 'message' },
        { title: 'Commerce workflows', text: 'Catalog-oriented tools when Meta commerce features are enabled.', href: '/features/whatsapp-commerce', icon: 'grid' },
        { title: 'Integrations', text: 'Shopify OAuth and WooCommerce webhooks feed events when connector flags are on.', href: '/integrations', icon: 'integrations' },
        { title: 'Utility broadcasts', text: 'Template-based shipment or renewal reminders to opted-in buyers.', href: '/features/whatsapp-broadcasting', icon: 'megaphone' }
      ],
      {
        navOrder: 30,
        overviewPreset: 'split-media',
        stepsTitle: 'Order care loop',
        stepsSummary: 'Connect the store when ready; support still runs through inbox either way.',
        steps: [
          { title: 'Customer asks on WhatsApp', text: 'Thread opens in inbox with profile and prior campaign or order notes you store in CRM.' },
          { title: 'Agent resolves with context', text: 'Templates and internal notes keep handoffs clean across shifts.' },
          { title: 'Automate status updates', text: 'When Shopify or WooCommerce is connected, event-driven messages can supplement manual replies.' }
        ],
        faq: [
          { q: 'Does every store integrate automatically?', a: 'No. Shopify and WooCommerce connectors require workspace setup and feature flags. Order support still works through manual inbox replies without them.' }
        ]
      }
    ),
    solutionPage(
      'marketing-campaigns',
      'Marketing campaigns',
      'Plan template broadcasts, measure delivery, and retarget cohorts — alongside CTWA entry when ads assets are connected.',
      'Marketing teams use approved WhatsApp templates, audience segments, and campaign analytics inside the same CRM as your inbox — so replies from a broadcast land in agent queues with context.',
      [
        { title: 'Broadcasting', text: 'Approved-template campaigns with delivery and read tracking.', href: '/features/whatsapp-broadcasting', icon: 'megaphone' },
        { title: 'Retargeting', text: 'Follow up with cohorts that did not read or reply — within policy.', href: '/features/whatsapp-retargeting', icon: 'workflow' },
        { title: 'Campaign analytics', text: 'Review performance before the next send.', href: '/features/whatsapp-analytics', icon: 'grid' },
        { title: 'CTWA ads', text: 'Paid entry into WhatsApp when Meta ad assets are linked.', href: '/features/whatsapp-ads', icon: 'megaphone' }
      ],
      {
        navOrder: 40,
        overviewPreset: 'split-media',
        benefitCards: [
          { title: 'Template discipline', text: 'Outbound marketing stays tied to approved templates and audience controls.' },
          { title: 'Reply path to inbox', text: 'Responses from campaigns route into the shared inbox — not a dead-end blast.' },
          { title: 'Measure before scaling', text: 'Delivery health and retargeting cues live in campaign analytics views.' }
        ],
        faq: [
          { q: 'Can we message purchased lists?', a: 'You should only message contacts with valid opt-in. The CRM surfaces suppression and consent signals, but list quality remains your responsibility under WhatsApp policy.' }
        ]
      }
    )
  ];
}

function resourcePage(slug, title, summary, body, relatedLinks = [], options = {}) {
  const sections = [
    {
      id: `${slug}-overview`,
      title: options.overviewTitle || 'Guide overview',
      eyebrow: 'Overview',
      visible: true,
      preset: options.overviewPreset || 'split-media',
      align: 'left',
      background: 'default',
      padding: options.overviewPreset === 'plain' ? 'normal' : 'spacious',
      mediaSide: options.overviewPreset === 'plain' ? 'none' : 'right',
      ctaLabel: options.overviewCtaLabel || 'Browse products',
      ctaHref: options.overviewCtaHref || '/products',
      blocks: [
        { type: 'paragraph', text: body, emphasis: 'none' },
        ...(options.overviewPreset === 'plain' ? [] : [{ type: 'image', asset: 'hero', href: '', alt: title, text: title, width: 'wide' }])
      ]
    }
  ];
  if (options.steps?.length) {
    sections.push({
      id: `${slug}-steps`,
      title: options.stepsTitle || 'Recommended sequence',
      eyebrow: 'Steps',
      visible: true,
      preset: 'steps',
      align: 'left',
      background: 'muted',
      padding: 'normal',
      mediaSide: 'none',
      summary: options.stepsSummary || '',
      ctaLabel: '',
      ctaHref: '',
      blocks: options.steps.map((step) => ({ type: 'card', title: step.title, text: step.text, href: step.href || '', icon: step.icon || '', imageUrl: '' }))
    });
  }
  if (relatedLinks.length) {
    sections.push({
      id: `${slug}-related`,
      title: options.relatedTitle || 'Related capabilities',
      eyebrow: 'In the CRM',
      visible: true,
      preset: 'feature-grid',
      align: 'left',
      background: 'accent-soft',
      padding: 'normal',
      mediaSide: 'none',
      ctaLabel: '',
      ctaHref: '',
      blocks: relatedLinks.map((item) => ({
        type: 'feature-item',
        title: item.title,
        text: item.text,
        href: item.href,
        icon: item.icon || '',
        imageUrl: ''
      }))
    });
  }
  if (options.checklist?.length) {
    sections.push({
      id: `${slug}-checklist`,
      title: options.checklistTitle || 'Before you go live',
      eyebrow: 'Checklist',
      visible: true,
      preset: 'rich',
      align: 'left',
      background: 'default',
      padding: 'normal',
      mediaSide: 'none',
      ctaLabel: '',
      ctaHref: '',
      blocks: [
        { type: 'paragraph', text: options.checklistIntro || 'Use this list to avoid common setup gaps:', emphasis: 'none' },
        { type: 'list', text: options.checklist.join('\n'), emphasis: 'none' }
      ]
    });
  }
  const faq = marketingFaqSection(slug, options.faqTitle || 'Common questions', options.faq);
  if (faq) sections.push(faq);
  sections.push(marketingCtaSection(slug, options.ctaCopy || 'Create a workspace when you are ready to connect WhatsApp and run these workflows in the live CRM.', options.ctaLabel, options.ctaHref));

  return {
    id: `resource-${slug}`,
    slug,
    title,
    kind: 'resource',
    published: true,
    showInNav: false,
    navOrder: options.navOrder || 100,
    seoTitle: options.seoTitle || `${title} — WhatsApp CRM resources`,
    seoDescription: summary,
    eyebrow: 'Resource',
    summary,
    layout: 'feature',
    hero: {
      enabled: true,
      title,
      subtitle: summary,
      ctaLabel: 'Create workspace',
      ctaHref: '/signup',
      image: 'none',
      imageUrl: ''
    },
    sections
  };
}

function defaultResourcePages() {
  return [
    resourcePage(
      'getting-started',
      'Getting started',
      'Connect WhatsApp Business, verify webhooks, and invite agents before your first template send.',
      'This CRM separates public product pages from the signed-in workspace. Getting started means creating a company workspace, completing Meta embedded signup or coexistence for your Business number, confirming HTTPS webhook delivery, and keeping background workers running for campaigns and automations.',
      [
        { title: 'Shared inbox', text: 'Multi-agent chat after your number connects.', href: '/features/whatsapp-inbox', icon: 'message' },
        { title: 'WhatsApp settings', text: 'Number profile, templates, and connection health live under workspace settings.', href: '/products/whatsapp-crm', icon: 'shield' },
        { title: 'Team invites', text: 'Owners invite agents with role-aware access.', href: '/security', icon: 'products' }
      ],
      {
        navOrder: 10,
        overviewPreset: 'plain',
        stepsTitle: 'First-week setup',
        stepsSummary: 'Order may vary by Meta review status and hosting environment.',
        steps: [
          { title: 'Create a workspace', text: 'Sign up, verify email, and create your company tenant — billing and entitlements apply per plan.' },
          { title: 'Connect WhatsApp', text: 'Run embedded signup or coexistence from Settings → WhatsApp. Fix readiness blockers shown in-product before expecting live traffic.' },
          { title: 'Verify webhooks and workers', text: 'Meta must reach your HTTPS app URL. Queue workers process delayed automations and campaign jobs in production.' },
          { title: 'Import contacts and templates', text: 'Sync or upload opted-in contacts, then pull approved templates from your WABA before broadcasting.' },
          { title: 'Invite agents', text: 'Add teammates to the shared inbox with roles that match how they will operate campaigns and chat.' }
        ],
        checklistTitle: 'Production readiness',
        checklistIntro: 'These items are easy to skip but block real customer traffic:',
        checklist: [
          'Public APP_URL uses HTTPS and matches Meta webhook configuration',
          'Background worker process is running for automations and scheduled sends',
          'At least one approved template exists for outbound marketing or utility messages',
          'Suppression and opt-out handling is understood before the first broadcast'
        ],
        faq: [
          { q: 'Can I explore the product without connecting WhatsApp?', a: 'Yes. Public pages describe capabilities. Live inbox, campaigns, and automations require a connected Business number and signed-in workspace.' },
          { q: 'Does sandbox mode replace Meta setup?', a: 'No. Sandbox or demo modes may limit external delivery. Production traffic requires Meta-verified WABA configuration on your deployment.' }
        ]
      }
    ),
    resourcePage(
      'whatsapp-templates',
      'WhatsApp templates',
      'Understand Meta-approved templates, categories, and how the CRM uses them for outbound messages.',
      'WhatsApp restricts most business-initiated messages to pre-approved templates. Marketing, utility, and authentication templates each have different rules. The workspace lists templates synced from your WhatsApp Business Account and binds them to broadcasts and automation steps — it does not bypass Meta review.',
      [
        { title: 'Broadcasting', text: 'Launch campaigns from approved templates and segments.', href: '/features/whatsapp-broadcasting', icon: 'megaphone' },
        { title: 'Automation', text: 'Template sends inside journeys still require approval and category fit.', href: '/features/whatsapp-automation', icon: 'workflow' },
        { title: 'Campaign analytics', text: 'Review delivery and reply outcomes per template send.', href: '/features/whatsapp-analytics', icon: 'grid' }
      ],
      {
        navOrder: 20,
        overviewPreset: 'split-media',
        stepsTitle: 'Template workflow in the CRM',
        steps: [
          { title: 'Create or sync in Meta', text: 'Draft templates in Meta Business Manager or WhatsApp Manager; wait for approval before using them in campaigns.' },
          { title: 'Refresh in workspace', text: 'Pull the latest template library into Settings → WhatsApp so agents pick from current approved versions.' },
          { title: 'Personalize variables', text: 'Map contact fields to template placeholders at send time — invalid variables cause delivery failures.' },
          { title: 'Choose the right category', text: 'Marketing templates cannot masquerade as utility messages. Match template category to message intent.' }
        ],
        faq: [
          { q: 'Can agents send freeform marketing messages?', a: 'Not for business-initiated outreach. Customers must message you first for session messages, or you must use an approved template for outbound starts.' },
          { q: 'What happens if a template is rejected?', a: 'It will not appear as sendable in the CRM until Meta approves a revised version. Fix policy issues in Meta, then sync again.' }
        ]
      }
    ),
    resourcePage(
      'broadcasting-best-practices',
      'Broadcasting best practices',
      'Run template campaigns with opt-in discipline, suppression, and measurable follow-ups.',
      'Broadcasting at scale fails when lists are stale or templates mismatch intent. This CRM provides segments, suppression lists, delivery analytics, and retargeting tools — but it cannot override WhatsApp policy or invent consent for you.',
      [
        { title: 'Segments & suppression', text: 'Build audiences from CRM tags and respect opt-outs.', href: '/features/whatsapp-broadcasting', icon: 'megaphone' },
        { title: 'Retargeting', text: 'Follow up with cohorts that did not read or reply — within policy.', href: '/features/whatsapp-retargeting', icon: 'workflow' },
        { title: 'Shared inbox', text: 'Replies from a broadcast land in agent queues with context.', href: '/features/whatsapp-inbox', icon: 'message' }
      ],
      {
        navOrder: 30,
        overviewPreset: 'rich',
        benefitCards: undefined,
        stepsTitle: 'Operational habits',
        stepsSummary: 'Repeatable checks before every major send.',
        steps: [
          { title: 'Confirm opt-in proof', text: 'Document how contacts agreed to WhatsApp marketing for your jurisdiction and industry.' },
          { title: 'Preview template and variables', text: 'Send a test to internal numbers; verify placeholders and links.' },
          { title: 'Schedule off-peak when helpful', text: 'Use scheduling to avoid alert fatigue; monitor read rates in analytics.' },
          { title: 'Plan the reply path', text: 'Ensure agents are staffed — broadcasts without inbox capacity create backlog and poor customer experience.' },
          { title: 'Retarget deliberately', text: 'Use analytics to follow up non-openers with a different approved template, not duplicate spam.' }
        ],
        faq: [
          { q: 'Should I re-upload CSVs for every follow-up?', a: 'No. Build retarget audiences from campaign results inside analytics when the cohort is defined by delivery or read outcomes.' },
          { q: 'Does MM Lite change best practices?', a: 'Marketing Messages (MM Lite) may change delivery optimization for eligible accounts. Availability is Meta-gated; core opt-in and template rules still apply.' }
        ]
      }
    ),
    {
      id: 'resource-faq',
      slug: 'faq',
      title: 'FAQ',
      kind: 'resource',
      published: true,
      showInNav: false,
      navOrder: 40,
      seoTitle: 'WhatsApp CRM FAQ',
      seoDescription: 'Answers about workspace setup, messaging policy, and what the product includes today.',
      eyebrow: 'FAQ',
      summary: 'Straight answers about setup, messaging rules, and workspace boundaries.',
      layout: 'default',
      hero: {
        enabled: true,
        title: 'Frequently asked questions',
        subtitle: 'What this CRM does, what Meta still owns, and where to find policy pages.',
        ctaLabel: 'Create workspace',
        ctaHref: '/signup',
        image: 'none',
        imageUrl: ''
      },
      sections: [
        {
          id: 'resource-faq-body',
          title: 'Product and setup',
          eyebrow: 'FAQ',
          visible: true,
          preset: 'faq',
          align: 'left',
          background: 'muted',
          padding: 'normal',
          mediaSide: 'none',
          ctaLabel: '',
          ctaHref: '',
          blocks: [
            { type: 'faq-item', title: 'Is this a WhatsApp client on my phone?', text: 'No. It is a team workspace connected to the WhatsApp Business Platform (Cloud API). Agents use the web inbox, not personal WhatsApp apps, for customer threads.', emphasis: 'none' },
            { type: 'faq-item', title: 'Do I need my own Meta Business assets?', text: 'Yes for production. You connect a WhatsApp Business Account and phone number through Meta flows supported in workspace settings.', emphasis: 'none' },
            { type: 'faq-item', title: 'Can I edit these public pages?', text: 'Super Admin CMS controls navigation, product pages, and many marketing sections without redeploying code.', emphasis: 'none' },
            { type: 'faq-item', title: 'Where are privacy and terms?', text: 'Published at /privacy-policy and /terms on this site. Security practices for operators are summarized on /security.', emphasis: 'none' },
            { type: 'faq-item', title: 'What integrations ship today?', text: 'See /integrations for Shopify, WooCommerce webhooks, HubSpot, Salesforce, and signed automation webhooks — each requires workspace setup and feature flags.', emphasis: 'none' },
            { type: 'faq-item', title: 'Does the CRM guarantee message delivery?', text: 'No. Delivery depends on Meta, recipient devices, template approval, and list quality. The workspace surfaces delivery and failure signals; it does not control the WhatsApp network.', emphasis: 'none' }
          ]
        },
        marketingCtaSection('resource-faq', 'Still evaluating? Browse products, then create a workspace when you are ready to connect WhatsApp.')
      ]
    }
  ];
}

function resourcesIndexPage() {
  const guides = defaultResourcePages();
  return {
    id: 'page-resources-index',
    slug: 'resources',
    title: 'Resources',
    kind: 'page',
    published: true,
    showInNav: false,
    navOrder: 28,
    seoTitle: 'WhatsApp CRM resources',
    seoDescription: 'Guides for setup, templates, broadcasting, and common product questions.',
    eyebrow: 'Resources',
    summary: 'Operator guides for setup, templates, and compliant broadcasting — linked to live product capabilities.',
    layout: 'default',
    hero: {
      enabled: true,
      title: 'Guides for running WhatsApp as a team channel',
      subtitle: 'Start with connection and templates, then scale broadcasts with policy-aware habits. No inflated stats — just how the workspace works today.',
      ctaLabel: 'Getting started',
      ctaHref: '/resources/getting-started',
      image: 'none',
      imageUrl: ''
    },
    sections: [
      {
        id: 'resources-grid',
        title: 'Choose a guide',
        eyebrow: 'Library',
        visible: true,
        preset: 'cards',
        align: 'left',
        background: 'default',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: guides.map((page) => ({
          type: 'card',
          title: page.title,
          text: page.summary,
          href: `/resources/${page.slug}`,
          icon: 'form',
          imageUrl: ''
        }))
      },
      {
        id: 'resources-more',
        title: 'Explore product depth',
        eyebrow: 'Next steps',
        visible: true,
        preset: 'feature-grid',
        align: 'left',
        background: 'muted',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: 'All features',
        ctaHref: '/features',
        blocks: [
          { type: 'feature-item', title: 'Products', text: 'CRM, broadcasting, automation, and ads suites.', href: '/products', icon: 'products', imageUrl: '' },
          { type: 'feature-item', title: 'Solutions', text: 'Use-case maps for support, sales, and marketing.', href: '/solutions', icon: 'workflow', imageUrl: '' },
          { type: 'feature-item', title: 'How it works', text: 'Public marketing site vs signed-in workspace.', href: '/how-it-works', icon: 'grid', imageUrl: '' }
        ]
      }
    ]
  };
}

function howItWorksPage() {
  return {
    id: 'page-how-it-works',
    slug: 'how-it-works',
    title: 'How it works',
    kind: 'page',
    published: true,
    showInNav: false,
    navOrder: 45,
    seoTitle: 'How the WhatsApp CRM works',
    seoDescription: 'Honest overview of public product pages, tenant workspaces, Meta WhatsApp connection, and operator workflows.',
    eyebrow: 'Product',
    summary: 'A single platform: editable public pages for discovery, isolated workspaces for live WhatsApp operations.',
    layout: 'landing',
    hero: {
      enabled: true,
      title: 'Public discovery, private operations',
      subtitle: 'Visitors browse products and guides without signing in. Your team runs inbox, campaigns, automations, and integrations inside a company workspace after WhatsApp is connected.',
      ctaLabel: 'Browse products',
      ctaHref: '/products',
      image: 'hero',
      imageUrl: ''
    },
    sections: [
      {
        id: 'how-layers',
        title: 'Two layers, one product story',
        eyebrow: 'Architecture',
        visible: true,
        preset: 'columns',
        align: 'left',
        background: 'default',
        padding: 'spacious',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'paragraph', text: 'The marketing site (home, products, features, solutions, resources) is CMS-driven. Super Admin publishes pages and navigation so prospects understand what ships today.', emphasis: 'none' },
          { type: 'paragraph', text: 'The workspace at /app is tenant-scoped CRM software: contacts, shared inbox, templates, campaigns, automations, ads, commerce tools, and settings. Data is isolated per company with role-based access.', emphasis: 'none' },
          { type: 'paragraph', text: 'Meta still owns WhatsApp delivery, template approval, and many eligibility rules. The CRM exposes readiness, blockers, and operational controls — not a bypass of Meta policy.', emphasis: 'none' }
        ]
      },
      {
        id: 'how-flow',
        title: 'Typical operator journey',
        eyebrow: 'Workflow',
        visible: true,
        preset: 'steps',
        align: 'left',
        background: 'muted',
        padding: 'normal',
        mediaSide: 'none',
        summary: 'From evaluation to first compliant broadcast.',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'card', title: 'Discover on the public site', text: 'Read product and feature pages, resources, and integrations list before creating an account.', href: '/resources', icon: '', imageUrl: '' },
          { type: 'card', title: 'Create a workspace', text: 'Sign up, verify email, and configure billing entitlements for your team size.', href: '/signup', icon: '', imageUrl: '' },
          { type: 'card', title: 'Connect WhatsApp Business', text: 'Complete Meta signup flows, verify webhooks on your HTTPS deployment, and sync templates.', href: '/resources/getting-started', icon: '', imageUrl: '' },
          { type: 'card', title: 'Operate daily', text: 'Agents use inbox and templates; marketers run broadcasts; builders wire automations and optional connectors.', href: '/features/whatsapp-inbox', icon: '', imageUrl: '' }
        ]
      },
      {
        id: 'how-governance',
        title: 'Governance and trust pages',
        eyebrow: 'Policies',
        visible: true,
        preset: 'cards',
        align: 'left',
        background: 'accent-soft',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'card', title: 'Security overview', text: 'Role-aware access, session controls, and operator security settings.', href: '/security', icon: 'shield', imageUrl: '' },
          { type: 'card', title: 'Privacy policy', text: 'How customer and workspace data is handled — published on this site.', href: '/privacy-policy', icon: 'form', imageUrl: '' },
          { type: 'card', title: 'Terms of use', text: 'Legal terms for using the platform.', href: '/terms', icon: 'form', imageUrl: '' }
        ]
      },
      marketingCtaSection('how-it-works', 'Ready to connect WhatsApp? Create a workspace and follow the getting started guide.', 'Create workspace', '/signup')
    ]
  };
}

function solutionsIndexPage() {
  const solutions = defaultSolutionPages();
  return {
    id: 'page-solutions-index',
    slug: 'solutions',
    title: 'Solutions',
    kind: 'page',
    published: true,
    showInNav: false,
    navOrder: 25,
    seoTitle: 'WhatsApp CRM solutions',
    seoDescription: 'Use-case guides for support, sales, e-commerce care, and marketing on WhatsApp.',
    eyebrow: 'Solutions',
    summary: 'See how teams apply inbox, broadcasts, automation, and integrations to real jobs-to-be-done.',
    layout: 'default',
    hero: {
      enabled: true,
      title: 'WhatsApp for the work you already do',
      subtitle: 'Support queues, pipeline follow-up, order questions, and template campaigns — mapped to capabilities that ship in this CRM.',
      ctaLabel: 'Browse products',
      ctaHref: '/products',
      image: 'none',
      imageUrl: ''
    },
    sections: [
      {
        id: 'solutions-grid',
        title: 'Choose a starting scenario',
        eyebrow: 'Use cases',
        visible: true,
        preset: 'cards',
        align: 'left',
        background: 'default',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: solutions.map((page) => ({
          type: 'card',
          title: page.title,
          text: page.summary,
          href: `/solutions/${page.slug}`,
          icon: 'workflow',
          imageUrl: ''
        }))
      },
      {
        id: 'solutions-capabilities',
        title: 'Built from the same product modules',
        eyebrow: 'Capabilities',
        visible: true,
        preset: 'feature-grid',
        align: 'left',
        background: 'muted',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: 'Feature library',
        ctaHref: '/features',
        blocks: [
          { type: 'feature-item', title: 'Shared inbox', text: 'Multi-agent chat on one Business number.', href: '/features/whatsapp-inbox', icon: 'message', imageUrl: '' },
          { type: 'feature-item', title: 'Broadcasting', text: 'Template campaigns with operational controls.', href: '/features/whatsapp-broadcasting', icon: 'megaphone', imageUrl: '' },
          { type: 'feature-item', title: 'Automation', text: 'Event-driven journeys with human handoff.', href: '/features/whatsapp-automation', icon: 'workflow', imageUrl: '' },
          { type: 'feature-item', title: 'Integrations', text: 'Commerce and CRM connectors the marketplace supports today.', href: '/integrations', icon: 'integrations', imageUrl: '' }
        ]
      }
    ]
  };
}

function defaultDocument() {
  const products = defaultProducts();
  const productPages = products.filter((product) => product.visible !== false).map((product) => buildProductMarketingPage(product));
  const pages = [
      {
        id: 'page-home',
        slug: '',
        title: 'Home',
        kind: 'home',
        published: true,
        showInNav: false,
        navOrder: 0,
        seoTitle: '',
        seoDescription: '',
        eyebrow: 'WhatsApp Business Platform',
        summary: 'Broadcast, automate, and support customers on WhatsApp with an official Business API workspace.',
        layout: 'landing',
        hero: {
          enabled: true,
          title: 'Broadcast, automate, and support on WhatsApp',
          subtitle: 'A production WhatsApp CRM for shared inbox, template campaigns, automation, CTWA ads, commerce, and analytics — with Super Admin controlled product pages.',
          ctaLabel: 'Create workspace',
          ctaHref: '/signup',
          image: 'hero',
          imageUrl: ''
        },
        sections: [
          {
            id: 'capabilities',
            title: 'Everything your team needs on WhatsApp',
            eyebrow: 'Capabilities',
            visible: true,
            preset: 'feature-grid',
            align: 'left',
            background: 'default',
            padding: 'normal',
            mediaSide: 'none',
            ctaLabel: 'View all products',
            ctaHref: '/products',
            blocks: [
              { type: 'feature-item', title: 'Broadcasting', text: 'Send approved template campaigns to opted-in audiences with delivery insights.', href: '/features/whatsapp-broadcasting', icon: 'megaphone', imageUrl: '' },
              { type: 'feature-item', title: 'Automation Builder', text: 'Build guided journeys that qualify leads and answer common questions.', href: '/features/whatsapp-automation', icon: 'workflow', imageUrl: '' },
              { type: 'feature-item', title: 'Shared Inbox', text: 'Multi-agent live chat with assignment, notes, and templates.', href: '/features/whatsapp-inbox', icon: 'message', imageUrl: '' },
              { type: 'feature-item', title: 'CTWA Ads', text: 'Run Click-to-WhatsApp ads and measure conversation entry.', href: '/features/whatsapp-ads', icon: 'megaphone', imageUrl: '' },
              { type: 'feature-item', title: 'AI agents', text: 'Assist agents with suggested replies and structured handoff into live chat.', href: '/features/whatsapp-ai-agents', icon: 'spark', imageUrl: '' },
              { type: 'feature-item', title: 'Commerce', text: 'Catalog and payment-oriented workflows beside your inbox.', href: '/features/whatsapp-commerce', icon: 'cart', imageUrl: '' }
            ]
          },
          {
            id: 'trust',
            title: 'Built for operators who need control',
            eyebrow: 'Platform',
            visible: true,
            preset: 'cards',
            align: 'left',
            background: 'muted',
            padding: 'normal',
            mediaSide: 'none',
            ctaLabel: '',
            ctaHref: '',
            blocks: [
              { type: 'card', title: 'Workspace CRM', text: 'Contacts, tags, assignments, and conversation history in one place.', href: '/features', icon: '', imageUrl: '' },
              { type: 'card', title: 'Security & compliance', text: 'Role-aware access, auditability, and policy pages you can publish from Super Admin.', href: '/security', icon: '', imageUrl: '' },
              { type: 'card', title: 'Integrations', text: 'Connect the tools your revenue team already runs.', href: '/integrations', icon: '', imageUrl: '' }
            ]
          },
          {
            id: 'product-discovery',
            title: 'Product suites for every growth motion',
            eyebrow: 'Discover',
            summary: 'Browse CRM, broadcasting, automation, and ads & commerce as publishable product lines — each with deep feature pages.',
            visible: true,
            preset: 'product-showcase',
            align: 'left',
            background: 'muted',
            padding: 'normal',
            mediaSide: 'none',
            ctaLabel: 'Full product catalog',
            ctaHref: '/products',
            blocks: []
          }
        ]
      },
      ...productPages,
      featurePage('whatsapp-calling', 'WhatsApp Calling', 'Connect voice conversations with your WhatsApp CRM timeline.', 'Place and manage calling workflows alongside chat history so teams never lose context.', [
        'Open calling tools from the same workspace as inbox and contacts',
        'Keep conversation context visible before and after calls',
        'Use calling where Meta eligibility and number setup allow'
      ], ['Support follow-ups', 'Sales qualification', 'Appointment confirmation'], {
        includeHowItWorks: false,
        faqTitle: 'Calling availability',
        faq: [
          { q: 'Is WhatsApp Calling available on every account?', a: 'No. Voice calling depends on Meta eligibility, number type, and regional support. The workspace exposes calling tools when your setup allows — not as a guaranteed day-one feature.' },
          { q: 'Does calling replace the shared inbox?', a: 'No. Calling adds voice context to the same customer timeline as chat. Agents still manage live conversations primarily through the 1:1 inbox.' }
        ],
        relatedProductHref: '/products/whatsapp-crm',
        relatedProductText: 'Calling sits alongside shared inbox and AI assist in the WhatsApp CRM product line.'
      }),
      featurePage('whatsapp-broadcasting', 'WhatsApp Broadcasting', 'Launch approved template campaigns at scale.', 'Import audiences, choose Meta-approved templates, personalize variables, schedule or send, then track delivery without leaving the workspace.', [
        'Create campaigns from contacts or saved segments',
        'Use only WhatsApp-approved templates for outbound marketing',
        'Monitor sent, delivered, read, failed, and reply signals',
        'Retarget non-openers or non-repliers from campaign results'
      ], ['Promotions and offers', 'Utility reminders', 'Re-engagement blasts'], {
        overviewPreset: 'rich',
        problem: {
          title: 'Ad-hoc WhatsApp blasts create compliance risk',
          blocks: [
            { type: 'paragraph', text: 'Copy-pasting promotional text or reusing unapproved templates can trigger Meta blocks and erode customer trust — especially when opt-outs are not enforced centrally.', emphasis: 'none' },
            { type: 'paragraph', text: 'Broadcasting in this CRM ties every send to synced templates, audience filters, and delivery telemetry so operators know what went out and what failed.', emphasis: 'none' }
          ]
        },
        benefitCards: [
          { title: 'Template discipline', text: 'Outbound sends stay tied to approved templates and audience controls — not ad-hoc freeform blasts.' },
          { title: 'Operational visibility', text: 'See delivery health per campaign and drill into failures without exporting spreadsheets.' },
          { title: 'Follow-up loops', text: 'Retarget from analytics when a cohort did not read or reply — still within opt-in and template rules.' }
        ],
        howTitle: 'Send a compliant campaign',
        howSummary: 'Audience → template → send → learn — without leaving the workspace.',
        howSteps: [
          { type: 'card', title: 'Select audience', text: 'Choose contacts or segments and apply suppression for opt-outs before you compose.', href: '/signup', icon: '', imageUrl: '' },
          { type: 'card', title: 'Pick a synced template', text: 'Use a Meta-approved template that matches your message category and fill variables.', href: '/signup', icon: '', imageUrl: '' },
          { type: 'card', title: 'Review outcomes', text: 'Track delivery, reads, and replies, then retarget from analytics when appropriate.', href: '/features/whatsapp-analytics', icon: '', imageUrl: '' }
        ],
        faq: [
          { q: 'Can I message contacts who never opted in?', a: 'You should not. The CRM helps enforce suppression and consent signals, but list quality and opt-in proof remain your responsibility under WhatsApp policy.' },
          { q: 'Do utility and marketing templates behave the same?', a: 'No. Category and consent expectations differ. Choose the template type that matches the message and audience before you send.' }
        ],
        relatedFeatures: [
          { title: 'Campaign analytics', text: 'Delivery and read metrics per send.', href: '/features/whatsapp-analytics', icon: 'grid' },
          { title: 'Retargeting', text: 'Follow-up cohorts from campaign results.', href: '/features/whatsapp-retargeting', icon: 'workflow' },
          { title: 'Shared inbox', text: 'Handle replies on the same Business number.', href: '/features/whatsapp-inbox', icon: 'message' }
        ],
        relatedProductHref: '/products/broadcasting'
      }),
      featurePage('whatsapp-chatbots', 'WhatsApp Chatbots', 'Automate the first mile of every conversation.', 'Design guided flows that capture intent, qualify leads, and hand off to humans cleanly when the conversation needs a person.', [
        'Build multi-step conversation flows without custom code',
        'Route customers based on replies and tags',
        'Hand off to shared inbox with context preserved'
      ], ['Lead qualification', 'FAQ deflection', 'After-hours coverage'], {
        includeHowItWorks: false,
        capabilityGrid: [
          { title: 'Guided replies', text: 'Branch on customer answers instead of forcing a single static script.', icon: 'bot', href: '' },
          { title: 'Tags and routing', text: 'Apply tags or route to queues before a human ever opens the thread.', icon: 'workflow', href: '' },
          { title: 'Inbox handoff', text: 'Escalate with transcript context so agents pick up where the bot stopped.', icon: 'message', href: '/features/whatsapp-inbox' }
        ],
        relatedProductHref: '/products/automation-platform'
      }),
      featurePage('whatsapp-ai-agents', 'WhatsApp AI Agents', 'Assist your team with AI where it helps most.', 'Configure knowledge-aware assistants that draft replies, answer routine questions, and escalate to humans with clear handoff rules.', [
        'Ground answers in your business knowledge and policies',
        'Keep humans in control with escalation and review',
        'Use AI alongside automation and live chat — not instead of your team'
      ], ['24/7 FAQ answers', 'Sales assist', 'Support triage'], {
        overviewPreset: 'plain',
        faqTitle: 'AI boundaries',
        faq: [
          { q: 'Does AI replace human agents?', a: 'No. Assistants draft and answer routine questions; your team sets escalation rules and reviews sensitive replies.' },
          { q: 'What safety tooling exists?', a: 'The workspace logs safety events, applies caps, and supports lightweight reply sampling — not a full third-party model evaluation suite.' }
        ],
        relatedProductHref: '/products/whatsapp-crm'
      }),
      featurePage('whatsapp-automation', 'WhatsApp Automation', 'Trigger the right message at the right moment.', 'Connect events, tags, and journeys so follow-ups happen without manual chasing while staying within WhatsApp messaging rules.', [
        'Visual automation builder for event-driven journeys',
        'Trigger from tags, campaign outcomes, and conversation signals',
        'Combine templates, delays, and branching logic'
      ], ['Abandoned cart follow-ups', 'Onboarding sequences', 'Renewal reminders'], {
        problem: {
          title: 'Repeating the same follow-ups by hand',
          blocks: [
            { type: 'paragraph', text: 'Agents re-send reminders, forget tag conditions, and miss delayed steps when volume spikes — while marketing and support use different tools for the same customer.', emphasis: 'none' },
            { type: 'paragraph', text: 'The automation canvas centralizes triggers, branches, template sends, and inbox handoff so journeys stay consistent and auditable.', emphasis: 'none' }
          ]
        },
        howTitle: 'Automation canvas workflow',
        howSummary: 'Design on a visual canvas, activate when ready, and let the worker handle delayed steps.',
        howSteps: [
          { type: 'card', title: 'Pick a trigger', text: 'Start from tags, inbound messages, campaign outcomes, or integration events where enabled.', href: '/signup', icon: '', imageUrl: '' },
          { type: 'card', title: 'Wire branches', text: 'Add conditions, delays, template sends, and handoff nodes with auto-layout in the builder.', href: '/signup', icon: '', imageUrl: '' },
          { type: 'card', title: 'Run with the worker', text: 'Delayed and template actions enqueue jobs — keep the queue worker running in production.', href: '/signup', icon: '', imageUrl: '' }
        ],
        faqTitle: 'Automation boundaries',
        faq: [
          { q: 'Do delayed steps run without a worker?', a: 'No. Template sends and timed branches enqueue background jobs. Production deployments should run the queue worker continuously.' },
          { q: 'Can automations bypass template approval?', a: 'No. Marketing and many utility outbound paths still require approved templates and valid audience consent.' }
        ],
        relatedFeatures: [
          { title: 'Chatbots', text: 'Guided reply flows before automation handoff.', href: '/features/whatsapp-chatbots', icon: 'bot' },
          { title: 'Flows & Forms', text: 'Structured capture inside WhatsApp.', href: '/features/whatsapp-flows', icon: 'form' },
          { title: 'Shared inbox', text: 'Where escalated conversations land.', href: '/features/whatsapp-inbox', icon: 'message' }
        ],
        relatedProductHref: '/products/automation-platform'
      }),
      featurePage('whatsapp-retargeting', 'WhatsApp Retargeting', 'Re-engage the right audiences with intent-based follow-ups.', 'Use campaign and conversation signals to bring customers back into productive WhatsApp threads.', [
        'Filter audiences by delivery, read, click, and reply outcomes',
        'Launch follow-up broadcasts from analytics without re-uploading lists',
        'Keep messaging compliant with opt-out and suppression controls'
      ], ['Non-opener nudges', 'Clicked-but-not-converted', 'Win-back campaigns'], {
        includeHowItWorks: false,
        middleSection: {
          id: 'whatsapp-retargeting-signals',
          title: 'Signals you can act on',
          eyebrow: 'Capabilities',
          visible: true,
          preset: 'feature-grid',
          align: 'left',
          background: 'muted',
          padding: 'normal',
          mediaSide: 'none',
          ctaLabel: 'Open analytics',
          ctaHref: '/features/whatsapp-analytics',
          blocks: [
            { type: 'feature-item', title: 'Delivery outcomes', text: 'Filter audiences that did not receive or failed delivery.', href: '', icon: 'grid', imageUrl: '' },
            { type: 'feature-item', title: 'Read and reply', text: 'Follow up with readers who never replied or clickers who stalled.', href: '', icon: 'workflow', imageUrl: '' },
            { type: 'feature-item', title: 'Suppression aware', text: 'Respect opt-outs when building the next send.', href: '', icon: 'shield', imageUrl: '' }
          ]
        },
        relatedProductHref: '/products/broadcasting'
      }),
      featurePage('whatsapp-flows', 'WhatsApp Flows & Forms', 'Collect structured data inside WhatsApp.', 'Use Meta-hosted flows and forms for lead capture, feedback, bookings, and operational intakes without forcing customers off-chat.', [
        'Create native WhatsApp Flows for structured capture',
        'Collect leads and appointments inside the thread',
        'Pass submissions into CRM contacts and automations'
      ], ['Lead forms', 'Appointment booking', 'Feedback collection'], {
        faq: [
          { q: 'Are Flows hosted inside this CRM?', a: 'WhatsApp Flows are Meta-hosted experiences launched from chat. You design and publish Flow assets, then map submissions into CRM contacts and automations.' },
          { q: 'What is required before go-live?', a: 'A connected WABA, at least one published Flow, HTTPS webhook delivery, and a running worker for downstream automation — same live verification bar as other Meta messaging features.' }
        ],
        relatedProductHref: '/products/automation-platform'
      }),
      featurePage('whatsapp-ads', 'Click-to-WhatsApp Ads', 'Run ads that open WhatsApp conversations.', 'Connect Facebook Login, link Page and ad account assets, create paused CTWA campaigns, and measure WhatsApp entry conversations from the Ads workspace.', [
        'Connect Meta ads assets from the CRM Ads workspace',
        'Create Click-to-WhatsApp campaigns tied to your business number',
        'Track referral conversations and readiness blockers in-product',
        'Requires eligible Meta ad account, Page, and WhatsApp number linkage'
      ], ['Lead generation ads', 'Instagram/Facebook to WhatsApp', 'Campaign experiments'], {
        howTitle: 'Ads workspace setup',
        howSteps: [
          { type: 'card', title: 'Connect Meta assets', text: 'Use Facebook Login to link ad account, Page, and WhatsApp number with visible readiness blockers.', href: '/signup', icon: '', imageUrl: '' },
          { type: 'card', title: 'Create paused CTWA campaigns', text: 'Draft Click-to-WhatsApp campaigns inside the CRM before spending budget in Ads Manager.', href: '/signup', icon: '', imageUrl: '' },
          { type: 'card', title: 'Measure entry conversations', text: 'Track referral conversations that land in your inbox — not a full Ads Manager billing console.', href: '/features/whatsapp-inbox', icon: '', imageUrl: '' }
        ],
        faq: [
          { q: 'Does this replace Meta Ads Manager?', a: 'No. You still manage billing and advanced ad controls in Meta. This CRM focuses on CTWA creation, asset linkage, and conversation entry measurement.' }
        ],
        relatedProductHref: '/products/ads-commerce'
      }),
      featurePage('whatsapp-commerce', 'Commerce & Payments', 'Sell and collect inside WhatsApp workflows.', 'Manage catalogs, commerce operations, and payment-oriented journeys from the Commerce workspace while respecting Meta commerce eligibility.', [
        'Operate commerce tooling beside inbox and campaigns',
        'Support catalog and payment workflows where enabled for the account',
        'Keep order and support conversations in one customer timeline'
      ], ['Product discovery', 'Payment reminders', 'Order support'], {
        includeHowItWorks: false,
        benefitCards: [
          { title: 'Catalog operations', text: 'Manage catalog-oriented workflows from the Commerce workspace when Meta commerce features are enabled.' },
          { title: 'Same inbox for support', text: 'Order questions stay on the customer timeline beside campaigns and automations.' },
          { title: 'Connector-aware', text: 'Shopify and WooCommerce events can feed automations when integration flags are on — not every storefront connects on day one.' }
        ],
        faq: [
          { q: 'Is WhatsApp Pay available everywhere?', a: 'Payment and checkout experiences depend on Meta regional support and account eligibility. Plan for catalog and support workflows even when in-chat payments are limited.' }
        ],
        relatedProductHref: '/products/ads-commerce'
      }),
      featurePage('whatsapp-analytics', 'Campaign Analytics', 'Know what worked — and who to message next.', 'Review campaign performance, delivery health, and retargeting opportunities from a dedicated analytics workspace.', [
        'Track delivery, reads, replies, and failures per campaign',
        'Open campaign-level detail without leaving the CRM',
        'Launch retargeting actions from the same results view'
      ], ['Broadcast ROI reviews', 'Agent coaching signals', 'Audience cleanup'], {
        includeHowItWorks: false,
        middleSection: {
          id: 'whatsapp-analytics-views',
          title: 'What you can review per campaign',
          eyebrow: 'Views',
          visible: true,
          preset: 'cards',
          align: 'left',
          background: 'muted',
          padding: 'normal',
          mediaSide: 'none',
          ctaLabel: 'See retargeting',
          ctaHref: '/features/whatsapp-retargeting',
          blocks: [
            { type: 'card', title: 'Delivery health', text: 'Sent, delivered, read, failed, and reply counts without exporting raw logs.', href: '', icon: '', imageUrl: '' },
            { type: 'card', title: 'Actionable cohorts', text: 'Identify non-openers or non-repliers to inform the next compliant send.', href: '/features/whatsapp-retargeting', icon: '', imageUrl: '' },
            { type: 'card', title: 'In-workspace drill-down', text: 'Open campaign detail from the same analytics area you use to launch follow-ups.', href: '', icon: '', imageUrl: '' }
          ]
        },
        relatedProductHref: '/products/broadcasting'
      }),
      featurePage('whatsapp-inbox', 'Shared Inbox', 'Run multi-agent live chat on one WhatsApp number.', 'Assign conversations, collaborate with notes, and respond with templates while keeping a full customer history.', [
        'Shared team inbox with conversation assignment',
        'Templates, notes, and contact context in one pane',
        'Suppression and opt-out awareness for outbound messaging'
      ], ['Customer support', 'Sales follow-up', 'VIP account care'], {
        problem: {
          title: 'One Business number, many agents',
          blocks: [
            { type: 'paragraph', text: 'Without assignment and shared history, customers get duplicate answers, agents overwrite each other on WhatsApp Web, and managers cannot see queue health.', emphasis: 'none' },
            { type: 'paragraph', text: 'The shared inbox gives every agent the same conversation timeline with templates, notes, tags, and contact context on your official Business number.', emphasis: 'none' }
          ]
        },
        benefitCards: [
          { title: 'Team coordination', text: 'Assignment, notes, and templates keep multiple agents on one Business number without stepping on each other.' },
          { title: 'Contact 360', text: 'Profile, consent, tags, and recent activity for the open conversation — CRM-stored context, not every undocumented Meta signal.' },
          { title: '1:1-first design', text: 'The shared inbox focuses on customer threads; WhatsApp Groups use a separate module when Meta eligibility allows.' }
        ],
        howTitle: 'Day-to-day inbox workflow',
        howSummary: 'Connect WhatsApp once, then route every live thread through assignment and templates.',
        howSteps: [
          { type: 'card', title: 'Connect your number', text: 'Complete Meta WhatsApp Business setup and verify webhooks on your workspace URL.', href: '/signup', icon: '', imageUrl: '' },
          { type: 'card', title: 'Triage and assign', text: 'Open the inbox, claim or assign conversations, and add internal notes for the next agent.', href: '/signup', icon: '', imageUrl: '' },
          { type: 'card', title: 'Reply with templates', text: 'Use synced templates where session rules allow, and respect suppression before any outbound send.', href: '/signup', icon: '', imageUrl: '' }
        ],
        faq: [
          { q: 'Does the inbox include WhatsApp Groups?', a: 'Groups are supported in a dedicated Groups module when the feature flag and Meta eligibility allow. The main inbox remains 1:1-first for CRM contacts.' },
          { q: 'Can agents see campaign history for a contact?', a: 'Contact timelines include CRM-stored conversation and campaign activity your workspace records — not every Meta Ads or off-platform signal.' }
        ],
        relatedFeatures: [
          { title: 'AI agents', text: 'Draft replies with human escalation rules.', href: '/features/whatsapp-ai-agents', icon: 'spark' },
          { title: 'WhatsApp Calling', text: 'Voice context on the same timeline when enabled.', href: '/features/whatsapp-calling', icon: 'phone' },
          { title: 'Broadcasting', text: 'Template sends with replies returning to inbox.', href: '/features/whatsapp-broadcasting', icon: 'megaphone' }
        ],
        relatedProductHref: '/products/whatsapp-crm'
      }),
      contentPage('security', 'security', 'Security & compliance', 'Security', 'Controls, auditability, and policy pages for operator-grade WhatsApp workspaces.', 'Role-aware access, session controls, and publishable legal/policy content help teams run WhatsApp professionally.'),
      integrationsPage(),
      solutionsIndexPage(),
      ...defaultSolutionPages(),
      resourcesIndexPage(),
      ...defaultResourcePages(),
      howItWorksPage(),
      {
        id: 'page-about',
        slug: 'about',
        title: 'About Us',
        kind: 'about',
        published: true,
        showInNav: true,
        navOrder: 40,
        seoTitle: 'About MathStrat — WhatsApp Business CRM',
        seoDescription: 'Why MathStrat builds WhatsApp CRM for revenue and support teams: focused feature workspaces, honest Meta integration, and Super Admin–governed product storytelling.',
        eyebrow: 'About MathStrat',
        summary: 'MathStrat builds WhatsApp CRM for teams that need reliable messaging operations — focused workspaces, clear entitlements, and an editable public product site.',
        layout: 'landing',
        hero: {
          enabled: true,
          title: 'WhatsApp CRM built for operators, not slide decks',
          subtitle: 'MathStrat helps teams run shared inbox, approved broadcasts, automation, Click-to-WhatsApp ads entry, calling context, and commerce workflows from one governed workspace — with a public website you can edit without shipping code.',
          ctaLabel: 'Explore products',
          ctaHref: '/products',
          image: 'hero',
          imageUrl: ''
        },
        sections: [
          {
            id: 'about-intro',
            title: 'What MathStrat is building',
            eyebrow: 'Company introduction',
            visible: true,
            preset: 'split-media',
            align: 'left',
            background: 'default',
            padding: 'spacious',
            mediaSide: 'right',
            ctaLabel: 'Browse features',
            ctaHref: '/features',
            blocks: [
              { type: 'paragraph', text: 'Customers already talk on WhatsApp. Revenue, support, and operations teams need software that treats that channel as production infrastructure: assignment, templates, automation with human handoff, ads-to-chat attribution, and analytics that stay inside the same tenant.', emphasis: 'none' },
              { type: 'paragraph', text: 'MathStrat is a WhatsApp Business CRM SaaS: each company gets an isolated workspace, role-aware tools, and public product pages that explain capabilities before anyone signs up. Live messaging still depends on Meta WhatsApp Business assets you connect and maintain.', emphasis: 'none' },
              { type: 'image', asset: 'hero', href: '', alt: 'WhatsApp CRM workspace', text: 'Workspace preview', width: 'wide' }
            ]
          },
          {
            id: 'about-problem',
            title: 'The problems we aim to solve',
            eyebrow: 'Why this exists',
            visible: true,
            preset: 'cards',
            align: 'left',
            background: 'muted',
            padding: 'normal',
            mediaSide: 'none',
            ctaLabel: '',
            ctaHref: '',
            blocks: [
              { type: 'card', title: 'Scattered tools', text: 'Inbox in one place, broadcasts in another, ads reporting somewhere else — and no shared customer timeline.', href: '/products/whatsapp-crm', icon: 'message', imageUrl: '' },
              { type: 'card', title: 'Generic dashboards', text: 'Selecting a feature should open that feature’s workspace — not a wall of unrelated modules.', href: '/features/whatsapp-ads', icon: 'megaphone', imageUrl: '' },
              { type: 'card', title: 'Unclear entitlements', text: 'Teams need honest labels when Meta permissions, plan limits, or setup blockers prevent an action.', href: '/security', icon: 'shield', imageUrl: '' },
              { type: 'card', title: 'Hard-to-edit websites', text: 'Product marketing should be Super Admin editable — navigation, footer, About, and pricing disclosures included.', href: '/contact', icon: 'form', imageUrl: '' }
            ]
          },
          {
            id: 'about-mission',
            title: 'Mission, vision, and product philosophy',
            eyebrow: 'Principles',
            visible: true,
            preset: 'rich',
            align: 'left',
            background: 'default',
            padding: 'normal',
            mediaSide: 'none',
            ctaLabel: '',
            ctaHref: '',
            blocks: [
              { type: 'paragraph', text: 'Mission: give business teams a trustworthy WhatsApp operating system — from first inbound chat to measured campaigns — without pretending Meta’s platform rules do not apply.', emphasis: 'none' },
              { type: 'paragraph', text: 'Vision: every MathStrat feature opens a focused workspace with clear setup, permissions, and outcomes, while the public site remains a accurate map of what the product can do today.', emphasis: 'none' },
              { type: 'list', text: 'Clarity over claims — ship what works; label what is gated\nWorkflows first — organize around daily operator jobs\nTenant isolation by default — company data stays scoped\nEditable storytelling — Super Admin owns the public narrative\nFeature isolation — CTWA, Calling, Inbox, and Automation own their main content', emphasis: 'none' }
            ]
          },
          {
            id: 'about-approach',
            title: 'How we approach business communication',
            eyebrow: 'Approach',
            visible: true,
            preset: 'steps',
            align: 'left',
            background: 'muted',
            padding: 'normal',
            mediaSide: 'none',
            summary: 'A practical path from discovery to measurable operations.',
            ctaLabel: '',
            ctaHref: '',
            blocks: [
              { type: 'card', title: 'Discover on the website', text: 'Products, features, integrations, and solutions explain capabilities before authentication.', href: '/products', icon: '', imageUrl: '' },
              { type: 'card', title: 'Connect WhatsApp properly', text: 'Embedded signup or coexistence for your Business number — with connection health operators can verify.', href: '/features/whatsapp-inbox', icon: '', imageUrl: '' },
              { type: 'card', title: 'Operate in feature workspaces', text: 'Open CTWA, Calling, Broadcasting, or Inbox directly — not a mixed catalog of every module.', href: '/features/whatsapp-ads', icon: '', imageUrl: '' },
              { type: 'card', title: 'Measure and improve', text: 'Campaign results, journey analytics, and retargeting stay inside the same CRM.', href: '/features/whatsapp-analytics', icon: '', imageUrl: '' }
            ]
          },
          {
            id: 'about-values',
            title: 'Core values',
            eyebrow: 'Values',
            visible: true,
            preset: 'feature-grid',
            align: 'left',
            background: 'accent-soft',
            padding: 'normal',
            mediaSide: 'none',
            ctaLabel: '',
            ctaHref: '',
            blocks: [
              { type: 'feature-item', title: 'Tenant isolation', text: 'Workspace data and WhatsApp assets stay scoped to each company.', href: '/security', icon: 'shield', imageUrl: '' },
              { type: 'feature-item', title: 'Role-aware access', text: 'Owners, managers, and agents see the tools their role allows.', href: '/security', icon: 'products', imageUrl: '' },
              { type: 'feature-item', title: 'Publishable trust', text: 'Privacy, terms, and product pages are editable from Super Admin.', href: '/privacy-policy', icon: 'form', imageUrl: '' },
              { type: 'feature-item', title: 'Honest limits', text: 'Meta-gated or plan-limited tools are called out instead of oversold.', href: '/how-it-works', icon: 'workflow', imageUrl: '' }
            ]
          },
          {
            id: 'about-security',
            title: 'Security and customer trust',
            eyebrow: 'Trust',
            visible: true,
            preset: 'split-media',
            align: 'left',
            background: 'default',
            padding: 'normal',
            mediaSide: 'none',
            ctaLabel: 'Security overview',
            ctaHref: '/security',
            blocks: [
              { type: 'paragraph', text: 'Authentication, workspace membership, CSRF protection, and tenant-scoped database access are part of the product foundation — not optional add-ons. Super Admin controls company status, plans, and published site content without exposing customer message content on the marketing site.', emphasis: 'none' },
              { type: 'paragraph', text: 'We do not invent certifications, audit badges, or compliance claims. When you publish security language from Super Admin, keep it accurate to your environment and policies.', emphasis: 'none' }
            ]
          },
          {
            id: 'about-future',
            title: 'Where the platform is headed',
            eyebrow: 'Direction',
            visible: true,
            preset: 'plain',
            align: 'left',
            background: 'muted',
            padding: 'normal',
            mediaSide: 'none',
            ctaLabel: '',
            ctaHref: '',
            blocks: [
              { type: 'paragraph', text: 'Near-term focus remains feature-isolated workspaces, clearer public pricing disclosures, and Super Admin control over navigation, footer, and commercial plans — without breaking working WhatsApp messaging, Meta connections, or billing flows that already ship.', emphasis: 'none' },
              { type: 'paragraph', text: 'Company milestones, headcount, and partnership claims are intentionally omitted from default content. Add verified facts through Super Admin when you are ready to publish them.', emphasis: 'none' }
            ]
          },
          {
            id: 'about-cta',
            title: 'Ready to evaluate the workspace?',
            eyebrow: '',
            visible: true,
            preset: 'cta-band',
            align: 'center',
            background: 'brand',
            padding: 'spacious',
            mediaSide: 'none',
            ctaLabel: 'Get started',
            ctaHref: '/signup',
            blocks: [
              { type: 'paragraph', text: 'Browse products and features freely, then create a workspace when you are ready to connect WhatsApp and invite your team. Prefer a conversation first? Contact us.', emphasis: 'none' },
              { type: 'button', label: 'Contact us', href: '/contact', linkType: 'internal' }
            ]
          }
        ]
      },
      {
        id: 'page-contact',
        slug: 'contact',
        title: 'Contact Us',
        kind: 'contact',
        published: true,
        showInNav: true,
        navOrder: 50,
        seoTitle: 'Contact',
        seoDescription: 'Contact our team.',
        eyebrow: 'Contact',
        summary: 'Talk with us about onboarding, WhatsApp Business API setup, or partnership questions.',
        layout: 'default',
        hero: { enabled: true, title: 'Contact us', subtitle: 'Share your use case and we will route it to the right team.', ctaLabel: 'Create workspace', ctaHref: '/signup', image: 'none', imageUrl: '' },
        sections: [
          {
            id: 'contact-body',
            title: 'How to reach us',
            eyebrow: '',
            visible: true,
            preset: 'plain',
            align: 'left',
            background: 'muted',
            padding: 'normal',
            mediaSide: 'none',
            ctaLabel: '',
            ctaHref: '',
            blocks: [
              { type: 'paragraph', text: 'Use your workspace support email once signed in, or start with Create workspace if you are evaluating the platform.', emphasis: 'none' }
            ]
          }
        ]
      },
      {
        id: 'page-features-index',
        slug: 'features',
        title: 'Features',
        kind: 'page',
        published: true,
        showInNav: true,
        navOrder: 10,
        seoTitle: 'WhatsApp Features',
        seoDescription: 'Explore WhatsApp CRM capabilities.',
        eyebrow: 'Product',
        summary: 'Browse the capabilities your team can run on WhatsApp.',
        layout: 'default',
        hero: { enabled: true, title: 'WhatsApp capabilities', subtitle: 'Broadcasting, automation, AI assistance, calling, flows, and integrations — managed as publishable pages.', ctaLabel: 'Browse products', ctaHref: '/products', image: 'none', imageUrl: '' },
        sections: [
          {
            id: 'features-product-showcase',
            title: 'Start with a product line',
            eyebrow: 'Products',
            summary: 'Each suite groups related feature pages your Super Admin can edit and publish.',
            visible: true,
            preset: 'product-showcase',
            align: 'left',
            background: 'accent-soft',
            padding: 'normal',
            mediaSide: 'none',
            ctaLabel: 'Product catalog',
            ctaHref: '/products',
            blocks: []
          },
          {
            id: 'feature-index-grid',
            title: 'Feature library',
            eyebrow: 'Explore',
            visible: true,
            preset: 'feature-grid',
            align: 'left',
            background: 'default',
            padding: 'normal',
            mediaSide: 'none',
            ctaLabel: '',
            ctaHref: '',
            blocks: [
              { type: 'feature-item', title: 'Shared Inbox', text: 'Multi-agent live chat on one WhatsApp number.', href: '/features/whatsapp-inbox', icon: 'message', imageUrl: '' },
              { type: 'feature-item', title: 'Broadcasting', text: 'Template campaigns with operational controls.', href: '/features/whatsapp-broadcasting', icon: 'megaphone', imageUrl: '' },
              { type: 'feature-item', title: 'Automation', text: 'Event-driven follow-ups that stay compliant.', href: '/features/whatsapp-automation', icon: 'workflow', imageUrl: '' },
              { type: 'feature-item', title: 'AI agents', text: 'Assisted replies with human control.', href: '/features/whatsapp-ai-agents', icon: 'spark', imageUrl: '' },
              { type: 'feature-item', title: 'CTWA Ads', text: 'Ads that open WhatsApp conversations.', href: '/features/whatsapp-ads', icon: 'megaphone', imageUrl: '' },
              { type: 'feature-item', title: 'Commerce', text: 'Catalogs and payment-oriented workflows.', href: '/features/whatsapp-commerce', icon: 'cart', imageUrl: '' },
              { type: 'feature-item', title: 'Analytics', text: 'Delivery, reads, replies, and retargeting.', href: '/features/whatsapp-analytics', icon: 'chart', imageUrl: '' },
              { type: 'feature-item', title: 'Calling', text: 'Voice context inside your CRM timeline.', href: '/features/whatsapp-calling', icon: 'phone', imageUrl: '' },
              { type: 'feature-item', title: 'Chatbots', text: 'Guided journeys for common intents.', href: '/features/whatsapp-chatbots', icon: 'bot', imageUrl: '' },
              { type: 'feature-item', title: 'Flows & forms', text: 'Structured capture inside WhatsApp.', href: '/features/whatsapp-flows', icon: 'form', imageUrl: '' },
              { type: 'feature-item', title: 'Retargeting', text: 'Bring high-intent audiences back into chat.', href: '/features/whatsapp-retargeting', icon: 'workflow', imageUrl: '' }
            ]
          }
        ]
      }
  ];
  return {
    version: 3,
    theme: defaultTheme(),
    products,
    navigation: defaultMarketingNavigation(products, pages),
    footer: {
      blurb: 'WhatsApp Business CRM for conversations, campaigns, and automation — managed from one workspace.',
      columns: [],
      links: [
        { label: 'About', href: '/about' },
        { label: 'Privacy', href: '/privacy-policy' },
        { label: 'Terms', href: '/terms' },
        { label: 'Contact', href: '/contact' }
      ],
      socialLinks: []
    },
    pages
  };
}

function integrationsPage() {
  return {
    id: 'page-integrations',
    slug: 'integrations',
    title: 'Integrations',
    kind: 'integrations',
    published: true,
    showInNav: false,
    navOrder: 60,
    seoTitle: 'Integrations',
    seoDescription: 'Connect Shopify, WooCommerce, HubSpot, Salesforce, and automation platforms to WhatsApp workflows.',
    eyebrow: 'Integrations',
    summary: 'Connect CRM, commerce, and automation tools to WhatsApp workflows — only what the workspace marketplace supports today.',
    layout: 'default',
    hero: {
      enabled: true,
      title: 'Integrations',
      subtitle: 'OAuth connectors, commerce webhooks, CRM sync, and signed outbound events for Zapier-style automation.',
      ctaLabel: 'Explore connectors',
      ctaHref: '/integrations#integrations-connectors',
      image: 'none',
      imageUrl: ''
    },
    sections: [
      {
        id: 'integrations-connectors',
        title: 'Supported connectors',
        eyebrow: 'Marketplace',
        summary: 'Available from workspace Integrations when the connector feature flag is enabled for your account.',
        visible: true,
        preset: 'feature-grid',
        align: 'left',
        background: 'default',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'feature-item', title: 'Shopify', text: 'OAuth storefront connector for commerce events and catalog-aware workflows.', href: '/features/whatsapp-commerce', icon: 'integrations', imageUrl: '' },
          { type: 'feature-item', title: 'WooCommerce', text: 'Webhook-based connector — not a native Woo plugin; configure signed store webhooks in Integrations.', href: '/features/whatsapp-commerce', icon: 'integrations', imageUrl: '' },
          { type: 'feature-item', title: 'HubSpot CRM', text: 'OAuth CRM sync for contacts and pipeline context alongside WhatsApp conversations.', href: '/integrations#integrations-connectors', icon: 'integrations', imageUrl: '' },
          { type: 'feature-item', title: 'Salesforce CRM', text: 'OAuth CRM sync when crm_sync is enabled for your workspace.', href: '/integrations#integrations-connectors', icon: 'integrations', imageUrl: '' },
          { type: 'feature-item', title: 'Zapier & automation', text: 'Zapier, Make, n8n, and similar tools via versioned signed workspace webhooks — not a Zapier marketplace app.', href: '/integrations#integrations-note', icon: 'workflow', imageUrl: '' },
          { type: 'feature-item', title: 'Workspace API', text: 'Scoped API keys and signed outbound webhooks for custom integrations.', href: '/security', icon: 'shield', imageUrl: '' }
        ]
      },
      {
        id: 'integrations-note',
        title: 'How connections work',
        eyebrow: 'Setup',
        visible: true,
        preset: 'rich',
        align: 'left',
        background: 'muted',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: 'Contact us',
        ctaHref: '/contact',
        blocks: [
          { type: 'paragraph', text: 'Connectors are configured inside your workspace after signup. Commerce and CRM OAuth flows run from Settings → Integrations; automation platforms consume the same signed webhook payloads documented for operators.', emphasis: 'none' }
        ]
      }
    ]
  };
}

function contentPage(id, slug, title, eyebrow, summary, body) {
  return {
    id: `page-${id}`,
    slug,
    title,
    kind: id === 'security' ? 'security' : id === 'integrations' ? 'integrations' : 'page',
    published: true,
    showInNav: false,
    navOrder: 60,
    seoTitle: title,
    seoDescription: summary,
    eyebrow,
    summary,
    layout: 'default',
    hero: {
      enabled: true,
      title,
      subtitle: summary,
      ctaLabel: 'Create workspace',
      ctaHref: '/signup',
      image: 'none',
      imageUrl: ''
    },
    sections: [
      {
        id: `${slug}-body`,
        title: title,
        eyebrow: '',
        visible: true,
        preset: 'rich',
        align: 'left',
        background: 'default',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: 'Contact us',
        ctaHref: '/contact',
        blocks: [{ type: 'paragraph', text: body, emphasis: 'none' }]
      }
    ]
  };
}

function productFeatureBlocks(features = []) {
  return features
    .filter((feature) => feature.visible !== false)
    .map((feature) => ({
      type: 'feature-item',
      title: feature.title,
      text: feature.summary || '',
      href: feature.href || '/features',
      icon: feature.icon || '',
      imageUrl: ''
    }));
}

function marketingCtaSection(idPrefix, copy, ctaLabel = 'Create workspace', ctaHref = '/signup') {
  return {
    id: `${idPrefix}-cta`,
    title: 'Ready to put this to work?',
    eyebrow: '',
    visible: true,
    preset: 'cta-band',
    align: 'center',
    background: 'brand',
    padding: 'spacious',
    mediaSide: 'none',
    ctaLabel,
    ctaHref,
    blocks: [{ type: 'paragraph', text: copy, emphasis: 'none' }]
  };
}

function marketingFaqSection(idPrefix, title, items) {
  if (!items?.length) return null;
  return {
    id: `${idPrefix}-faq`,
    title,
    eyebrow: 'FAQ',
    visible: true,
    preset: 'faq',
    align: 'left',
    background: 'muted',
    padding: 'normal',
    mediaSide: 'none',
    ctaLabel: '',
    ctaHref: '',
    blocks: items.map((item) => ({ type: 'faq-item', title: item.q, text: item.a, emphasis: 'none' }))
  };
}

/** Public product detail page for /products/{slug} — also used when published CMS lacks a product page. */
export function buildProductMarketingPage(product) {
  if (!product?.slug) fail('Product pages need a slug.');
  const slug = product.slug;
  const featureBlocks = productFeatureBlocks(product.features);
  const benefitCards = (product.benefits || []).map((line) => ({
    type: 'card',
    title: line.split(',')[0].trim().slice(0, 72),
    text: line,
    href: '',
    icon: '',
    imageUrl: ''
  }));
  const useCaseList = (product.useCases || []).join('\n');
  const sharedOverviewSplit = {
    id: `${slug}-overview`,
    title: 'Suite overview',
    eyebrow: 'Overview',
    visible: true,
    preset: 'split-media',
    align: 'left',
    background: 'default',
    padding: 'spacious',
    mediaSide: 'right',
    ctaLabel: 'Browse features',
    ctaHref: '/features',
    blocks: [
      { type: 'paragraph', text: product.summary || '', emphasis: 'none' },
      { type: 'paragraph', text: 'Each capability below has its own feature page — explore without signing in, then connect WhatsApp when you are ready to operate.', emphasis: 'none' },
      { type: 'image', asset: 'hero', href: '', alt: product.title, text: product.title, width: 'wide' }
    ]
  };
  const capabilitiesGrid = {
    id: `${slug}-capabilities`,
    title: 'Capabilities in this suite',
    eyebrow: 'Features',
    summary: 'Deep-dive pages for every major module in this product line.',
    visible: true,
    preset: 'feature-grid',
    align: 'left',
    background: 'accent-soft',
    padding: 'normal',
    mediaSide: 'none',
    ctaLabel: '',
    ctaHref: '',
    blocks: featureBlocks
  };
  const useCasesSection = useCaseList ? {
    id: `${slug}-usecases`,
    title: 'Where teams start',
    eyebrow: 'Use cases',
    visible: true,
    preset: 'rich',
    align: 'left',
    background: 'default',
    padding: 'normal',
    mediaSide: 'none',
    ctaLabel: '',
    ctaHref: '',
    blocks: [
      { type: 'paragraph', text: 'Common starting points for this product line:', emphasis: 'none' },
      { type: 'list', text: useCaseList, emphasis: 'none' }
    ]
  } : null;

  let sections = [];
  if (slug === 'whatsapp-crm') {
    sections = [
      sharedOverviewSplit,
      {
        id: `${slug}-problem`,
        title: 'Why teams outgrow a single chat window',
        eyebrow: 'Problem',
        visible: true,
        preset: 'columns',
        align: 'left',
        background: 'muted',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'paragraph', text: 'Support and sales threads pile up on one phone or ad-hoc WhatsApp Web sessions. Assignments live in spreadsheets, campaign replies never meet the live chat timeline, and managers cannot see who owns which customer.', emphasis: 'none' },
          { type: 'paragraph', text: 'WhatsApp CRM centralizes 1:1 conversations on your Business number with assignment, notes, templates, and contact history — so handoffs stay auditable without asking customers to switch channels.', emphasis: 'none' }
        ]
      },
      {
        id: `${slug}-benefits`,
        title: 'Why operators choose this suite',
        eyebrow: 'Benefits',
        visible: true,
        preset: 'cards',
        align: 'left',
        background: 'muted',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: benefitCards.length ? benefitCards : [{ type: 'card', title: 'One timeline', text: 'Chat, campaigns, and calling context on the same contact record.', href: '/features/whatsapp-inbox', icon: '', imageUrl: '' }]
      },
      capabilitiesGrid,
      {
        id: `${slug}-how`,
        title: 'How teams run WhatsApp CRM day to day',
        eyebrow: 'Workflow',
        visible: true,
        preset: 'steps',
        align: 'left',
        background: 'default',
        padding: 'normal',
        mediaSide: 'none',
        summary: 'Connect once, then route conversations through inbox, AI assist, and calling where enabled.',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'card', title: 'Connect WhatsApp', text: 'Link your WhatsApp Business account and verify webhook delivery on your workspace URL.', href: '/signup', icon: '', imageUrl: '' },
          { type: 'card', title: 'Assign and collaborate', text: 'Use the shared inbox for live chat, notes, templates, and tags — the main inbox stays 1:1-first.', href: '/features/whatsapp-inbox', icon: '', imageUrl: '' },
          { type: 'card', title: 'Add assist layers', text: 'Turn on AI drafting or calling when your Meta setup and entitlements support them.', href: '/features/whatsapp-ai-agents', icon: '', imageUrl: '' }
        ]
      },
      marketingFaqSection(slug, 'CRM operations', [
        { q: 'Does this replace Meta Business Manager?', a: 'No. You still manage WhatsApp Business assets and policy compliance in Meta. The CRM is where your team runs inbox, contacts, and operational workflows on top of a connected number.' },
        { q: 'Can every agent use their personal WhatsApp?', a: 'The product is built around a shared Business number and workspace roles — not personal accounts. Agents sign into the CRM to reply on the company line.' }
      ]),
      useCasesSection,
      {
        id: `${slug}-related`,
        title: 'Often paired with',
        eyebrow: 'Explore',
        visible: true,
        preset: 'cards',
        align: 'left',
        background: 'accent-soft',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: 'All products',
        ctaHref: '/products',
        blocks: [
          { type: 'card', title: 'Broadcasting', text: 'Template campaigns and retargeting when inbox conversations need follow-up at scale.', href: '/products/broadcasting', icon: 'megaphone', imageUrl: '' },
          { type: 'card', title: 'Automation Builder', text: 'Qualify and route inbound messages before they land in the shared inbox.', href: '/products/automation-platform', icon: 'workflow', imageUrl: '' }
        ]
      },
      marketingCtaSection(slug, 'Create a workspace to connect WhatsApp, invite agents, and run inbox plus assist features from one CRM.')
    ].filter(Boolean);
  } else if (slug === 'broadcasting') {
    sections = [
      {
        id: `${slug}-overview`,
        title: 'Outbound that respects WhatsApp rules',
        eyebrow: 'Overview',
        visible: true,
        preset: 'rich',
        align: 'left',
        background: 'default',
        padding: 'spacious',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'paragraph', text: product.summary || '', emphasis: 'none' },
          { type: 'paragraph', text: 'Marketing sends use Meta-approved templates and opted-in audiences. Utility templates cover reminders and account updates — always check category and consent before you send.', emphasis: 'none' }
        ]
      },
      {
        id: `${slug}-problem`,
        title: 'Broadcasts fail when lists and templates are disconnected',
        eyebrow: 'Problem',
        visible: true,
        preset: 'columns',
        align: 'left',
        background: 'muted',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'paragraph', text: 'Spreadsheet exports, manual template copy-paste, and no delivery visibility create compliance risk and wasted sends — especially when opt-outs and template categories are tracked outside the CRM.', emphasis: 'none' },
          { type: 'paragraph', text: 'This suite keeps audience selection, approved templates, send controls, and outcome analytics in one workspace so operators can act on reads and failures without re-uploading lists.', emphasis: 'none' }
        ]
      },
      {
        id: `${slug}-how`,
        title: 'Campaign workflow',
        eyebrow: 'How it works',
        visible: true,
        preset: 'steps',
        align: 'left',
        background: 'default',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'card', title: 'Build the audience', text: 'Start from contacts, saved segments, or campaign results — with suppression for opt-outs.', href: '/features/whatsapp-broadcasting', icon: '', imageUrl: '' },
          { type: 'card', title: 'Choose an approved template', text: 'Pick a template that matches your message category and personalize variables.', href: '/features/whatsapp-broadcasting', icon: '', imageUrl: '' },
          { type: 'card', title: 'Send and learn', text: 'Track delivery, reads, replies, and failures, then retarget from analytics when it makes sense.', href: '/features/whatsapp-analytics', icon: '', imageUrl: '' }
        ]
      },
      capabilitiesGrid,
      marketingFaqSection(slug, 'Policy-aware questions', [
        { q: 'Can I send promotional messages to any contact?', a: 'No. Marketing broadcasts require approved templates and audiences that meet WhatsApp opt-in expectations. The workspace surfaces suppression and consent signals — you remain responsible for list quality.' },
        { q: 'What about Marketing Messages (MM Lite)?', a: 'Some accounts can onboard to Meta Marketing Messages for optimized marketing sends. Availability is Meta-gated; the CRM documents status and blocks marketing paths when not onboarded.' },
        { q: 'Where do replies to a broadcast go?', a: 'Customer replies open or continue 1:1 threads in the shared inbox on the same Business number — so agents see campaign context beside the live conversation.' }
      ]),
      useCasesSection,
      {
        id: `${slug}-related`,
        title: 'Modules in this suite',
        eyebrow: 'Go deeper',
        visible: true,
        preset: 'feature-grid',
        align: 'left',
        background: 'accent-soft',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: 'Campaign analytics',
        ctaHref: '/features/whatsapp-analytics',
        blocks: [
          { type: 'feature-item', title: 'Retargeting', text: 'Follow up with cohorts from delivery and read outcomes.', href: '/features/whatsapp-retargeting', icon: 'workflow', imageUrl: '' },
          { type: 'feature-item', title: 'Analytics', text: 'Review sent, delivered, read, and failed counts per campaign.', href: '/features/whatsapp-analytics', icon: 'grid', imageUrl: '' },
          { type: 'feature-item', title: 'Shared inbox', text: 'Handle broadcast replies with assignment and templates.', href: '/features/whatsapp-inbox', icon: 'message', imageUrl: '' }
        ]
      },
      marketingCtaSection(slug, 'Launch your workspace to import audiences, sync templates, and run campaigns with operational controls.')
    ].filter(Boolean);
  } else if (slug === 'automation-platform') {
    sections = [
      sharedOverviewSplit,
      {
        id: `${slug}-problem`,
        title: 'Manual follow-up does not scale on WhatsApp',
        eyebrow: 'Problem',
        visible: true,
        preset: 'columns',
        align: 'left',
        background: 'muted',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'paragraph', text: 'Teams copy the same reminder messages, forget tag-based routing, and lose bot context when a human takes over — especially after hours or during campaign spikes.', emphasis: 'none' },
          { type: 'paragraph', text: 'Automation Builder wires triggers, delays, templates, chatbot branches, and WhatsApp Flows so structured capture and follow-ups run reliably — with explicit handoff into the shared inbox.', emphasis: 'none' }
        ]
      },
      {
        id: `${slug}-benefits`,
        title: 'Why operators automate here',
        eyebrow: 'Benefits',
        visible: true,
        preset: 'cards',
        align: 'left',
        background: 'default',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: benefitCards.length ? benefitCards : [{ type: 'card', title: 'Human handoff', text: 'Escalate with tags and transcript context intact.', href: '/features/whatsapp-inbox', icon: '', imageUrl: '' }]
      },
      capabilitiesGrid,
      {
        id: `${slug}-how`,
        title: 'From bot to human handoff',
        eyebrow: 'How it works',
        visible: true,
        preset: 'steps',
        align: 'left',
        background: 'muted',
        padding: 'normal',
        mediaSide: 'none',
        summary: 'Design journeys in the automation workspace, then let the worker execute delayed and template steps.',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'card', title: 'Choose a trigger', text: 'Start from inbound messages, tags, campaign signals, or connector events where your workspace has them enabled.', href: '/features/whatsapp-automation', icon: '', imageUrl: '' },
          { type: 'card', title: 'Branch and capture', text: 'Combine chatbot replies, Flow launches, and conditions — publish Flow assets in Meta before go-live.', href: '/features/whatsapp-flows', icon: '', imageUrl: '' },
          { type: 'card', title: 'Hand off with context', text: 'Route to the shared inbox when the customer needs a person; delayed actions require the queue worker in production.', href: '/features/whatsapp-inbox', icon: '', imageUrl: '' }
        ]
      },
      marketingFaqSection(slug, 'Automation boundaries', [
        { q: 'Is this a marketplace of pre-built bot templates?', a: 'No. You build journeys in your workspace with triggers, conditions, and actions. It is CRM-owned graph UX — not a clone of every third-party template marketplace.' },
        { q: 'Do Flows work without Meta setup?', a: 'WhatsApp Flows require a connected WABA, published Flow assets, and live webhook delivery on your HTTPS app URL. Code readiness is not the same as Meta-verified production traffic.' },
        { q: 'Can automation send freeform marketing text?', a: 'Outbound marketing still follows WhatsApp template rules. Automations use approved templates and session windows where applicable — not arbitrary promotional free text.' }
      ]),
      useCasesSection,
      {
        id: `${slug}-related`,
        title: 'Often paired with',
        eyebrow: 'Explore',
        visible: true,
        preset: 'cards',
        align: 'left',
        background: 'accent-soft',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: 'WhatsApp CRM',
        ctaHref: '/products/whatsapp-crm',
        blocks: [
          { type: 'card', title: 'Shared inbox', text: 'Where automated journeys land when customers need a human.', href: '/products/whatsapp-crm', icon: 'message', imageUrl: '' },
          { type: 'card', title: 'Broadcasting', text: 'Template campaigns that automations can trigger or follow up on.', href: '/products/broadcasting', icon: 'megaphone', imageUrl: '' }
        ]
      },
      marketingCtaSection(slug, 'Create a workspace to design bots, publish Flows, and wire event automations beside your inbox.')
    ].filter(Boolean);
  } else if (slug === 'ads-commerce') {
    sections = [
      {
        id: `${slug}-overview`,
        title: 'Growth tools beside your inbox',
        eyebrow: 'Overview',
        visible: true,
        preset: 'split-media',
        align: 'left',
        background: 'default',
        padding: 'spacious',
        mediaSide: 'left',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'paragraph', text: product.summary || '', emphasis: 'none' },
          { type: 'paragraph', text: 'Ads and commerce capabilities depend on Meta asset linkage and account eligibility. The CRM shows readiness blockers instead of implying every account can run full-funnel ads or in-chat checkout on day one.', emphasis: 'none' },
          { type: 'image', asset: 'hero', href: '', alt: product.title, text: product.title, width: 'wide' }
        ]
      },
      {
        id: `${slug}-problem`,
        title: 'Ad clicks and orders should not vanish from chat',
        eyebrow: 'Problem',
        visible: true,
        preset: 'columns',
        align: 'left',
        background: 'muted',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'paragraph', text: 'Performance marketers often measure clicks in Ads Manager while support answers order questions in a separate inbox — with no shared timeline for referral conversations or catalog context.', emphasis: 'none' },
          { type: 'paragraph', text: 'This suite links CTWA entry measurement and commerce tooling to the same customer record your agents already use — with explicit readiness when Meta assets or commerce eligibility are incomplete.', emphasis: 'none' }
        ]
      },
      {
        id: `${slug}-modules`,
        title: 'Two modules, one customer timeline',
        eyebrow: 'Modules',
        visible: true,
        preset: 'cards',
        align: 'left',
        background: 'default',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'card', title: 'Click-to-WhatsApp Ads', text: 'Connect Page and ad account assets, create paused CTWA campaigns, and measure WhatsApp entry conversations.', href: '/features/whatsapp-ads', icon: 'megaphone', imageUrl: '' },
          { type: 'card', title: 'Commerce & payments', text: 'Catalog and payment-oriented workflows where Meta commerce features are enabled for your number.', href: '/features/whatsapp-commerce', icon: 'grid', imageUrl: '' },
          { type: 'card', title: 'Integrations', text: 'Shopify, WooCommerce webhooks, and CRM sync when connector flags are on for your workspace.', href: '/integrations', icon: 'integrations', imageUrl: '' }
        ]
      },
      {
        id: `${slug}-how`,
        title: 'From ad click to inbox thread',
        eyebrow: 'How it works',
        visible: true,
        preset: 'steps',
        align: 'left',
        background: 'muted',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'card', title: 'Connect Meta assets', text: 'Use Facebook Login in the Ads workspace and resolve readiness blockers for Page, ad account, and WhatsApp number linkage.', href: '/features/whatsapp-ads', icon: '', imageUrl: '' },
          { type: 'card', title: 'Launch or draft CTWA', text: 'Create paused Click-to-WhatsApp campaigns in the CRM before spending budget — billing still lives in Ads Manager.', href: '/features/whatsapp-ads', icon: '', imageUrl: '' },
          { type: 'card', title: 'Serve in inbox and commerce', text: 'Referral conversations and order questions stay on one timeline beside catalog workflows when enabled.', href: '/features/whatsapp-inbox', icon: '', imageUrl: '' }
        ]
      },
      capabilitiesGrid,
      marketingFaqSection(slug, 'Meta-gated capabilities', [
        { q: 'Will CTWA ads work immediately after signup?', a: 'You need Facebook Login, an eligible ad account, a linked Page, and a WhatsApp number tied to your business. The Ads workspace lists blockers until assets connect.' },
        { q: 'Is in-chat checkout guaranteed?', a: 'No. Catalog, cart, and payment experiences depend on Meta commerce eligibility and regional support. Order support still runs through your inbox either way.' },
        { q: 'Does this CRM replace Ads Manager reporting?', a: 'No. It focuses on CTWA setup, asset linkage, and measuring WhatsApp entry conversations — not full-funnel ad billing or creative testing.' }
      ]),
      useCasesSection,
      {
        id: `${slug}-related`,
        title: 'Often paired with',
        eyebrow: 'Explore',
        visible: true,
        preset: 'cards',
        align: 'left',
        background: 'accent-soft',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: 'All products',
        ctaHref: '/products',
        blocks: [
          { type: 'card', title: 'WhatsApp CRM', text: 'Shared inbox for referral chats and order support on one number.', href: '/products/whatsapp-crm', icon: 'message', imageUrl: '' },
          { type: 'card', title: 'Automation Builder', text: 'Follow up on ad entry or cart events when connectors are enabled.', href: '/products/automation-platform', icon: 'workflow', imageUrl: '' }
        ]
      },
      marketingCtaSection(slug, 'Start a workspace to connect Meta assets and run ads or commerce workflows with honest readiness guidance.')
    ].filter(Boolean);
  } else {
    sections = [
      sharedOverviewSplit,
      capabilitiesGrid,
      useCasesSection,
      marketingCtaSection(slug, 'Create your workspace to explore this product line in the live CRM.')
    ].filter(Boolean);
  }

  return {
    id: `product-page-${slug}`,
    slug,
    title: product.title,
    kind: 'product',
    published: true,
    showInNav: false,
    navOrder: 15,
    seoTitle: `${product.title} — WhatsApp CRM`,
    seoDescription: product.summary || '',
    eyebrow: 'Product',
    summary: product.summary || '',
    layout: 'feature',
    hero: {
      enabled: true,
      title: product.title,
      subtitle: product.summary || '',
      // Signup sentinel — marketing-page rewrites to the product workspace launch CTA.
      ctaLabel: product.ctaLabel || 'Use this product',
      ctaHref: product.ctaHref || '/signup',
      image: 'none',
      imageUrl: ''
    },
    sections
  };
}

function featurePage(slug, title, summary, body, capabilities = [], useCases = [], options = {}) {
  const capabilityText = (capabilities.length ? capabilities : [
    'Clear customer context across chat and campaigns',
    'Team-ready workflows with role-aware access',
    'Publishable product storytelling from Super Admin'
  ]).join('\n');
  const useCaseText = (useCases.length ? useCases : ['Revenue teams', 'Support teams', 'Operations teams']).join('\n');
  const overviewPreset = options.overviewPreset || 'split-media';
  const overviewBlocks = overviewPreset === 'rich' || overviewPreset === 'plain'
    ? [{ type: 'paragraph', text: body, emphasis: 'none' }, { type: 'list', text: capabilityText, emphasis: 'none' }]
    : [
      { type: 'paragraph', text: body, emphasis: 'none' },
      { type: 'list', text: capabilityText, emphasis: 'none' },
      { type: 'image', asset: 'hero', href: '', alt: title, text: title, width: 'wide' }
    ];
  const overviewSection = {
    id: `${slug}-overview`,
    title: options.overviewTitle || 'What this feature is',
    eyebrow: 'Overview',
    visible: true,
    preset: overviewPreset === 'split-media' ? 'split-media' : overviewPreset === 'plain' ? 'plain' : 'rich',
    align: 'left',
    background: 'default',
    padding: overviewPreset === 'rich' ? 'spacious' : 'normal',
    mediaSide: 'right',
    // Leave blank so marketing-page can inject the feature workspace launch CTA
    // instead of sending users to the public /features catalog.
    ctaLabel: options.overviewCtaLabel || '',
    ctaHref: options.overviewCtaHref || '',
    blocks: overviewBlocks
  };
  const defaultHowSection = {
    id: `${slug}-how`,
    title: options.howTitle || 'How it works in the CRM',
    eyebrow: 'Workflow',
    visible: true,
    preset: 'steps',
    align: 'left',
    background: 'muted',
    padding: 'normal',
    mediaSide: 'none',
    summary: options.howSummary || 'One focused workspace per feature — open it, configure what it needs, then run and measure.',
    ctaLabel: '',
    ctaHref: '',
    blocks: options.howSteps || [
      { type: 'card', title: 'Open the workspace', text: 'Use the sidebar to enter the dedicated feature area — not a mixed dashboard of unrelated tools.', href: '/signup', icon: '', imageUrl: '' },
      { type: 'card', title: 'Configure once', text: 'Connect WhatsApp assets and settings that this feature depends on, with clear readiness guidance.', href: '/signup', icon: '', imageUrl: '' },
      { type: 'card', title: 'Run and measure', text: 'Complete the primary action, then review outcomes in analytics, inbox, or operations views.', href: '/signup', icon: '', imageUrl: '' }
    ]
  };
  const useCasesSection = {
    id: `${slug}-usecases`,
    title: 'Business use cases',
    eyebrow: 'Examples',
    visible: options.hideUseCases !== true,
    preset: 'rich',
    align: 'left',
    background: 'default',
    padding: 'normal',
    mediaSide: 'none',
    ctaLabel: '',
    ctaHref: '',
    blocks: [
      { type: 'paragraph', text: 'Teams typically use this capability for:', emphasis: 'none' },
      { type: 'list', text: useCaseText, emphasis: 'none' }
    ]
  };
  const sections = [overviewSection];
  if (options.problem?.blocks?.length) {
    sections.push({
      id: `${slug}-problem`,
      title: options.problem.title || 'Why this matters',
      eyebrow: options.problem.eyebrow || 'Problem',
      visible: true,
      preset: options.problem.preset || 'columns',
      align: 'left',
      background: options.problem.background || 'muted',
      padding: 'normal',
      mediaSide: 'none',
      ctaLabel: '',
      ctaHref: '',
      blocks: options.problem.blocks
    });
  }
  if (options.benefitCards?.length) {
    sections.push({
      id: `${slug}-benefits`,
      title: options.benefitsTitle || 'Operational benefits',
      eyebrow: 'Benefits',
      visible: true,
      preset: 'cards',
      align: 'left',
      background: 'muted',
      padding: 'normal',
      mediaSide: 'none',
      ctaLabel: '',
      ctaHref: '',
      blocks: options.benefitCards.map((card) => ({ type: 'card', title: card.title, text: card.text, href: card.href || '', icon: card.icon || '', imageUrl: '' }))
    });
  }
  if (options.capabilityGrid?.length) {
    sections.push({
      id: `${slug}-capabilities`,
      title: options.capabilitiesTitle || 'Key capabilities',
      eyebrow: 'Capabilities',
      visible: true,
      preset: 'feature-grid',
      align: 'left',
      background: 'accent-soft',
      padding: 'normal',
      mediaSide: 'none',
      ctaLabel: '',
      ctaHref: '',
      blocks: options.capabilityGrid.map((item) => ({ type: 'feature-item', title: item.title, text: item.text, href: item.href || '', icon: item.icon || '', imageUrl: '' }))
    });
  }
  if (options.middleSection) {
    sections.push(options.middleSection);
  } else if (options.includeHowItWorks !== false) {
    sections.push(defaultHowSection);
  }
  const faq = marketingFaqSection(slug, options.faqTitle || 'Common questions', options.faq);
  if (faq) sections.push(faq);
  sections.push(useCasesSection);
  if (options.relatedFeatures?.length) {
    sections.push({
      id: `${slug}-related-features`,
      title: options.relatedFeaturesTitle || 'Related capabilities',
      eyebrow: 'Explore',
      visible: true,
      preset: 'feature-grid',
      align: 'left',
      background: 'accent-soft',
      padding: 'normal',
      mediaSide: 'none',
      ctaLabel: options.relatedFeaturesCtaLabel || 'All features',
      ctaHref: options.relatedFeaturesCtaHref || '/features',
      blocks: options.relatedFeatures.map((item) => ({
        type: 'feature-item',
        title: item.title,
        text: item.text,
        href: item.href || '',
        icon: ICONS.has(item.icon || '') ? (item.icon || '') : '',
        imageUrl: ''
      }))
    });
  }
  if (options.relatedProductHref) {
    sections.push({
      id: `${slug}-related`,
      title: 'Part of a product suite',
      eyebrow: 'Explore',
      visible: true,
      preset: 'plain',
      align: 'left',
      background: 'muted',
      padding: 'normal',
      mediaSide: 'none',
      ctaLabel: options.relatedProductLabel || 'View product suite',
      ctaHref: options.relatedProductHref,
      blocks: [{ type: 'paragraph', text: options.relatedProductText || 'See how this feature fits alongside related modules in the same product line.', emphasis: 'none' }]
    });
  }
  sections.push(marketingCtaSection(slug, options.ctaCopy || 'Create your workspace, connect your WhatsApp Business number, and turn on this capability with guided setup in the product.', options.ctaLabel, options.ctaHref));

  return {
    id: `feature-${slug}`,
    slug,
    title,
    kind: 'feature',
    published: true,
    showInNav: false,
    navOrder: 20,
    seoTitle: title,
    seoDescription: summary,
    eyebrow: 'Feature',
    summary,
    layout: 'feature',
    hero: {
      enabled: true,
      title,
      subtitle: summary,
      ctaLabel: `Use ${title}`,
      ctaHref: '/signup',
      image: 'none',
      imageUrl: ''
    },
    sections
  };
}

/** Migrate legacy v1 {sections,footerLinks,socialLinks} into v2/v3 pages document. */
function isThinAboutPage(page) {
  if (!page || page.kind !== 'about') return false;
  const sections = Array.isArray(page.sections) ? page.sections : [];
  if (sections.length === 0) return true;
  if (sections.length >= 3) return false;
  // Upgrade known stub CMS titles only — keep intentionally migrated/custom About copy.
  const heroTitle = String(page.hero?.title || '').trim().toLowerCase();
  return heroTitle === 'about the platform' || heroTitle === 'about the product';
}

function ensurePremiumMarketingPages(document) {
  const defaults = defaultDocument();
  const pages = Array.isArray(document.pages) ? [...document.pages] : [];
  const products = Array.isArray(document.products) && document.products.length ? document.products : defaultProducts();

  const aboutIdx = pages.findIndex((page) => page.kind === 'about');
  const defaultAbout = defaults.pages.find((page) => page.kind === 'about');
  if (defaultAbout && (aboutIdx < 0 || isThinAboutPage(pages[aboutIdx]))) {
    if (aboutIdx < 0) pages.push(defaultAbout);
    else pages[aboutIdx] = { ...defaultAbout, id: pages[aboutIdx].id || defaultAbout.id, published: pages[aboutIdx].published !== false };
  }

  const existingProductSlugs = new Set(pages.filter((page) => page.kind === 'product').map((page) => page.slug));
  for (const product of products.filter((item) => item.visible !== false)) {
    if (!product.slug || existingProductSlugs.has(product.slug)) continue;
    pages.push(buildProductMarketingPage(product));
    existingProductSlugs.add(product.slug);
  }

  const existingSolutionSlugs = new Set(pages.filter((page) => page.kind === 'solution').map((page) => page.slug));
  for (const solution of defaultSolutionPages()) {
    if (!solution.slug || existingSolutionSlugs.has(solution.slug)) continue;
    pages.push(solution);
    existingSolutionSlugs.add(solution.slug);
  }
  if (!pages.some((page) => page.slug === 'solutions' && page.kind === 'page')) {
    pages.push(solutionsIndexPage());
  }

  const existingResourceSlugs = new Set(pages.filter((page) => page.kind === 'resource').map((page) => page.slug));
  for (const guide of defaultResourcePages()) {
    if (!guide.slug || existingResourceSlugs.has(guide.slug)) continue;
    pages.push(guide);
    existingResourceSlugs.add(guide.slug);
  }
  if (!pages.some((page) => page.slug === 'resources' && page.kind === 'page')) {
    pages.push(resourcesIndexPage());
  }
  if (!pages.some((page) => page.slug === 'how-it-works' && page.kind === 'page')) {
    pages.push(howItWorksPage());
  }

  const next = { ...document, products, pages };
  next.navigation = ensureMarketingNavigation(next);
  if (isThinFooter(next.footer)) {
    const seeded = buildDefaultFooter(products, pages);
    const existingSocial = Array.isArray(next.footer?.socialLinks) ? next.footer.socialLinks : [];
    next.footer = { ...seeded, socialLinks: existingSocial.length ? existingSocial : seeded.socialLinks };
  } else {
    next.footer = scrubFooterWorkspaceActions(next.footer);
  }
  return next;
}

export function migrateSiteDocument(input) {
  if (!input || typeof input !== 'object') return defaultDocument();
  if (Number(input.version) >= 2 && Array.isArray(input.pages)) {
    let next = { ...input };
    if (!Array.isArray(next.products) || !next.products.length) next.products = defaultProducts();
    next = ensurePremiumMarketingPages(next);
    next.version = Math.max(Number(next.version) || 2, 3);
    return next;
  }
  const base = defaultDocument();
  const legacySections = Array.isArray(input.sections) ? input.sections : [];
  if (legacySections.length) {
    const home = base.pages.find((page) => page.kind === 'home');
    home.sections = legacySections
      .filter((section) => section && section.kind !== 'terms' && section.kind !== 'about')
      .map((section) => ({
        id: section.id || `section-${Math.random().toString(36).slice(2, 7)}`,
        title: section.title || 'Section',
        eyebrow: section.eyebrow || '',
        visible: section.visible !== false,
        preset: section.layout === 'columns' ? 'columns' : section.layout === 'split' ? 'split-media' : 'plain',
        align: section.align === 'center' ? 'center' : 'left',
        background: 'default',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: section.ctaLabel || '',
        ctaHref: section.ctaHref || '',
        blocks: Array.isArray(section.blocks) ? section.blocks : []
      }));
    const about = legacySections.find((section) => section.kind === 'about' || section.id === 'about');
    if (about) {
      const aboutPage = base.pages.find((page) => page.kind === 'about');
      aboutPage.sections = [{
        id: about.id || 'about-body',
        title: about.title || 'About',
        eyebrow: about.eyebrow || '',
        visible: true,
        preset: 'rich',
        align: 'left',
        background: 'default',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: about.ctaLabel || '',
        ctaHref: about.ctaHref || '',
        blocks: Array.isArray(about.blocks) ? about.blocks : []
      }];
    }
    const terms = legacySections.find((section) => section.kind === 'terms');
    if (terms) {
      base.pages.push({
        id: 'page-terms',
        slug: 'terms',
        title: terms.title || 'Terms',
        kind: 'legal',
        published: terms.visible !== false,
        showInNav: false,
        navOrder: 90,
        seoTitle: 'Terms',
        seoDescription: '',
        eyebrow: 'Legal',
        summary: '',
        layout: 'default',
        hero: { enabled: false, title: '', subtitle: '', ctaLabel: '', ctaHref: '', image: 'none', imageUrl: '' },
        sections: [{
          id: terms.id || 'terms-body',
          title: terms.title || 'Terms',
          eyebrow: '',
          visible: true,
          preset: 'rich',
          align: 'left',
          background: 'default',
          padding: 'normal',
          mediaSide: 'none',
          ctaLabel: '',
          ctaHref: '',
          blocks: Array.isArray(terms.blocks) ? terms.blocks : []
        }]
      });
    }
  }
  if (Array.isArray(input.footerLinks)) base.footer.links = input.footerLinks;
  if (Array.isArray(input.socialLinks)) base.footer.socialLinks = input.socialLinks;
  if (!Array.isArray(base.products) || !base.products.length) base.products = defaultProducts();
  const migrated = ensurePremiumMarketingPages(base);
  migrated.version = Math.max(Number(migrated.version) || 2, 3);
  return migrated;
}

export function validateSiteDocument(input) {
  const migrated = migrateSiteDocument(input);
  if (!isObject(migrated)) fail();
  const themeIn = isObject(migrated.theme) ? migrated.theme : {};
  const theme = {
    primary: hexColor(themeIn.primary, defaultTheme().primary),
    accent: hexColor(themeIn.accent, defaultTheme().accent),
    surface: hexColor(themeIn.surface, defaultTheme().surface),
    ink: hexColor(themeIn.ink, defaultTheme().ink),
    displayFont: optional(themeIn.displayFont, 40) || defaultTheme().displayFont,
    bodyFont: optional(themeIn.bodyFont, 40) || defaultTheme().bodyFont
  };
  const products = Array.isArray(migrated.products)
    ? migrated.products.slice(0, 40).map(validateProduct).sort((a, b) => a.order - b.order)
    : defaultProducts().map(validateProduct);
  if (!Array.isArray(migrated.navigation) || migrated.navigation.length > 24) fail('Navigation supports up to 24 top-level items.');
  const navigation = migrated.navigation.map((item) => validateNavItem(item));
  const footerIn = isObject(migrated.footer) ? migrated.footer : {};
  const footerDefaults = buildDefaultFooter(products, migrated.pages || []);
  const footerSource = scrubFooterWorkspaceActions(isThinFooter(footerIn) ? footerDefaults : footerIn);
  const footer = {
    blurb: optional(footerSource.blurb, 400) || footerDefaults.blurb,
    ctaLabel: optional(footerSource.ctaLabel, 60),
    ctaHref: optional(footerSource.ctaHref, 240)
      ? (String(footerSource.ctaHref).startsWith('http') ? externalHttps(footerSource.ctaHref) : localPath(footerSource.ctaHref, false))
      : '',
    ctaText: optional(footerSource.ctaText, 240),
    copyright: optional(footerSource.copyright, 160),
    columns: Array.isArray(footerSource.columns)
      ? footerSource.columns.slice(0, 7).map((column, index) => ({
        id: clean(column.id || `footer-col-${index + 1}`, 48),
        title: clean(column.title || 'Links', 40),
        visible: column.visible !== false,
        links: Array.isArray(column.links)
          ? column.links.slice(0, 12).map((link) => ({
            label: clean(link.label, 60),
            href: String(link.href || '').startsWith('http') ? externalHttps(link.href) : localPath(link.href, false)
          }))
          : []
      }))
      : footerDefaults.columns,
    links: Array.isArray(footerSource.links)
      ? footerSource.links.slice(0, 12).map((link) => ({
        label: clean(link.label, 60),
        href: localPath(link.href, false)
      }))
      : footerDefaults.links,
    socialLinks: (Array.isArray(footerSource.socialLinks) && footerSource.socialLinks.length
      ? footerSource.socialLinks
      : Array.isArray(footerIn.socialLinks) ? footerIn.socialLinks : [])
      .slice(0, 8)
      .map((link) => ({
        label: clean(link.label, 40),
        href: externalHttps(link.href, false)
      }))
  };
  if (!Array.isArray(migrated.pages) || migrated.pages.length < 1 || migrated.pages.length > 80) {
    fail('Add between 1 and 80 website pages.');
  }
  const usedSlugs = new Set();
  const pages = migrated.pages.map((page) => validatePage(page, usedSlugs));
  if (!pages.some((page) => page.kind === 'home')) fail('A Home page is required.');

  const publishedRoutes = new Set(
    pages.filter((page) => page.published !== false).map((page) => publicPathForPage(page))
  );
  publishedRoutes.add('/signup');
  publishedRoutes.add('/login');
  publishedRoutes.add('/privacy-policy');
  publishedRoutes.add('/terms');
  publishedRoutes.add('/products');
  publishedRoutes.add('/features');
  publishedRoutes.add('/solutions');
  publishedRoutes.add('/integrations');
  publishedRoutes.add('/resources');
  publishedRoutes.add('/how-it-works');
  publishedRoutes.add('/#pricing');
  publishedRoutes.add('/pricing');
  publishedRoutes.add('/about');
  publishedRoutes.add('/contact');
  publishedRoutes.add('/security');
  for (const product of products) {
    if (product.slug) publishedRoutes.add(`/products/${product.slug}`);
  }
  for (const page of pages) {
    if (page.published === false) continue;
    if (page.kind === 'solution' && page.slug) publishedRoutes.add(`/solutions/${page.slug}`);
    if (page.kind === 'feature' && page.slug) publishedRoutes.add(`/features/${page.slug}`);
    if (page.kind === 'resource' && page.slug) publishedRoutes.add(`/resources/${page.slug}`);
  }

  const broken = [];
  const checkHref = (href, label) => {
    if (!href || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return;
    const path = href.split('?')[0];
    if (path.includes('#') && !publishedRoutes.has(path)) {
      const base = path.split('#')[0] || '/';
      if (!publishedRoutes.has(base) && !publishedRoutes.has(path)) broken.push(`${label} → ${href}`);
      return;
    }
    if (!publishedRoutes.has(path)) broken.push(`${label} → ${href}`);
  };
  const walkNav = (items, prefix = 'Navigation') => {
    for (const item of items || []) {
      if (item.visible === false) continue;
      if (item.type === 'internal') checkHref(item.href, `${prefix}: ${item.label}`);
      walkNav(item.children, `${prefix}: ${item.label}`);
    }
  };
  walkNav(navigation);
  for (const column of footer.columns || []) {
    if (column.visible === false) continue;
    for (const link of column.links || []) checkHref(link.href, `Footer / ${column.title}: ${link.label}`);
  }
  for (const link of footer.links || []) checkHref(link.href, `Footer legal: ${link.label}`);
  if (footer.ctaHref) checkHref(footer.ctaHref, 'Footer CTA');
  for (const product of products) {
    if (product.visible === false) continue;
    checkHref(product.href, `Product: ${product.title}`);
    for (const feature of product.features || []) {
      if (feature.visible === false) continue;
      checkHref(feature.href, `Feature: ${feature.title}`);
    }
  }
  for (const page of pages) {
    if (page.published === false) continue;
    if (page.hero?.ctaHref) checkHref(page.hero.ctaHref, `${page.title} hero CTA`);
    for (const section of page.sections || []) {
      if (section.visible === false) continue;
      if (section.ctaHref) checkHref(section.ctaHref, `${page.title} / ${section.title || section.id} CTA`);
      for (const block of section.blocks || []) {
        if ((block.type === 'link' || block.type === 'button' || block.type === 'card' || block.type === 'feature-item') && block.href && block.href.startsWith('/')) {
          checkHref(block.href, `${page.title} block`);
        }
      }
    }
  }
  if (broken.length) {
    fail(`Internal links point to missing/unpublished pages: ${broken.slice(0, 8).join('; ')}${broken.length > 8 ? '…' : ''}`);
  }

  return { version: 3, theme, products, navigation, footer, pages };
}

export function getDefaultCmsDocument() {
  return validateSiteDocument(defaultDocument());
}

export function publicPathForPage(page) {
  if (!page) return '/';
  if (page.kind === 'home') return '/';
  if (page.kind === 'feature') return `/features/${page.slug}`;
  if (page.kind === 'solution') return `/solutions/${page.slug}`;
  if (page.kind === 'resource') return `/resources/${page.slug}`;
  if (page.kind === 'product' && page.slug) return `/products/${page.slug}`;
  if (page.kind === 'integrations') return '/integrations';
  return `/${page.slug}`;
}

export function findPublishedPage(document, matcher) {
  const pages = Array.isArray(document?.pages) ? document.pages : [];
  return pages.find((page) => page.published !== false && matcher(page)) || null;
}

export function findProductBySlug(document, slug) {
  const normalized = optional(slug, 80).toLowerCase();
  if (!normalized) return null;
  const products = Array.isArray(document?.products) ? document.products : [];
  return products.find((product) => product.slug === normalized) || null;
}
