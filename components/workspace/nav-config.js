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
  ads: 'Ads Manager',
  results: 'Campaign analytics',
  inbox: 'Shared inbox',
  unsubscribes: 'Suppression list'
};

/** Short workspace guidance shown under the page title. */
export const pageIntros = {
  overview: 'Start from connection health, then jump into inbox, broadcasts, or ads.',
  setup: 'Connect WhatsApp Business, verify webhooks, and keep the workspace ready.',
  numbers: 'Review synced phone numbers and connection details for this workspace.',
  profile: 'Keep the public WhatsApp business profile accurate for customers.',
  flows: 'Build Meta-hosted forms for capture, booking, and structured intake.',
  media: 'Upload and reuse Meta media assets for templates and messages.',
  entry_points: 'Create links and QR codes that open WhatsApp conversations.',
  journeys: 'Inspect customer journey analytics across WhatsApp touchpoints.',
  capabilities: 'Review which WhatsApp capabilities are enabled for this account.',
  groups: 'Manage WhatsApp group messaging when the feature is enabled.',
  integrations: 'Connect API keys and partner integrations used by automation.',
  contacts: 'Filter audiences, manage consent, and prepare broadcast segments.',
  team: 'Invite teammates and assign Owner, Manager, or Agent roles.',
  billing: 'Manage subscription plan, invoices, and workspace entitlements.',
  security: 'Review account security and password recovery options.',
  templates: 'Sync Meta-approved templates before you broadcast or automate.',
  automation: 'Trigger replies and follow-ups from inbound WhatsApp events.',
  campaigns: 'Select audience → choose approved template → send or schedule → measure.',
  commerce: 'Manage catalogs and commerce settings tied to your WhatsApp number.',
  conversions: 'Track conversion signals connected to WhatsApp conversations.',
  calling: 'Place and manage WhatsApp calling alongside chat history.',
  ads: 'Create and manage Click-to-WhatsApp campaigns.',
  results: 'Review delivery, reads, and retarget opportunities from campaigns.',
  inbox: 'Assign conversations, reply with templates, and keep shared context.',
  unsubscribes: 'Honor opt-outs and suppress contacts from marketing sends.'
};

/** Contextual next-step CTAs for focused feature workspaces. */
export const pageJourneys = {
  contacts: { label: 'Open broadcasting', target: 'campaigns', hint: 'Filter your audience, then launch an approved template campaign.' },
  templates: { label: 'Open broadcasting', target: 'campaigns', hint: 'Keep templates synced, then use them in a broadcast.' },
  campaigns: { label: 'Open analytics', target: 'results', hint: 'After sending, review delivery and retarget from analytics.' },
  results: { label: 'Open audience', target: 'contacts', hint: 'Turn campaign outcomes into a retarget audience.' },
  inbox: { label: 'Open automation', target: 'automation', hint: 'Reduce repetitive replies with automation handoffs.' },
  automation: { label: 'Open inbox', target: 'inbox', hint: 'Confirm human handoff lands cleanly in the shared inbox.' },
  ads: { label: 'Open inbox', target: 'inbox', hint: 'CTWA clicks should appear as inbound conversations here.' },
  calling: { label: 'Open inbox', target: 'inbox', hint: 'Keep voice context next to the customer chat timeline.' },
  commerce: { label: 'Open WhatsApp setup', target: 'setup', hint: 'Commerce needs a connected number and catalog readiness.' },
  conversions: { label: 'Open analytics', target: 'results', hint: 'Pair conversion events with campaign performance.' },
  flows: { label: 'Open automation', target: 'automation', hint: 'Use Flows inside automated reply journeys.' },
  media: { label: 'Open templates', target: 'templates', hint: 'Attach uploaded media to template headers.' },
  entry_points: { label: 'Open broadcasting', target: 'campaigns', hint: 'Drive QR and link traffic into follow-up campaigns.' }
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
