import { AppError } from './db.js';
import { DESIGN_HTML_MAX_CHARS, sanitizeDesignMarkup } from './public-site-html.js';

const PAGE_KINDS = new Set(['home', 'page', 'feature', 'product', 'about', 'contact', 'faq', 'pricing', 'legal', 'integrations', 'security']);
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

/** Build a Products mega-menu nav item from the product catalog. */
export function buildProductsMegaNav(products = []) {
  const visible = (Array.isArray(products) ? products : []).filter((product) => product.visible !== false).sort((a, b) => a.order - b.order);
  return {
    id: 'nav-products',
    label: 'Products',
    href: '/products',
    type: 'internal',
    menuStyle: 'mega',
    description: 'Explore products and capabilities',
    icon: 'products',
    visible: true,
    openInNewTab: false,
    children: visible.map((product) => ({
      id: `nav-product-${product.id}`,
      label: product.title,
      href: product.href || '/features',
      type: 'internal',
      menuStyle: 'dropdown',
      description: product.summary || '',
      icon: product.icon || 'grid',
      visible: true,
      openInNewTab: false,
      children: (product.features || [])
        .filter((feature) => feature.visible !== false)
        .map((feature) => ({
          id: `nav-feature-${feature.id}`,
          label: feature.title,
          href: feature.href || '/features',
          type: 'internal',
          menuStyle: 'link',
          description: feature.summary || '',
          icon: feature.icon || '',
          visible: true,
          openInNewTab: false,
          children: []
        }))
    }))
  };
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
  const routeKey = kind === 'home' ? 'home' : kind === 'feature' ? `features/${slug}` : slug;
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
    primary: '#0f766e',
    accent: '#ea580c',
    surface: '#f6f8f7',
    ink: '#142429',
    displayFont: 'Fraunces',
    bodyFont: 'Source Sans 3'
  };
}

function defaultDocument() {
  const products = defaultProducts();
  const productPages = products.filter((product) => product.visible !== false).map((product) => buildProductMarketingPage(product));
  return {
    version: 3,
    theme: defaultTheme(),
    products,
    navigation: [
      { id: 'nav-home', label: 'Home', href: '/', type: 'internal', menuStyle: 'link', description: '', icon: '', visible: true, openInNewTab: false, children: [] },
      buildProductsMegaNav(products),
      { id: 'nav-pricing', label: 'Pricing', href: '/#pricing', type: 'internal', menuStyle: 'link', description: '', icon: '', visible: true, openInNewTab: false, children: [] },
      { id: 'nav-about', label: 'About Us', href: '/about', type: 'internal', menuStyle: 'link', description: '', icon: '', visible: true, openInNewTab: false, children: [] },
      { id: 'nav-contact', label: 'Contact Us', href: '/contact', type: 'internal', menuStyle: 'link', description: '', icon: '', visible: true, openInNewTab: false, children: [] }
    ],
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
    pages: [
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
        benefitCards: [
          { title: 'Template discipline', text: 'Outbound sends stay tied to approved templates and audience controls — not ad-hoc freeform blasts.' },
          { title: 'Operational visibility', text: 'See delivery health per campaign and drill into failures without exporting spreadsheets.' },
          { title: 'Follow-up loops', text: 'Retarget from analytics when a cohort did not read or reply — still within opt-in and template rules.' }
        ],
        faq: [
          { q: 'Can I message contacts who never opted in?', a: 'You should not. The CRM helps enforce suppression and consent signals, but list quality and opt-in proof remain your responsibility under WhatsApp policy.' }
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
        howTitle: 'Automation canvas workflow',
        howSummary: 'Design on a visual canvas, activate when ready, and let the worker handle delayed steps.',
        howSteps: [
          { type: 'card', title: 'Pick a trigger', text: 'Start from tags, inbound messages, campaign outcomes, or integration events where enabled.', href: '/signup', icon: '', imageUrl: '' },
          { type: 'card', title: 'Wire branches', text: 'Add conditions, delays, template sends, and handoff nodes with auto-layout in the builder.', href: '/signup', icon: '', imageUrl: '' },
          { type: 'card', title: 'Run with the worker', text: 'Delayed and template actions enqueue jobs — keep the queue worker running in production.', href: '/signup', icon: '', imageUrl: '' }
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
        benefitCards: [
          { title: 'Team coordination', text: 'Assignment, notes, and templates keep multiple agents on one Business number without stepping on each other.' },
          { title: 'Contact 360', text: 'Profile, consent, tags, and recent activity for the open conversation — CRM-stored context, not every undocumented Meta signal.' },
          { title: '1:1-first design', text: 'The shared inbox focuses on customer threads; WhatsApp Groups use a separate module when Meta eligibility allows.' }
        ],
        faq: [
          { q: 'Does the inbox include WhatsApp Groups?', a: 'Groups are supported in a dedicated Groups module when the feature flag and Meta eligibility allow. The main inbox remains 1:1-first for CRM contacts.' }
        ],
        relatedProductHref: '/products/whatsapp-crm'
      }),
      contentPage('security', 'security', 'Security & compliance', 'Security', 'Controls, auditability, and policy pages for operator-grade WhatsApp workspaces.', 'Role-aware access, session controls, and publishable legal/policy content help teams run WhatsApp professionally.'),
      integrationsPage(),
      {
        id: 'page-about',
        slug: 'about',
        title: 'About Us',
        kind: 'about',
        published: true,
        showInNav: true,
        navOrder: 40,
        seoTitle: 'About us — WhatsApp Business CRM',
        seoDescription: 'How we approach WhatsApp CRM for revenue and support teams — inbox, broadcasts, automation, and governance in one workspace.',
        eyebrow: 'About us',
        summary: 'We build WhatsApp CRM for teams that need reliable messaging operations — not just another chat widget.',
        layout: 'landing',
        hero: {
          enabled: true,
          title: 'Built for teams that run WhatsApp as a real channel',
          subtitle: 'Shared inbox, approved broadcasts, automation, ads entry, and commerce tooling — governed from one workspace, with a public site you can edit without shipping code.',
          ctaLabel: 'Explore products',
          ctaHref: '/products',
          image: 'hero',
          imageUrl: ''
        },
        sections: [
          {
            id: 'about-intro',
            title: 'Customer conversations deserve operator-grade software',
            eyebrow: 'Our focus',
            visible: true,
            preset: 'split-media',
            align: 'left',
            background: 'default',
            padding: 'spacious',
            mediaSide: 'right',
            ctaLabel: 'See capabilities',
            ctaHref: '/features',
            blocks: [
              { type: 'paragraph', text: 'WhatsApp is where customers already talk. Teams need more than a single inbox: campaign controls, automation with handoff, calling context, clear entitlements, and a product story visitors can explore before they sign up.', emphasis: 'none' },
              { type: 'paragraph', text: 'We design for that full loop — discover → evaluate → connect WhatsApp → operate — while keeping Meta-facing responsibilities honest and tenant data isolated.', emphasis: 'none' },
              { type: 'image', asset: 'hero', href: '', alt: 'WhatsApp CRM workspace', text: 'Workspace preview', width: 'wide' }
            ]
          },
          {
            id: 'about-mission',
            title: 'Mission and product philosophy',
            eyebrow: 'Principles',
            visible: true,
            preset: 'cards',
            align: 'left',
            background: 'muted',
            padding: 'normal',
            mediaSide: 'none',
            ctaLabel: '',
            ctaHref: '',
            blocks: [
              { type: 'card', title: 'Clarity over claims', text: 'We describe capabilities that ship in the CRM. Limited or Meta-gated tools are labeled honestly — never presented as unlimited magic.', href: '/security', icon: 'shield', imageUrl: '' },
              { type: 'card', title: 'Workflows first', text: 'Inbox, broadcasts, automation, and analytics are organized around daily operator jobs, not developer checklists.', href: '/products', icon: 'workflow', imageUrl: '' },
              { type: 'card', title: 'Editable storytelling', text: 'Super Admin CMS templates let you refine product pages, About content, and CTAs without redeploying the application.', href: '/contact', icon: 'form', imageUrl: '' }
            ]
          },
          {
            id: 'about-approach',
            title: 'How we approach customer communication',
            eyebrow: 'Approach',
            visible: true,
            preset: 'steps',
            align: 'left',
            background: 'default',
            padding: 'normal',
            mediaSide: 'none',
            summary: 'A practical path from first conversation to measurable campaigns.',
            ctaLabel: '',
            ctaHref: '',
            blocks: [
              { type: 'card', title: 'Connect WhatsApp properly', text: 'Embedded signup or coexistence for your Business number — with connection health that operators can verify.', href: '/features', icon: '', imageUrl: '' },
              { type: 'card', title: 'Engage with consent', text: 'Templates, segments, suppression, and shared inbox keep outbound and inbound work compliant and coordinated.', href: '/features/whatsapp-broadcasting', icon: '', imageUrl: '' },
              { type: 'card', title: 'Automate with handoff', text: 'Flows and AI assist where they help, then escalate to humans with context preserved.', href: '/features/whatsapp-automation', icon: '', imageUrl: '' },
              { type: 'card', title: 'Measure and retarget', text: 'Campaign results and retargeting audiences stay inside the same CRM — not a separate spreadsheet ritual.', href: '/features/whatsapp-analytics', icon: '', imageUrl: '' }
            ]
          },
          {
            id: 'about-values',
            title: 'Values we design around',
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
              { type: 'feature-item', title: 'Explore before signup', text: 'Public product pages explain the CRM; authentication unlocks live operations.', href: '/products', icon: 'megaphone', imageUrl: '' }
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
            ctaLabel: 'Create workspace',
            ctaHref: '/signup',
            blocks: [
              { type: 'paragraph', text: 'Browse products freely, then create a workspace when you are ready to connect WhatsApp and invite your team. Prefer a conversation first? Contact us.', emphasis: 'none' },
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
    ]
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
      useCasesSection,
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
        id: `${slug}-how`,
        title: 'Campaign workflow',
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
          { type: 'card', title: 'Build the audience', text: 'Start from contacts, saved segments, or campaign results — with suppression for opt-outs.', href: '/features/whatsapp-broadcasting', icon: '', imageUrl: '' },
          { type: 'card', title: 'Choose an approved template', text: 'Pick a template that matches your message category and personalize variables.', href: '/features/whatsapp-broadcasting', icon: '', imageUrl: '' },
          { type: 'card', title: 'Send and learn', text: 'Track delivery, reads, replies, and failures, then retarget from analytics when it makes sense.', href: '/features/whatsapp-analytics', icon: '', imageUrl: '' }
        ]
      },
      capabilitiesGrid,
      marketingFaqSection(slug, 'Policy-aware questions', [
        { q: 'Can I send promotional messages to any contact?', a: 'No. Marketing broadcasts require approved templates and audiences that meet WhatsApp opt-in expectations. The workspace surfaces suppression and consent signals — you remain responsible for list quality.' },
        { q: 'What about Marketing Messages (MM Lite)?', a: 'Some accounts can onboard to Meta Marketing Messages for optimized marketing sends. Availability is Meta-gated; the CRM documents status and blocks marketing paths when not onboarded.' }
      ]),
      useCasesSection,
      marketingCtaSection(slug, 'Launch your workspace to import audiences, sync templates, and run campaigns with operational controls.')
    ].filter(Boolean);
  } else if (slug === 'automation-platform') {
    sections = [
      sharedOverviewSplit,
      capabilitiesGrid,
      {
        id: `${slug}-how`,
        title: 'From bot to human handoff',
        eyebrow: 'How it works',
        visible: true,
        preset: 'columns',
        align: 'left',
        background: 'default',
        padding: 'normal',
        mediaSide: 'none',
        ctaLabel: '',
        ctaHref: '',
        blocks: [
          { type: 'paragraph', text: 'Automation Builder combines visual reply workflows, chatbot journeys, and native WhatsApp Flows. Delayed steps and template sends rely on the queue worker — keep it running in production.', emphasis: 'none' },
          { type: 'paragraph', text: 'When a customer needs a person, conversations land in the shared inbox with tags and history intact — automation augments agents instead of hiding them.', emphasis: 'none' }
        ]
      },
      marketingFaqSection(slug, 'Automation boundaries', [
        { q: 'Is this a marketplace of pre-built bot templates?', a: 'No. You build journeys in your workspace with triggers, conditions, and actions. It is CRM-owned graph UX — not a clone of every third-party template marketplace.' },
        { q: 'Do Flows work without Meta setup?', a: 'WhatsApp Flows require a connected WABA, published Flow assets, and live webhook delivery on your HTTPS app URL. Code readiness is not the same as Meta-verified production traffic.' }
      ]),
      useCasesSection,
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
        id: `${slug}-modules`,
        title: 'Two modules, one customer timeline',
        eyebrow: 'Modules',
        visible: true,
        preset: 'cards',
        align: 'left',
        background: 'muted',
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
      capabilitiesGrid,
      marketingFaqSection(slug, 'Meta-gated capabilities', [
        { q: 'Will CTWA ads work immediately after signup?', a: 'You need Facebook Login, an eligible ad account, a linked Page, and a WhatsApp number tied to your business. The Ads workspace lists blockers until assets connect.' },
        { q: 'Is in-chat checkout guaranteed?', a: 'No. Catalog, cart, and payment experiences depend on Meta commerce eligibility and regional support. Order support still runs through your inbox either way.' }
      ]),
      useCasesSection,
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
      ctaLabel: product.ctaLabel || 'Explore capabilities',
      ctaHref: (Array.isArray(product.features) && product.features[0]?.href) || '/features',
      image: 'hero',
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
    ctaLabel: options.overviewCtaLabel || 'See all features',
    ctaHref: options.overviewCtaHref || '/features',
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
      ctaLabel: 'Create workspace',
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

  return { ...document, products, pages };
}

export function migrateSiteDocument(input) {
  if (!input || typeof input !== 'object') return defaultDocument();
  if (Number(input.version) >= 2 && Array.isArray(input.pages)) {
    let next = { ...input };
    if (!Array.isArray(next.products) || !next.products.length) next.products = defaultProducts();
    if (!next.navigation?.some((item) => item.menuStyle === 'mega' || item.id === 'nav-products')) {
      const rest = (next.navigation || []).filter((item) => item.id !== 'nav-features' && item.label !== 'Features');
      next.navigation = [
        { id: 'nav-home', label: 'Home', href: '/', type: 'internal', menuStyle: 'link', description: '', icon: '', visible: true, openInNewTab: false, children: [] },
        buildProductsMegaNav(next.products),
        ...rest.filter((item) => item.id !== 'nav-home' && item.label !== 'Home')
      ];
    }
    for (const item of next.navigation || []) {
      if (item.id === 'nav-products' && (!item.href || item.href === '/features')) item.href = '/products';
    }
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
  // Upgrade flat "Features" nav into Products mega menu when products exist.
  if (!base.navigation?.some((item) => item.menuStyle === 'mega' || item.id === 'nav-products')) {
    const withoutFeatures = (base.navigation || []).filter((item) => item.id !== 'nav-features' && item.label !== 'Features');
    base.navigation = [
      { id: 'nav-home', label: 'Home', href: '/', type: 'internal', menuStyle: 'link', description: '', icon: '', visible: true, openInNewTab: false, children: [] },
      buildProductsMegaNav(base.products),
      ...withoutFeatures.filter((item) => item.id !== 'nav-home' && item.label !== 'Home')
    ];
  }
  base.version = Math.max(Number(base.version) || 2, 3);
  return base;
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
  const footer = {
    blurb: optional(footerIn.blurb, 400),
    columns: Array.isArray(footerIn.columns)
      ? footerIn.columns.slice(0, 4).map((column) => ({
        title: clean(column.title || 'Links', 40),
        links: Array.isArray(column.links)
          ? column.links.slice(0, 10).map((link) => ({
            label: clean(link.label, 60),
            href: String(link.href || '').startsWith('http') ? externalHttps(link.href) : localPath(link.href, false)
          }))
          : []
      }))
      : [],
    links: Array.isArray(footerIn.links)
      ? footerIn.links.slice(0, 12).map((link) => ({
        label: clean(link.label, 60),
        href: localPath(link.href, false)
      }))
      : [],
    socialLinks: Array.isArray(footerIn.socialLinks)
      ? footerIn.socialLinks.slice(0, 8).map((link) => ({
        label: clean(link.label, 40),
        href: externalHttps(link.href, false)
      }))
      : []
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
  publishedRoutes.add('/#pricing');
  for (const product of products) {
    if (product.slug) publishedRoutes.add(`/products/${product.slug}`);
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
