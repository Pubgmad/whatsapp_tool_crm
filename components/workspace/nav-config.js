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
  'ai_agents'
]);

export const featureForView = {
  inbox: 'inbox',
  templates: 'templates',
  contacts: 'segments',
  automation: 'automation',
  campaigns: 'campaigns',
  commerce: 'commerce',
  conversions: 'conversions',
  calling: 'calling',
  ads: 'ads',
  flows: 'automation',
  media: 'templates',
  entry_points: 'campaigns',
  integrations: 'automation',
  journeys: 'automation',
  groups: 'inbox',
  ai_agents: 'ai_agent'
};

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
  conversions: '/app/conversions',
  calling: '/app/calling',
  ads: '/app/ads',
  results: '/app/analytics',
  inbox: '/app/inbox',
  unsubscribes: '/app/suppression',
  ai_agents: '/app/ai-agents'
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
  integrations: 'integrations'
};

export const pageTitles = {
  overview: 'Workspace',
  setup: 'Workspace',

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
  conversions: 'Conversions',
  calling: 'Calling',
  ads: 'CTWA Ads',
  results: 'Analytics',
  inbox: 'Inbox',
  unsubscribes: 'Suppression',
  ai_agents: 'AI Agents'
};

/** One-line captions under page titles (keep short for premium density). */
export const pageIntros = {
  overview: 'Workspace identity and WhatsApp connection status.',
  setup: 'Manage this workspace and connect WhatsApp through Meta.',

  numbers: 'Phone numbers linked to this workspace.',
  profile: 'Public WhatsApp business profile.',
  flows: 'Meta-hosted forms and intake flows.',
  media: 'Media assets for templates and messages.',
  entry_points: 'Links and QR codes into WhatsApp.',
  journeys: 'Customer journey analytics.',
  capabilities: 'Enabled WhatsApp capabilities.',
  groups: 'Group messaging when eligible.',
  integrations: 'API keys and partner connectors.',
  contacts: 'Audiences, consent, and segments.',
  team: 'Invite and manage workspace roles.',
  billing: 'Plan, invoices, and entitlements.',
  security: 'Password and account security.',
  templates: 'Meta-approved message templates.',
  automation: 'Trigger-based reply workflows.',
  campaigns: 'Template campaigns and scheduling.',
  commerce: 'Catalogs and commerce settings.',
  conversions: 'Conversion signals from chats.',
  calling: 'WhatsApp calling with chat context.',
  ads: 'Click-to-WhatsApp campaigns, Meta assets, and entry conversation measurement.',
  results: 'Delivery, engagement, and retargeting.',
  inbox: 'Shared conversations and agent replies.',
  unsubscribes: 'Opt-outs and suppressed contacts.',
  ai_agents: 'Knowledge-aware assistants, testing, and escalation rules.'
};

/** Optional next-step CTAs — short hints only. */
export const pageJourneys = {
  contacts: { label: 'Broadcast', target: 'campaigns', hint: 'Send to a filtered audience.' },
  templates: { label: 'Broadcast', target: 'campaigns', hint: 'Use an approved template.' },
  campaigns: { label: 'Analytics', target: 'results', hint: 'Review delivery and results.' },
  results: { label: 'Audience', target: 'contacts', hint: 'Build a retarget segment.' },
  // Keep journeys off Automation / Ads / Calling so those modules stay product-focused
  // instead of dashboard-style cross-links to Inbox.
  inbox: { label: 'Automation', target: 'automation', hint: 'Reduce repetitive replies.' },
  commerce: { label: 'Setup', target: 'setup', hint: 'Confirm number readiness.' },
  conversions: { label: 'Analytics', target: 'results', hint: 'Compare with campaigns.' },
  flows: { label: 'Automation', target: 'automation', hint: 'Use Flows in workflows.' },
  media: { label: 'Templates', target: 'templates', hint: 'Attach media headers.' },
  entry_points: { label: 'Broadcast', target: 'campaigns', hint: 'Follow up new chats.' }
};

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
      { id: 'setup', label: 'Workspace', icon: 'Building2' },
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
      { id: 'automation', label: 'Automation', icon: 'Bot' },
      { id: 'ai_agents', label: 'AI Agents', icon: 'Sparkles' },
      { id: 'flows', label: 'Flows', icon: 'Workflow' },
      { id: 'media', label: 'Media', icon: 'Paperclip' }
    ]
  },
  {
    id: 'commerce',
    label: 'Commerce & integrations',
    items: [
      { id: 'commerce', label: 'Commerce', icon: 'ShoppingBag' },
      { id: 'integrations', label: 'Integrations', icon: 'KeyRound' }
    ]
  },
  {
    id: 'insights',
    label: 'Insights & admin',
    items: [
      { id: 'results', label: 'Analytics', icon: 'BarChart3' },
      { id: 'conversions', label: 'Conversions', icon: 'Activity' },
      { id: 'journeys', label: 'Journeys', icon: 'Activity' },
      { id: 'capabilities', label: 'Capabilities', icon: 'RadioTower' },
      { id: 'groups', label: 'Groups', icon: 'MessageSquare' },
      { id: 'team', label: 'Team', icon: 'UserPlus' },
      { id: 'billing', label: 'Billing', icon: 'WalletCards' },
      { id: 'security', label: 'Security', icon: 'ShieldCheck' },
      { id: 'unsubscribes', label: 'Suppression', icon: 'Ban' }
    ]
  }
];

export const flatNavItems = navGroups.flatMap((group) => group.items);

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
      groups: 'groups'
    };
    return { view: map[rest] || 'setup', conversationId: null };
  }
  const entry = Object.entries(workspaceRoutes).find(([, route]) => route === pathname);
  return { view: entry?.[0] || 'setup', conversationId: null };
}

export function pageTitle(view) {
  return pageTitles[view] || 'Workspace';
}
