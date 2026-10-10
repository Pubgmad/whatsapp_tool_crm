import { AppError } from './db.js';
import { DESIGN_HTML_MAX_CHARS, sanitizeDesignMarkup } from './public-site-html.js';

const PAGE_KINDS = new Set(['home', 'page', 'feature', 'product', 'about', 'contact', 'faq', 'pricing', 'legal', 'integrations', 'security']);
const SECTION_PRESETS = new Set(['plain', 'split-media', 'feature-grid', 'cards', 'cta-band', 'faq', 'stats', 'rich', 'columns']);
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
  return {
    id: clean(product.id || `product-${Math.random().toString(36).slice(2, 8)}`, 48),
    title: clean(product.title, 80, 'Products need a title.'),
    slug: slugValue(product.slug || product.title),
    summary: optional(product.summary, 240),
    href: product.href ? (String(product.href).startsWith('http') ? externalHttps(product.href) : localPath(product.href, false)) : '',
    icon: ICONS.has(product.icon || '') ? (product.icon || 'products') : 'products',
    visible: product.visible !== false,
    order: Number.isFinite(Number(product.order)) ? Number(product.order) : 100,
    features
  };
}

/** Build a Products mega-menu nav item from the product catalog. */
export function buildProductsMegaNav(products = []) {
  const visible = (Array.isArray(products) ? products : []).filter((product) => product.visible !== false).sort((a, b) => a.order - b.order);
  return {
    id: 'nav-products',
    label: 'Products',
    href: '/features',
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
      summary: 'Customer conversations, messaging and automation',
      href: '/features',
      icon: 'message',
      visible: true,
      order: 10,
      features: [
        { id: 'f-calling', title: 'WhatsApp Calling', summary: 'Voice context in your CRM timeline', href: '/features/whatsapp-calling', icon: 'phone', visible: true, order: 10 },
        { id: 'f-broadcast', title: 'WhatsApp Broadcasting', summary: 'Template campaigns at scale', href: '/features/whatsapp-broadcasting', icon: 'megaphone', visible: true, order: 20 },
        { id: 'f-retarget', title: 'WhatsApp Retargeting', summary: 'Re-engage audiences with intent', href: '/features/whatsapp-automation', icon: 'workflow', visible: true, order: 30 },
        { id: 'f-ai', title: 'AI Agents', summary: 'Assisted replies with human control', href: '/features/whatsapp-ai-agents', icon: 'spark', visible: true, order: 40 },
        { id: 'f-bots', title: 'Chatbot Automation', summary: 'Guided journeys that qualify leads', href: '/features/whatsapp-chatbots', icon: 'bot', visible: true, order: 50 }
      ]
    },
    {
      id: 'product-automation',
      title: 'Automation Platform',
      slug: 'automation-platform',
      summary: 'Automations, workflows and integrations',
      href: '/features/whatsapp-automation',
      icon: 'automation',
      visible: true,
      order: 20,
      features: [
        { id: 'f-flows', title: 'Flows & Forms', summary: 'Structured capture inside WhatsApp', href: '/features/whatsapp-flows', icon: 'form', visible: true, order: 10 },
        { id: 'f-auto', title: 'Event automation', summary: 'Trigger the right message at the right time', href: '/features/whatsapp-automation', icon: 'workflow', visible: true, order: 20 }
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
          title: 'Grow conversations that convert',
          subtitle: 'Run campaigns, chatbots, live inbox, and CRM workflows on WhatsApp — with Super Admin controlled product pages and branding.',
          ctaLabel: 'Create workspace',
          ctaHref: '/signup',
          image: 'hero',
          imageUrl: ''
        },
        sections: [
          {
            id: 'capabilities',
            title: 'Everything you need on WhatsApp',
            eyebrow: 'Capabilities',
            visible: true,
            preset: 'feature-grid',
            align: 'left',
            background: 'default',
            padding: 'normal',
            mediaSide: 'none',
            ctaLabel: 'Explore features',
            ctaHref: '/features',
            blocks: [
              { type: 'feature-item', title: 'Broadcasting', text: 'Send approved template campaigns to opted-in audiences with delivery insights.', href: '/features/whatsapp-broadcasting', icon: 'megaphone', imageUrl: '' },
              { type: 'feature-item', title: 'Automation & chatbots', text: 'Build guided journeys that qualify leads and answer common questions.', href: '/features/whatsapp-chatbots', icon: 'bot', imageUrl: '' },
              { type: 'feature-item', title: 'WhatsApp Calling', text: 'Connect voice follow-ups with the same customer timeline your team already uses.', href: '/features/whatsapp-calling', icon: 'phone', imageUrl: '' },
              { type: 'feature-item', title: 'AI agents', text: 'Assist agents with suggested replies and structured handoff into live chat.', href: '/features/whatsapp-ai-agents', icon: 'spark', imageUrl: '' }
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
          }
        ]
      },
      featurePage('whatsapp-calling', 'WhatsApp Calling', 'Connect voice conversations with your WhatsApp CRM timeline.', 'Place and manage calling workflows alongside chat history so teams never lose context.'),
      featurePage('whatsapp-broadcasting', 'WhatsApp Broadcasting', 'Launch template campaigns at scale.', 'Import audiences, send approved messages, and monitor delivery without leaving the workspace.'),
      featurePage('whatsapp-chatbots', 'WhatsApp Chatbots', 'Automate the first mile of every conversation.', 'Design guided flows that capture intent, qualify leads, and hand off to humans cleanly.'),
      featurePage('whatsapp-ai-agents', 'WhatsApp AI Agents', 'Assist your team with AI where it helps most.', 'Draft replies, summarize threads, and keep humans in control of customer outcomes.'),
      featurePage('whatsapp-automation', 'WhatsApp Automation', 'Trigger the right message at the right moment.', 'Connect events, tags, and journeys so follow-ups happen without manual chasing.'),
      featurePage('whatsapp-flows', 'WhatsApp Flows & Forms', 'Collect structured data inside WhatsApp.', 'Use forms and flows for lead capture, feedback, and operational intakes.'),
      {
        id: 'page-about',
        slug: 'about',
        title: 'About Us',
        kind: 'about',
        published: true,
        showInNav: true,
        navOrder: 40,
        seoTitle: 'About',
        seoDescription: 'About our WhatsApp Business CRM platform.',
        eyebrow: 'About',
        summary: 'We help teams run WhatsApp as a durable revenue and support channel.',
        layout: 'default',
        hero: { enabled: true, title: 'About the platform', subtitle: 'A production WhatsApp CRM with Super Admin controlled product storytelling.', ctaLabel: 'Contact us', ctaHref: '/contact', image: 'none', imageUrl: '' },
        sections: [
          {
            id: 'about-body',
            title: 'Why we built this',
            eyebrow: '',
            visible: true,
            preset: 'rich',
            align: 'left',
            background: 'default',
            padding: 'normal',
            mediaSide: 'none',
            ctaLabel: '',
            ctaHref: '',
            blocks: [
              { type: 'paragraph', text: 'Most WhatsApp tools stop at inbox utilities. Operators need campaigns, automation, calling context, governance, and a public site that explains the product clearly — all without shipping code for every copy change.', emphasis: 'none' }
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
        hero: { enabled: true, title: 'WhatsApp capabilities', subtitle: 'Broadcasting, automation, AI assistance, calling, flows, and integrations — managed as publishable pages.', ctaLabel: 'View pricing', ctaHref: '/#pricing', image: 'none', imageUrl: '' },
        sections: [
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
              { type: 'feature-item', title: 'WhatsApp Calling', text: 'Voice context inside your CRM timeline.', href: '/features/whatsapp-calling', icon: 'phone', imageUrl: '' },
              { type: 'feature-item', title: 'Broadcasting', text: 'Template campaigns with operational controls.', href: '/features/whatsapp-broadcasting', icon: 'megaphone', imageUrl: '' },
              { type: 'feature-item', title: 'Chatbots', text: 'No-code style journeys for common intents.', href: '/features/whatsapp-chatbots', icon: 'bot', imageUrl: '' },
              { type: 'feature-item', title: 'AI agents', text: 'Assisted replies with human control.', href: '/features/whatsapp-ai-agents', icon: 'spark', imageUrl: '' },
              { type: 'feature-item', title: 'Automation', text: 'Event-driven follow-ups that stay compliant.', href: '/features/whatsapp-automation', icon: 'workflow', imageUrl: '' },
              { type: 'feature-item', title: 'Flows & forms', text: 'Structured capture inside WhatsApp.', href: '/features/whatsapp-flows', icon: 'form', imageUrl: '' }
            ]
          }
        ]
      }
    ]
  };
}

function featurePage(slug, title, summary, body) {
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
    sections: [
      {
        id: `${slug}-overview`,
        title: 'What you can do',
        eyebrow: 'Overview',
        visible: true,
        preset: 'split-media',
        align: 'left',
        background: 'default',
        padding: 'normal',
        mediaSide: 'right',
        ctaLabel: 'See all features',
        ctaHref: '/features',
        blocks: [
          { type: 'paragraph', text: body, emphasis: 'none' },
          { type: 'list', text: 'Clear customer context\nTeam-ready workflows\nPublishable product storytelling from Super Admin', emphasis: 'none' },
          { type: 'image', asset: 'hero', href: '', alt: title, text: title, width: 'wide' }
        ]
      },
      {
        id: `${slug}-cta`,
        title: 'Ready to put this to work?',
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
          { type: 'paragraph', text: 'Launch your workspace and configure WhatsApp channels with operator-grade controls.', emphasis: 'none' }
        ]
      }
    ]
  };
}

/** Migrate legacy v1 {sections,footerLinks,socialLinks} into v2/v3 pages document. */
export function migrateSiteDocument(input) {
  if (!input || typeof input !== 'object') return defaultDocument();
  if (Number(input.version) >= 2 && Array.isArray(input.pages)) {
    const next = { ...input };
    if (!Array.isArray(next.products) || !next.products.length) next.products = defaultProducts();
    if (!next.navigation?.some((item) => item.menuStyle === 'mega' || item.id === 'nav-products')) {
      const rest = (next.navigation || []).filter((item) => item.id !== 'nav-features' && item.label !== 'Features');
      next.navigation = [
        { id: 'nav-home', label: 'Home', href: '/', type: 'internal', menuStyle: 'link', description: '', icon: '', visible: true, openInNewTab: false, children: [] },
        buildProductsMegaNav(next.products),
        ...rest.filter((item) => item.id !== 'nav-home' && item.label !== 'Home')
      ];
    }
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
