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
  'profile'
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
  groups: 'inbox'
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
  unsubscribes: '/app/suppression'
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
  overview: 'Command center',
  setup: 'WhatsApp connection',
  numbers: 'Phone numbers',
  profile: 'Business profile',
  flows: 'WhatsApp Flows',
  media: 'Media library',
  entry_points: 'Links and QR codes',
  journeys: 'Customer journeys',
  capabilities: 'Capabilities',
  groups: 'WhatsApp groups',
  integrations: 'Integrations',
  contacts: 'Audience',
  team: 'Team workspace',
  billing: 'Subscription and billing',
  security: 'Account security',
  templates: 'Template library',
  automation: 'Automation builder',
  campaigns: 'Broadcast campaigns',
  commerce: 'Commerce and catalogs',
  conversions: 'Conversions',
  calling: 'WhatsApp calling',
  ads: 'Click-to-WhatsApp ads',
  results: 'Campaign analytics',
  inbox: 'Shared inbox',
  unsubscribes: 'Suppression list'
};

/**
 * Grouped sidebar IA. Icons are string keys resolved in the shell.
 * Setup-related items open dedicated routes that mount the existing Setup panels.
 */
export const navGroups = [
  {
    id: 'engage',
    label: 'Engage',
    items: [
      { id: 'overview', label: 'Dashboard', icon: 'LayoutDashboard' },
      { id: 'inbox', label: 'Inbox', icon: 'Inbox' },
      { id: 'contacts', label: 'Audience', icon: 'UsersRound' },
      { id: 'calling', label: 'Calling', icon: 'PhoneCall' }
    ]
  },
  {
    id: 'grow',
    label: 'Grow',
    items: [
      { id: 'campaigns', label: 'Broadcasting', icon: 'Send' },
      { id: 'templates', label: 'Templates', icon: 'MessageSquareText' },
      { id: 'ads', label: 'CTWA Ads', icon: 'RadioTower' },
      { id: 'results', label: 'Analytics', icon: 'BarChart3' },
      { id: 'conversions', label: 'Conversions', icon: 'Activity' }
    ]
  },
  {
    id: 'build',
    label: 'Build',
    items: [
      { id: 'automation', label: 'Automation', icon: 'Bot' },
      { id: 'flows', label: 'Flows', icon: 'Workflow' },
      { id: 'commerce', label: 'Commerce', icon: 'ShoppingBag' },
      { id: 'entry_points', label: 'Entry points', icon: 'Link2' },
      { id: 'media', label: 'Media', icon: 'Paperclip' }
    ]
  },
  {
    id: 'connect',
    label: 'Connect',
    items: [
      { id: 'setup', label: 'WhatsApp setup', icon: 'Settings2' },
      { id: 'numbers', label: 'Numbers', icon: 'Smartphone' },
      { id: 'profile', label: 'Profile', icon: 'Building2' },
      { id: 'integrations', label: 'Integrations', icon: 'KeyRound' },
      { id: 'journeys', label: 'Journeys', icon: 'Activity' },
      { id: 'capabilities', label: 'Capabilities', icon: 'RadioTower' },
      { id: 'groups', label: 'Groups', icon: 'MessageSquare' }
    ]
  },
  {
    id: 'admin',
    label: 'Workspace',
    items: [
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
  return { view: entry?.[0] || 'overview', conversationId: null };
}

export function pageTitle(view) {
  return pageTitles[view] || 'Workspace';
}
