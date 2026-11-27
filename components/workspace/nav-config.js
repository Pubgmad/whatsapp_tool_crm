import { filterNavGroups, isReleaseViewAllowed } from '../../lib/release-feature-allowlist.js';

export const managerViews = new Set([
  'setup',
  'templates',
  'automation',
  'flows',
  'media',
  'entry_points',
  'integrations',
  'capabilities',
  'numbers',
  'profile',
  'ai_agents',
  'bots',
  'onboarding'
]);

export const featureForView = {
  inbox: 'inbox',
  templates: 'templates',
  automation: 'automation',
  campaigns: 'campaigns',
  segments: 'segments',
  flows: 'whatsapp_flows',
  media: 'templates',
  entry_points: 'entry_points',
  // Integrations hosts webhooks/API/calendar/sheets — panels gate themselves.
  ai_agents: 'ai_agent',
  // Bots hub gates reply_bots / sheets_bot inside the panel (either entitlement is enough).
  onboarding: 'assisted_onboarding'
};

/**
 * Default Simple Mode destinations (overridable via platform smb_simple_nav).
 * WhatsApp Automation release: connect → audience → templates → bots →
 * automation → broadcasts → inbox → analytics → billing/team.
 */
export const SIMPLE_MODE_VIEWS = Object.freeze([
  'onboarding',
  'setup',
  'inbox',
  'contacts',
  'segments',
  'templates',
  'bots',
  'automation',
  'campaigns',
  'results',
  'billing',
  'team',
  'security'
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
  capabilities: '/app/settings/whatsapp/capabilities',
  integrations: '/app/settings/integrations',
  contacts: '/app/contacts',
  segments: '/app/segments',
  team: '/app/team',
  billing: '/app/settings/billing',
  security: '/app/settings/security',
  templates: '/app/templates',
  automation: '/app/automations',
  campaigns: '/app/campaigns',
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
  capabilities: 'capabilities',
  integrations: 'integrations'
};

export const pageTitles = {
  overview: 'Workspace',
  setup: 'WhatsApp connection',
  numbers: 'Phone numbers',
  profile: 'Business profile',
  flows: 'WhatsApp Flows',
  media: 'Media library',
  entry_points: 'Entry points',
  capabilities: 'Connection readiness',
  integrations: 'Integrations',
  contacts: 'Contacts',
  segments: 'Segments',
  team: 'Team',
  billing: 'Billing',
  security: 'Security',
  templates: 'Templates',
  automation: 'Automation',
  campaigns: 'Broadcasts',
  results: 'Analytics',
  inbox: 'Inbox',
  unsubscribes: 'Suppression',
  ai_agents: 'AI Agents',
  bots: 'Reply bots',
  onboarding: 'Get started'
};

/** One-line captions under page titles (keep short for premium density). */
export const pageIntros = {
  overview: 'Workspace identity and WhatsApp connection status.',
  setup: 'Connect Meta when platform credentials are configured, or continue with offline drafts and setup.',
  numbers: 'Phone numbers linked to this workspace.',
  profile: 'Public WhatsApp business profile.',
  flows: 'Native WhatsApp Flows — interactive in-chat forms (Advanced Automation).',
  media: 'Upload and manage Meta media assets for messaging.',
  entry_points: 'WhatsApp links and QR codes for acquisition.',
  capabilities: 'Meta permission and asset readiness for this workspace.',
  integrations: 'API keys, webhooks, Google Sheets, Calendar, and automation connectors.',
  contacts: 'Store and manage WhatsApp contacts, tags, consent, and imports.',
  segments: 'Build reusable audiences from tags, consent, source, and engagement for broadcasts and automation.',
  team: 'Invite agents and manage workspace roles.',
  billing: 'Current plan, usage limits, and subscription billing.',
  security: 'Account multi-factor authentication and recovery codes.',
  templates: 'Draft and manage templates. Live Meta submit/sync requires a connected WhatsApp account.',
  automation: 'Build and save automation drafts offline. Live sends require a connected WhatsApp account.',
  campaigns: 'Draft and preview broadcasts offline. Live send/schedule requires Meta connection.',
  results: 'Campaign delivery, tracked links, and retargeting for this workspace.',
  inbox: 'Shared conversations, agent replies, and human handoff.',
  unsubscribes: 'Opt-outs and suppressed contacts.',
  ai_agents: 'Configure assistants, knowledge base, testing, and human handoff.',
  bots: 'Keyword auto-replies and Google Sheets answers — before Automation or AI.',
  onboarding: 'Guided WhatsApp Automation setup for your workspace.'
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
 * Grouped sidebar IA for WhatsApp Automation SaaS.
 * Customer journey: get started → connect → audience → message → automate → broadcast → inbox → measure → admin.
 */
const navGroupsRaw = [
  {
    id: 'getting_started',
    label: 'Getting started',
    items: [{ id: 'onboarding', label: 'Get started', icon: 'Sparkles' }]
  },
  {
    id: 'connection',
    label: 'Connection',
    items: [
      { id: 'setup', label: 'Connection', icon: 'Link2' },
      { id: 'numbers', label: 'Numbers', icon: 'Smartphone' },
      { id: 'profile', label: 'Profile', icon: 'Building2' },
      { id: 'capabilities', label: 'Readiness', icon: 'RadioTower' }
    ]
  },
  {
    id: 'audience',
    label: 'Audience',
    items: [
      { id: 'contacts', label: 'Contacts', icon: 'UsersRound' },
      { id: 'segments', label: 'Segments', icon: 'Filter' },
      { id: 'unsubscribes', label: 'Suppression', icon: 'Ban' }
    ]
  },
  {
    id: 'messaging',
    label: 'Messaging',
    items: [
      { id: 'templates', label: 'Templates', icon: 'MessageSquareText' },
      { id: 'media', label: 'Media', icon: 'Paperclip' },
      { id: 'entry_points', label: 'Entry points', icon: 'Link2' }
    ]
  },
  {
    id: 'automation',
    label: 'Automation',
    items: [
      { id: 'bots', label: 'Reply bots', icon: 'Bot' },
      { id: 'automation', label: 'Automation builder', icon: 'Workflow' },
      { id: 'ai_agents', label: 'AI Agents', icon: 'Sparkles' },
      { id: 'flows', label: 'WhatsApp Flows', icon: 'Workflow' }
    ]
  },
  {
    id: 'broadcasting',
    label: 'Broadcasting',
    items: [
      { id: 'campaigns', label: 'Campaigns', icon: 'Send' },
      { id: 'results', label: 'Analytics', icon: 'BarChart3' }
    ]
  },
  {
    id: 'inbox',
    label: 'Inbox',
    items: [{ id: 'inbox', label: 'Shared inbox', icon: 'Inbox' }]
  },
  {
    id: 'integrations',
    label: 'Integrations',
    items: [{ id: 'integrations', label: 'Integrations', icon: 'KeyRound' }]
  },
  {
    id: 'workspace_admin',
    label: 'Workspace',
    items: [
      { id: 'team', label: 'Team', icon: 'UserPlus' },
      { id: 'security', label: 'Security', icon: 'ShieldCheck' },
      { id: 'billing', label: 'Billing', icon: 'WalletCards' }
    ]
  }
];

export const navGroups = filterNavGroups(navGroupsRaw);

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
  if (!isReleaseViewAllowed(view)) return false;
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
      capabilities: 'capabilities'
    };
    const view = map[rest] || 'setup';
    return { view: isReleaseViewAllowed(view) ? view : 'setup', conversationId: null };
  }
  const entry = Object.entries(workspaceRoutes).find(([, route]) => route === pathname);
  const view = entry?.[0] || 'setup';
  return { view: isReleaseViewAllowed(view) ? view : 'setup', conversationId: null };
}

export function pageTitle(view) {
  return pageTitles[view] || 'Workspace';
}
