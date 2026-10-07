export const managerViews = new Set(['setup', 'templates', 'automation', 'campaigns', 'commerce', 'conversions', 'calling', 'ads']);

export const featureForView = {
  inbox: 'inbox',
  templates: 'templates',
  contacts: 'segments',
  automation: 'automation',
  campaigns: 'campaigns',
  commerce: 'commerce',
  conversions: 'conversions',
  calling: 'calling',
  ads: 'ads'
};

export const workspaceRoutes = {
  overview: '/app/dashboard',
  setup: '/app/settings/whatsapp',
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

export function canOpenWorkspaceView(role, view) {
  if (view === 'billing') return role === 'Owner';
  return !managerViews.has(view) || role === 'Owner' || role === 'Manager';
}
