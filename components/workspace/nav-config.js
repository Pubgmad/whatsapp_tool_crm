export const managerViews = new Set([
  'setup',
  'templates',
  'automation',
  'campaigns',
  'commerce',
  'conversions',
  'calling',
  'ads',
  'flows',
  'media',
  'entry_points',
  'integrations',
  'journeys',
  'capabilities',
  'groups',
  'numbers',
  'profile',
  'catalog',
  'meta_analytics',
  'ai_agents',
  'bots',
  'onboarding'
]);

export const featureForView = {
  inbox: 'inbox',
  templates: 'templates',
  automation: 'automation',
  campaigns: 'campaigns',
  commerce: 'commerce',
  catalog: 'commerce',
  conversions: 'conversions',
  calling: 'calling',
  ads: 'ads',
  flows: 'whatsapp_flows',
  media: 'templates',
  entry_points: 'entry_points',
  // Integrations hosts connectors/crm/webviews/segments/API keys — panels gate themselves.
  // Do not bind the whole view to `automation` or entitled connector workspaces get blocked.
  journeys: 'automation',
  groups: 'whatsapp_groups',
  ai_agents: 'ai_agent',
  // Bots hub gates reply_bots / sheets_bot inside the panel (either entitlement is enough).
  onboarding: 'assisted_onboarding'
};

/** Default Simple Mode destinations (overridable via platform smb_simple_nav). */
export const SIMPLE_MODE_VIEWS = Object.freeze([
  'overview',
  'inbox',
  'contacts',
  'campaigns',
  'bots',
  'integrations',
  'results',
  'billing',
  'onboarding',
  'setup'
]);

/** Primary workspace routes (view id → pathname). */
export const workspaceRoutes = {
  overview: '/app/dashboard',
  setup: '/app/settings/whatsapp',
  numbers: '/app/settings/whatsapp/numbers',
  profile: '/app/settings/whatsapp/profile',
  flows: '/app/settings/whatsapp/flows',
  media: '/app/settings/whatsapp/media',
  entry_points: '/app/settings/whatsapp/entry-points',
  journeys: '/app/settings/whatsapp/journeys',
  capabilities: '/app/settings/whatsapp/capabilities',
  groups: '/app/settings/whatsapp/groups',
  integrations: '/app/settings/integrations',
  contacts: '/app/contacts',
  team: '/app/team',
  billing: '/app/settings/billing',
  security: '/app/settings/security',
  templates: '/app/templates',
  automation: '/app/automations',
  campaigns: '/app/campaigns',
  commerce: '/app/commerce',
  catalog: '/app/settings/whatsapp/catalog',
  meta_analytics: '/app/settings/whatsapp/analytics',
  conversions: '/app/conversions',
  calling: '/app/calling',
  ads: '/app/ads',
  results: '/app/analytics',
  inbox: '/app/inbox',
  unsubscribes: '/app/suppression',
  ai_agents: '/app/ai-agents',
  bots: '/app/bots',
  onboarding: '/app/onboarding'
};

/** Map setup subpaths to Setup() section ids (keeps existing panel components). */
export const setupSectionByView = {
  setup: 'connection',
  numbers: 'numbers',
  profile: 'profile',
  flows: 'flows',
  media: 'media',
  entry_points: 'entry_points',
  journeys: 'journeys',
  capabilities: 'capabilities',
  groups: 'groups',
  integrations: 'integrations',
  meta_analytics: 'analytics'
};

export const pageTitles = {
  overview: 'Workspace',
  setup: 'WhatsApp connection',

  numbers: 'Phone numbers',
  profile: 'Business profile',
  flows: 'WhatsApp Flows',
  media: 'Media library',
  entry_points: 'Entry points',
  journeys: 'Journeys',
  capabilities: 'Capabilities',
  groups: 'WhatsApp groups',
  integrations: 'Integrations',
  contacts: 'Audience',
  team: 'Team',
  billing: 'Billing',
  security: 'Security',
  templates: 'Templates',
  automation: 'Automation',
  campaigns: 'Broadcasts',
  commerce: 'Commerce',
  catalog: 'Catalog',
  meta_analytics: 'Meta insights',
  conversions: 'Conversions',
  calling: 'Calling',
  ads: 'CTWA Ads',
  results: 'Analytics',
  inbox: 'Inbox',
  unsubscribes: 'Suppression',
  ai_agents: 'AI Agents',
  bots: 'Bots',
  onboarding: 'Get started'
};

/** One-line captions under page titles (keep short for premium density). */
export const pageIntros = {
  overview: 'Workspace identity and WhatsApp connection status.',
  setup: 'Securely connect your WhatsApp Business account through Meta to start messaging.',

  numbers: 'Phone numbers linked to this workspace.',
  profile: 'Public WhatsApp business profile.',
  flows: 'Meta WhatsApp Flows — interactive in-chat forms (separate from Automation workflows).',
  media: 'Upload and manage Meta media assets for messaging.',
  entry_points: 'Links and QR codes into WhatsApp.',
  journeys: 'Recorded customer journey metrics for this workspace.',
  capabilities: 'Meta permission, asset, and feature readiness for this workspace.',
  groups: 'Group messaging when eligible.',
  integrations: 'API keys and partner connectors.',
  contacts: 'Audiences, consent, and segments.',
  team: 'Invite agents and manage workspace roles.',
  billing: 'Current plan, usage limits, and subscription billing.',
  security: 'Account multi-factor authentication and recovery codes.',
  templates: 'Meta-approved message templates.',
  automation: 'Create, test, and activate reply workflows for this workspace.',
  campaigns: 'Template campaigns and scheduling.',
  commerce: 'Catalogs and commerce settings.',
  catalog: 'Meta product catalogs, products, and catalog messaging settings.',
  meta_analytics: 'Meta Graph messaging and conversation snapshots.',
  conversions: 'Conversion signals from chats.',
  calling: 'WhatsApp calling with chat context.',
  ads: 'Click-to-WhatsApp campaigns, Meta assets, and entry conversation measurement.',
  results: 'Campaign delivery, entry sources, and retargeting for this workspace.',
  inbox: 'Shared conversations and agent replies.',
  unsubscribes: 'Opt-outs and suppressed contacts.',
  ai_agents: 'Configure assistants, knowledge, testing, and human handoff.',
  bots: 'Quick reply bots, Google Sheets brain, and links to AI Agents.',
  onboarding: 'Guided WhatsApp setup for nontechnical owners.'
};

/** Cross-feature journey strips removed — they recreated dashboard-style chrome. */
export const pageJourneys = {};

export function navGroupLabelForView(view) {
  const group = navGroups.find((entry) => entry.items.some((item) => item.id === view));
  return group?.label || 'Workspace';
}

export function pageIntro(view) {
  return pageIntros[view] || '';
}

export function pageJourney(view) {
  return pageJourneys[view] || null;
}

/**
 * Grouped sidebar IA. Icons are string keys resolved in the shell.
 * Setup-related items open dedicated routes that mount the existing Setup panels.
 */
export const navGroups = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { id: 'setup', label: 'Connection', icon: 'Link2' },
      { id: 'numbers', label: 'Numbers', icon: 'Smartphone' },
      { id: 'profile', label: 'Profile', icon: 'Building2' }
    ]
  },
  {
    id: 'communication',
    label: 'Communication',
    items: [
      { id: 'inbox', label: 'Inbox', icon: 'Inbox' },
      { id: 'calling', label: 'Calling', icon: 'PhoneCall' },
      { id: 'contacts', label: 'Audience', icon: 'UsersRound' }
    ]
  },
  {
    id: 'marketing',
    label: 'Marketing',
    items: [
      { id: 'campaigns', label: 'Broadcasting', icon: 'Send' },
      { id: 'templates', label: 'Templates', icon: 'MessageSquareText' },
      { id: 'ads', label: 'CTWA Ads', icon: 'RadioTower' },
      { id: 'entry_points', label: 'Entry points', icon: 'Link2' }
    ]
  },
  {
    id: 'automation',
    label: 'Automation & AI',
    items: [
      { id: 'bots', label: 'Bots', icon: 'Bot' },
      { id: 'automation', label: 'Automation', icon: 'Workflow' },
      { id: 'ai_agents', label: 'AI Agents', icon: 'Sparkles' },
      { id: 'flows', label: 'Flows', icon: 'Workflow' },
      { id: 'media', label: 'Media', icon: 'Paperclip' }
    ]
  },
  {
    id: 'getting_started',
    label: 'Getting started',
    items: [
      { id: 'onboarding', label: 'Get started', icon: 'Sparkles' }
    ]
  },
  {
    id: 'commerce',
    label: 'Commerce & integrations',
    items: [
      { id: 'commerce', label: 'Commerce', icon: 'ShoppingBag' },
      { id: 'catalog', label: 'Catalog', icon: 'ShoppingBag' },
      { id: 'integrations', label: 'Integrations', icon: 'KeyRound' }
    ]
  },
  {
    id: 'insights',
    label: 'Analytics & Insights',
    items: [
      { id: 'results', label: 'Analytics', icon: 'BarChart3' },
      { id: 'meta_analytics', label: 'Meta insights', icon: 'LineChart' },
      { id: 'conversions', label: 'Conversions', icon: 'Activity' },
      { id: 'journeys', label: 'Journeys', icon: 'Route' }
    ]
  },
  {
    id: 'readiness',
    label: 'Meta readiness',
    items: [
      { id: 'capabilities', label: 'Capabilities', icon: 'RadioTower' },
      { id: 'groups', label: 'Groups', icon: 'MessageSquare' }
    ]
  },
  {
    id: 'workspace_admin',
    label: 'Workspace',
    items: [
      { id: 'team', label: 'Team', icon: 'UserPlus' },
      { id: 'security', label: 'Security', icon: 'ShieldCheck' }
    ]
  },
  {
    id: 'subscriptions',
    label: 'Subscriptions',
    items: [
      { id: 'billing', label: 'Billing', icon: 'WalletCards' }
    ]
  },
  {
    id: 'compliance',
    label: 'Contact compliance',
    items: [
      { id: 'unsubscribes', label: 'Suppression', icon: 'Ban' }
    ]
  }
];

export const flatNavItems = navGroups.flatMap((group) => group.items);

/** Primary product-switcher entry for a view (keeps dropdown aligned with secondary tabs). */
export function productSwitcherIdForView(view, productIds = []) {
  if (productIds.includes(view)) return view;
  const group = navGroups.find((entry) => entry.items.some((item) => item.id === view));
  if (!group) return productIds[0] || 'setup';
  const hit = productIds.find((id) => group.items.some((item) => item.id === id));
  return hit || productIds[0] || 'setup';
}

export function canOpenWorkspaceView(role, view) {
  if (view === 'billing') return role === 'Owner';
  return !managerViews.has(view) || role === 'Owner' || role === 'Manager';
}

export function workspaceLocation(pathname) {
  if (pathname?.startsWith('/app/inbox/')) {
    return { view: 'inbox', conversationId: decodeURIComponent(pathname.slice('/app/inbox/'.length)) || null };
  }
  if (pathname === '/app/settings/integrations') {
    return { view: 'integrations', conversationId: null };
  }
  if (pathname?.startsWith('/app/settings/whatsapp')) {
    const rest = pathname.slice('/app/settings/whatsapp'.length).replace(/^\//, '');
    const map = {
      '': 'setup',
      numbers: 'numbers',
      profile: 'profile',
      flows: 'flows',
      media: 'media',
      'entry-points': 'entry_points',
      journeys: 'journeys',
      capabilities: 'capabilities',
      groups: 'groups',
      catalog: 'catalog',
      analytics: 'meta_analytics'
    };
    return { view: map[rest] || 'setup', conversationId: null };
  }
  const entry = Object.entries(workspaceRoutes).find(([, route]) => route === pathname);
  return { view: entry?.[0] || 'setup', conversationId: null };
}

export function pageTitle(view) {
  return pageTitles[view] || 'Workspace';
}
