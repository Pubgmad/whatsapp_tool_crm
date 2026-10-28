"use client";
import WhatsAppCommerce from './whatsapp-commerce';
import RazorpaySubscriptionActions from './razorpay-subscription-actions';
import AdvancedTemplateComposer from './advanced-template-composer';
import WhatsAppCalling from './whatsapp-calling';
import WhatsAppAds from './whatsapp-ads';
import WhatsAppConversions from './whatsapp-conversions';
import TemplateParameterFields from './template-parameter-fields';
import CampaignControls, {CampaignPolicy} from './campaign-controls';
import CoexistenceProgress from './coexistence-progress';
import WhatsAppEntryPoints from './whatsapp-entry-points';
import SupportPolicy from './support-policy';
import WhatsAppFlowDesigner from './whatsapp-flow-designer';
import WhatsAppJourneyAnalytics from './whatsapp-journey-analytics';
import NativeFlowWorkspace from './native-flow-workspace';
import WorkspaceIntegrations from './workspace-integrations';
import TrackedLinks from './tracked-links';
import ProviderConnectors from './provider-connectors';
import WhatsAppWebviews from './whatsapp-webviews';
import InboxSlaWidget from './inbox-sla-widget';
import WorkspaceResultsManagerShell from './workspace-results-manager-shell';
import { isWorkspaceManager } from '../lib/workspace-roles.ts';
import WhatsAppGroups from './whatsapp-groups';
import IntegrationMarketplace from './integration-marketplace';
import MmLiteOptimizerPanel from './mm-lite-optimizer-panel';
import HubSpotConnection from './hubspot-connection';
import CommerceOpsPanel from './commerce-ops-panel';
import AutomationAdvancedNodeFields from './automation-advanced-node-fields';
import AutomationConnections from './automation-connections';
import AutomationFlowCanvas from './automation-flow-canvas';
import AutomationLiveOpsPanel from './automation-live-ops-panel';
import { AUTOMATION_NODE_PALETTE } from '../lib/automation-canvas-layout.js';
import AudienceSegmentComposer from './audience-segment-composer';
import AudienceBulkTagsPanel from './audience-bulk-tags-panel';
import CampaignDripManager from './campaign-drip-manager';
import InboxContact360 from './inbox-contact-360';
import { summarizeAnalyticsPayload } from '../lib/whatsapp-analytics-summary.js';
import { acceptEmbeddedSignupMessage, buildEmbeddedSignupLoginOptions, createSignupAttempt, describeEmbeddedSignupFailure, reduceSignupAttempt, SIGNUP_WAIT_MS, signupSubmitPayload } from '../lib/embedded-signup-attempt.js';
import { campaignSourceLabel } from '../lib/campaign-source-labels.js';
import WhatsAppRetargetingPanel from './whatsapp-retargeting-panel';
import ApprovedTemplatePicker from './approved-template-picker';
import SearchableOptionPicker from './searchable-option-picker';
import AiSupportSettings from './ai-support-settings';
import ThemeToggle from './theme-toggle';
import { isSessionFailure, createRequestGate, authFormPasswordError } from '../lib/auth-navigation';
import { DEFAULT_POST_AUTH_PATH, DEFAULT_WORKSPACE_PATH, safeAuthReturnPath, withAuthReturn } from '../lib/auth-return.js';
import { PASSWORD_MIN_LENGTH, PASSWORD_POLICY_HINT } from '../lib/password-policy.js';
import { metaSdkCallback } from '../lib/meta-sdk-callback';
import { saveConversationDraft, clearSentConversationDraft, canApplySupportSuggestion } from '../lib/inbox-drafts';
import { planMarketingFeatures, WORKSPACE_FEATURES } from '../lib/plan-features.js';
import {
  canOpenWorkspaceView,
  featureForView,
  flatNavItems,
  navGroups,
  pageIntro as workspacePageIntro,
  pageTitle as workspacePageTitle,
  setupSectionByView,
  workspaceLocation,
  workspaceRoutes
} from './workspace/nav-config.js';

import { Children, cloneElement, isValidElement, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BadgeCheck, Ban, BarChart3, Bot, ChevronRight, CircleAlert, Download, FileText, Image, Inbox, LayoutDashboard,
  Eye, EyeOff, Loader2, LogOut, MessageSquare, MessageSquareText, PhoneCall, Plus, RefreshCcw, Send, Settings2,
  ShieldCheck, Sparkles, Trash2, Upload, UsersRound, X, Search, Clock3, Activity, CheckCheck, Copy, Link2, Pause, Play, Pencil, Save, StickyNote, Unplug, UserPlus, WalletCards,
  Smartphone, Workflow, RadioTower, Building2, KeyRound, ShoppingBag, Paperclip
} from "lucide-react";
const NAV_ICONS = {
  LayoutDashboard, Settings2, UsersRound, UserPlus, WalletCards, ShieldCheck, MessageSquareText, Bot, Send,
  ShoppingBag, Activity, PhoneCall, RadioTower, BarChart3, Inbox, Ban, Workflow, Paperclip, Link2, Smartphone,
  Building2, KeyRound, MessageSquare, Sparkles
};

const navItems = flatNavItems.map((item) => ({ ...item, icon: NAV_ICONS[item.icon] || LayoutDashboard }));

/** Primary products shown in the compact switcher (not a full CRM dashboard nav). */
const PRODUCT_SWITCHER_IDS = [
  'setup', 'inbox', 'campaigns', 'ads', 'automation', 'calling', 'ai_agents',
  'templates', 'contacts', 'results', 'commerce', 'integrations', 'team', 'billing', 'security'
];


let csrfToken = '';
const getCsrfToken = async () => {
  if (csrfToken) return csrfToken;
  const response = await fetch('/api/security/csrf', { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok || !payload.csrfToken) throw new Error(payload.error || 'Security initialization failed');
  csrfToken = payload.csrfToken;
  return csrfToken;
};

const api = async (path, options = {}) => {
  const { csrfRetry = false, ...requestOptions } = options;
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const securedOptions = !['GET', 'HEAD', 'OPTIONS'].includes(method) ? { ...requestOptions, headers: { 'Content-Type': 'application/json', ...(requestOptions.headers || {}), 'x-csrf-token': await getCsrfToken() } } : requestOptions;
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', headers: { "Content-Type": "application/json" }, ...securedOptions });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (payload.code === 'CSRF_INVALID' && !csrfRetry) { csrfToken = ''; return api(path, { ...requestOptions, csrfRetry: true }); }
    const error = new Error(payload.error || "Action failed");
    error.code = payload.code;
    throw error;
  }
  return payload;
};

const postJson = (path, body, method = "POST") => api(path, { method, body: JSON.stringify(body) });
const uploadForm = async (path, form, csrfRetry = false) => {
  const response = await fetch(path, { method: 'POST', headers: { 'x-csrf-token': await getCsrfToken() }, body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { if (payload.code === 'CSRF_INVALID' && !csrfRetry) { csrfToken = ''; return uploadForm(path, form, true); } const error = new Error(payload.error || "Upload failed"); error.code = payload.code; throw error; }
  return payload;
};
const formatTime = (iso) => iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never";
function connectionHealthMessage(health) {
  if (health?.reason === "authorization_invalid" || health?.reason === "scope_missing") return "WhatsApp access expired. Reconnect to keep messaging.";
  if (health?.reason === "authorization_expiring") return "WhatsApp access expires soon. Reconnect when convenient.";
  if (health?.reason === "webhook_unsubscribed") return "Message delivery checks need attention. Verify the connection.";
  if (health?.reason === "monitor_stale") return "Connection checks are delayed. Try Verify, or contact support.";
  if (health?.reason === "platform_configuration") return "WhatsApp connection needs attention. Contact support.";
  return "Connection check failed. Verify WhatsApp before sending campaigns.";
}
const emptyWorkspaceState = {
  contacts: [], audienceSegments: [], templates: [], campaigns: [], conversations: [],
  events: [], automationFlows: [], teamMembers: [], pagination: {},
  setup: { status: 'Needs setup', health: null },
  featureFlags: {},
  meta: {}
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function mergeWorkspaceState(current, incoming) {
  const merged = {
    ...emptyWorkspaceState,
    ...(current || {}),
    ...incoming,
    setup: { ...emptyWorkspaceState.setup, ...(current?.setup || {}), ...(incoming?.setup || {}) },
    featureFlags: { ...(current?.featureFlags || {}), ...(incoming?.featureFlags || {}) },
    meta: { ...(current?.meta || {}), ...(incoming?.meta || {}) },
    pagination: { ...(current?.pagination || {}), ...(incoming?.pagination || {}) }
  };
  // Hardening: APIs must never leave list fields as null/non-arrays (Inbox shell crash).
  merged.conversations = asArray(merged.conversations);
  merged.contacts = asArray(merged.contacts);
  merged.campaigns = asArray(merged.campaigns);
  merged.templates = asArray(merged.templates);
  merged.teamMembers = asArray(merged.teamMembers);
  merged.automationFlows = asArray(merged.automationFlows);
  merged.audienceSegments = asArray(merged.audienceSegments);
  merged.events = asArray(merged.events);
  merged.campaigns = asArray(merged.campaigns).map((campaign) => ({
    ...campaign,
    recipients: asArray(campaign?.recipients)
  }));
  if (merged.whatsappOperations) {
    const ops = merged.whatsappOperations;
    merged.whatsappOperations = {
      ...ops,
      accounts: asArray(ops.accounts),
      phoneNumbers: asArray(ops.phoneNumbers),
      nativeFlows: asArray(ops.nativeFlows),
      mediaAssets: asArray(ops.mediaAssets),
      capabilities: asArray(ops.capabilities),
      analytics: asArray(ops.analytics)
    };
  }
  return merged;
}

function stateUrl(view, { page = 1, messagePage = 1, notePage = 1, conversationId = "", inboxFilter = "", q = "" } = {}) {
  // Setup sub-routes (flows, media, numbers, …) share the Setup workspace panels;
  // load the existing setup section API instead of inventing missing section routes.
  const apiView = setupSectionByView[view] ? 'setup' : view;
  const params = new URLSearchParams({ page: String(page), messagePage: String(messagePage), notePage: String(notePage) });
  if (conversationId) params.set("conversationId", conversationId);
  if (inboxFilter) params.set("inboxFilter", inboxFilter);
  if (q) params.set("q", q);
  return `/api/workspace/${encodeURIComponent(apiView)}?${params}`;
}

function loadFacebookSdk(appId, version) {
  return new Promise((resolve, reject) => {
    const initialize = () => { window.FB.init({ appId, cookie: true, xfbml: false, version }); resolve(window.FB); };
    if (window.FB) { initialize(); return; }
    const existing = document.getElementById("facebook-jssdk");
    window.fbAsyncInit = initialize;
    if (!existing) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.onerror = () => reject(new Error("Meta sign-up could not be loaded."));
      document.body.appendChild(script);
    }
    window.setTimeout(() => { if (!window.FB) reject(new Error("Meta sign-up timed out. Check browser tracking protection and try again.")); }, 20000);
  });
}

const fallbackPlatform = {
  brand_name: "",
  product_tagline: "",
  company_name: "",
  workspace_intro: "",
  signin_heading: "",
  signin_copy: "",
  signup_heading: "",
  signup_copy: "",
  primary_cta_label: ""
};
function attributesFromText(value) {
  return String(value || "").split(/\r?\n/).reduce((result, row) => {
    const separator = row.indexOf("=");
    if (separator > 0) result[row.slice(0, separator).trim()] = row.slice(separator + 1).trim();
    return result;
  }, {});
}
const attributesToText = (value = {}) => Object.entries(value || {}).map(([key, item]) => `${key}=${item}`).join("\n");

function renderPreview(body, contact, values) {
  return String(body || "").replace(/{{\s*([\w.-]+)\s*}}/g, (_, key) => {
    if (key === "name") return contact?.name || "{{name}}";
    return values[key] || `{{${key}}}`;
  });
}

export default function WorkspaceApp({ initialView = "setup", initialConversationId = null, authMode = "", initialPlatform = null, children = null }) {
  const router = useRouter();
  const pathname = usePathname();
  const initialLocation = authMode ? { view: initialView, conversationId: initialConversationId } : workspaceLocation(pathname);
  const [state, setState] = useState(null);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(!authMode);
  const [configError, setConfigError] = useState("");
  const [bootstrapError, setBootstrapError] = useState(null);
  const [recoveryError, setRecoveryError] = useState("");
  const [activeView, setActiveView] = useState(initialLocation.view);
  const [activeConversationId, setActiveConversationId] = useState(initialLocation.conversationId);
  const [notice, setNotice] = useState("");
  const [platform, setPlatform] = useState({ ...fallbackPlatform, ...(initialPlatform || {}) });
  const [campaignRetarget, setCampaignRetarget] = useState(null);
  const [pages, setPages] = useState({});
  const [inboxSyncError, setInboxSyncError] = useState('');
  const [inboxSyncing, setInboxSyncing] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const scopeGate = useRef(null);
  const inboxRevisionRef = useRef(0);
  const bootstrappedPathRef = useRef('');
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  if (!scopeGate.current) scopeGate.current = createRequestGate();

  const approvedTemplates = useMemo(() => (state?.templates || []).filter((template) => template.status === "Approved"), [state]);
  const marketableContacts = useMemo(() => (state?.contacts || []).filter((contact) => contact.marketingPermission && !contact.unsubscribed), [state]);
  const suppressedContacts = useMemo(() => (state?.contacts || []).filter((contact) => contact.unsubscribed || !contact.marketingPermission), [state]);

  useEffect(() => { if (!authMode) bootstrap(); return () => scopeGate.current.invalidate(); }, []);
  useEffect(() => {
    if (authMode || !isSessionFailure(bootstrapError)) return;
    let active = true;
    const goToSignIn = () => { if (active) window.location.replace('/login?reauth=1'); };
    const fallback = window.setTimeout(goToSignIn, 3000);
    postJson('/api/auth/logout', {}).catch(() => {}).finally(() => {
      window.clearTimeout(fallback);
      goToSignIn();
    });
    return () => { active = false; window.clearTimeout(fallback); };
  }, [authMode, bootstrapError]);
  useEffect(() => {
    if (!account || authMode) return;
    api("/api/workspaces").then((result) => setWorkspaces(result.workspaces || [])).catch(() => setWorkspaces([]));
  }, [account?.user?.id, account?.business?.id, authMode]);
  useEffect(() => {
    if (authMode) return;
    const location = workspaceLocation(pathname);
    setActiveView(location.view);
    setActiveConversationId(location.conversationId);
  }, [authMode, pathname]);
  const notify = (message) => { if (!message) return; setNotice(message); setTimeout(() => setNotice(""), 2600); };

  const loadScope = useCallback(async (location = workspaceLocation(pathname), updatePlatform = true, overrides = {}) => {
    const forceApply = overrides.forceApply === true;
    const request = scopeGate.current.begin();
    const currentPages = pagesRef.current;
    const page = overrides.page || currentPages[location.view] || 1;
    const messagePage = overrides.messagePage || currentPages.messages || 1;
    const notePage = overrides.notePage || currentPages.notes || 1;
    const inboxFilter = overrides.inboxFilter ?? currentPages.inboxFilter ?? "";
    const inboxQ = overrides.inboxQ ?? currentPages.inboxQ ?? "";
    let nextState;
    try {
      nextState = await api(stateUrl(location.view, {
        page, messagePage, notePage, conversationId: location.conversationId || "", inboxFilter, q: inboxQ
      }));
    } catch (error) {
      if (forceApply || scopeGate.current.current(request)) throw error;
      return null;
    }
    // forceApply keeps post-connect refresh from being discarded by the 15s poll gate.
    if (!forceApply && !scopeGate.current.current(request)) return null;
    setState((current) => mergeWorkspaceState(current, nextState));
    if (location.view === 'inbox') {
      const appliedFilter = nextState.pagination?.inbox?.appliedFilter;
      if (appliedFilter) {
        setPages((current) => ({
          ...current,
          inboxFilter: appliedFilter,
          inboxQ: overrides.inboxQ ?? current.inboxQ ?? ''
        }));
      }
    }
    if (updatePlatform && nextState.platform) setPlatform((current) => ({ ...current, ...nextState.platform }));
    return nextState;
  }, [pathname]);

  const reloadInbox = useCallback(async ({ inboxFilter, inboxQ, page = 1 } = {}) => {
    const location = workspaceLocation(pathname);
    const nextFilter = inboxFilter ?? pagesRef.current.inboxFilter ?? "";
    const nextQ = inboxQ ?? pagesRef.current.inboxQ ?? "";
    setPages((current) => ({ ...current, inbox: page, inboxFilter: nextFilter, inboxQ: nextQ }));
    setInboxSyncing(true);
    try {
      await loadScope(location, false, { page, inboxFilter: nextFilter, inboxQ: nextQ });
      setInboxSyncError('');
    } catch (error) {
      setInboxSyncError(error.message || 'Inbox could not be refreshed.');
      notify(error.message);
    } finally {
      setInboxSyncing(false);
    }
  }, [pathname, loadScope]);

  useEffect(() => {
    if (!account || authMode) return;
    const location = workspaceLocation(pathname);
    // Bootstrap already loaded this path — avoid a competing scopeGate begin() that
    // can discard the first paint's state and leave Overview mid-render incomplete.
    if (bootstrappedPathRef.current === pathname) {
      bootstrappedPathRef.current = '';
      return;
    }
    if (location.view === "inbox") setPages((current) => ({ ...current, messages: 1, notes: 1 }));
    loadScope(location, true, location.view === "inbox" ? { messagePage: 1, notePage: 1 } : {})
      .then(result => { if (result) setBootstrapError(null); })
      .catch((error) => {
        if (isSessionFailure(error)) setAccount(null);
        setBootstrapError(error);
      });
  }, [account, authMode, pathname, loadScope]);

  useEffect(() => {
    if (!account) return undefined;
    let cancelled = false;
    let timer = 0;
    const controller = new AbortController();
    const poll = async () => {
      if (cancelled || document.visibilityState !== "visible") {
        timer = window.setTimeout(poll, 5000);
        return;
      }
      const location = workspaceLocation(window.location.pathname);
      try {
        if (location.view === "inbox") {
          const conversationId = location.conversationId || "";
          const query = new URLSearchParams({ since: String(inboxRevisionRef.current || 0) });
          if (conversationId) query.set("conversationId", conversationId);
          const response = await fetch(`/api/workspace/inbox/stream?${query}`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" }
          });
          const revision = await response.json().catch(() => ({}));
          if (!response.ok) throw Object.assign(new Error(revision.error || "Inbox sync failed"), { code: revision.code });
          if (revision?.revision != null) inboxRevisionRef.current = Number(revision.revision) || 0;
          if (!cancelled && revision?.changed) await loadScope(location, false);
        } else {
          await loadScope(location, false);
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (isSessionFailure(error)) { setBootstrapError(error); setAccount(null); return; }
      }
      if (!cancelled) timer = window.setTimeout(poll, location.view === "inbox" ? 2500 : 15000);
    };
    timer = window.setTimeout(poll, 1000);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [account, pathname, loadScope]);

  const bootstrap = async () => {
    const request = scopeGate.current.begin();
    let verifiedAccount = null;
    try {
      setLoading(true);
      setBootstrapError(null);
      setRecoveryError("");
      const publicConfig = await api("/api/platform").catch(() => ({ platform: fallbackPlatform }));
      setPlatform({ ...fallbackPlatform, ...(publicConfig.platform || {}) });
      const me = await api("/api/me");
      verifiedAccount = me;
      const location = authMode ? { view: "setup", conversationId: "" } : workspaceLocation(pathname);
      const nextState = await api(stateUrl(location.view, { conversationId: location.conversationId || "" }));
      if (!scopeGate.current.current(request)) return;
      bootstrappedPathRef.current = pathname;
      setState(mergeWorkspaceState(null, nextState));
      setAccount(me);
      setPlatform({ ...fallbackPlatform, ...(nextState.platform || publicConfig.platform || {}) });
      setConfigError("");
    } catch (error) {
      if (!scopeGate.current.current(request)) return;
      bootstrappedPathRef.current = '';
      setState(null);
      if (isSessionFailure(error)) setAccount(null);
      else if (verifiedAccount) setAccount(verifiedAccount);
      setBootstrapError(error);
      if (["DB_NOT_CONFIGURED", "AUTH_NOT_CONFIGURED"].includes(error.code)) setConfigError(error.message);
    } finally {
      if (scopeGate.current.current(request)) setLoading(false);
    }
  };

  const refresh = async () => {
    try { await loadScope(); }
    catch (error) { notify(error.message); if (isSessionFailure(error)) { setBootstrapError(error); setAccount(null); } }
  };

  const mutate = async (promise, message) => {
    try {
      await promise;
      await loadScope(workspaceLocation(pathname), true, { forceApply: true });
      notify(message);
      return true;
    } catch (error) {
      notify(error.message);
      return false;
    }
  };

  const changePage = async (key, page) => {
    const nextPage = Math.max(1, page);
    const location = workspaceLocation(pathname);
    const overrides = key === "messages" ? { messagePage: nextPage } : key === "notes" ? { notePage: nextPage } : { page: nextPage };
    setPages((current) => ({ ...current, [key]: nextPage, ...(["messages", "notes"].includes(key) ? {} : { [location.view]: nextPage }) }));
    try { await loadScope(location, false, overrides); }
    catch (error) { notify(error.message); }
  };

  const logout = async () => {
    try {
      await postJson("/api/auth/logout", {});
      scopeGate.current.invalidate();
      setAccount(null);
      setState(null);
      window.location.replace('/login');
    } catch (error) {
      setRecoveryError(error.message || 'Sign out failed. Try again.');
      notify(error.message);
    }
  };

  const selectWorkspace = async (event) => {
    const businessId = event.target.value;
    if (businessId === account.business.id) return;
    try {
      await postJson("/api/workspaces", { businessId });
      const current = typeof window !== 'undefined' ? window.location.pathname : '';
      const stay = current.startsWith('/app/') ? current : DEFAULT_WORKSPACE_PATH;
      window.location.assign(stay);
    } catch (error) {
      event.target.value = account.business.id;
      notify(error.message);
    }
  };

  const navigate = (view) => {
    const route = workspaceRoutes[view];
    if (!route) return;
    if (featureForView[view] && state?.featureFlags?.[featureForView[view]] === false) {
      // Stay on an upgrade explanation for the locked view — do not silently bounce to Billing.
      setActiveView(view);
      router.push(route);
      return;
    }
    setActiveView(view);
    router.push(route);
  };

  const openConversation = (conversationId) => {
    setActiveConversationId(conversationId);
    setPages((current) => ({ ...current, messages: 1, notes: 1 }));
    router.push(`/app/inbox/${encodeURIComponent(conversationId)}`);
  };

  if (loading) return <main className="loading"><Sparkles size={32} /><p>Loading workspace</p></main>;
  if (configError) return <SystemSetup message={configError} platform={platform} />;
  if (!authMode && isSessionFailure(bootstrapError)) return <main className='loading'><Loader2 className='spin' size={30} /><p>Opening sign in</p></main>;
  if (account && !state && bootstrapError) return <main className='loading errorLoading'><CircleAlert size={32} /><p>Workspace could not be loaded</p><span>{bootstrapError.message || 'The server returned an unexpected response.'}</span><button className='primaryAction' type='button' onClick={bootstrap}>Retry</button></main>;
  if (!account && !authMode && bootstrapError && !isSessionFailure(bootstrapError)) return <main className='loading errorLoading'><CircleAlert size={32} /><p>Workspace could not be loaded</p><span>{bootstrapError.message || 'The server returned an unexpected response.'}</span><button className='primaryAction' type='button' onClick={bootstrap}>Retry</button></main>;
  if (!account && authMode) {
    return (
      <Suspense fallback={<main className="loading"><Loader2 className="spin" size={30} /><p>Opening sign in</p></main>}>
        <AuthScreen
          onDone={(nextPath) => window.location.replace(safeAuthReturnPath(nextPath, DEFAULT_POST_AUTH_PATH))}
          platform={platform}
          initialMode={authMode}
          onModeChange={(mode, nextPath) => {
            const base = mode === "signup" ? "/signup" : "/login";
            router.push(withAuthReturn(base, nextPath));
          }}
        />
      </Suspense>
    );
  }
  if (!account) return <main className="loading"><Loader2 className="spin" size={30} /><p>Opening sign in</p></main>;
  if (authMode) return <main className="loading"><Loader2 className="spin" size={30} /><p>Opening workspace</p></main>;
  if (!state) return <main className="loading"><Sparkles size={32} /><p>Preparing workspace</p></main>;

  const conversations = asArray(state.conversations);
  const contacts = asArray(state.contacts);
  const campaigns = asArray(state.campaigns);
  const activeConversation = activeConversationId
    ? conversations.find((conversation) => conversation.id === activeConversationId) || null
    : conversations[0] || null;
  const activeContact = activeConversation ? contacts.find((contact) => contact.id === activeConversation.contactId) || null : null;
  const latestCampaign = campaigns[0];
  const platformConfig = { ...platform, ...(state.platform || {}) };
  // Always hit the setup API section so heal + whatsappOperations run after connect.
  const reloadSetup = () => loadScope({ view: 'setup', conversationId: '' }, true, { forceApply: true });
  const applyWhatsAppConnection = (connection) => {
    // Pending only — never forge Connected / saved-token-hidden before the setup GET confirms credentials.
    if (!connection?.wabaId || !connection?.phoneNumberId) return;
    setState((current) => mergeWorkspaceState(current, {
      setup: {
        ...(current?.setup || {}),
        wabaId: connection.wabaId,
        phoneNumberId: connection.phoneNumberId,
        whatsappNumber: connection.whatsappNumber || current?.setup?.whatsappNumber || '',
        onboardingMethod: connection.onboardingMode === 'coexistence' ? 'coexistence' : 'embedded_signup',
        webhookSubscribed: connection.webhookSubscribed === true,
        tokenExpiresAt: connection.tokenExpiresAt || current?.setup?.tokenExpiresAt || null
      }
    }));
  };
  const clearWhatsAppConnection = () => {
    setState((current) => mergeWorkspaceState(current, {
      setup: {
        ...(current?.setup || {}),
        status: 'Needs setup',
        wabaId: '',
        phoneNumberId: '',
        whatsappNumber: '',
        accessToken: '',
        webhookSubscribed: false,
        tokenExpiresAt: null
      },
      meta: { ...(current?.meta || {}), liveMetaReady: false },
      whatsappOperations: {
        ...(current?.whatsappOperations || {}),
        accounts: [],
        phoneNumbers: []
      }
    }));
  };
  const screenProps = { state, mutate, notify, changePage, reloadInbox, reloadSetup, applyWhatsAppConnection, clearWhatsAppConnection, setActiveView: navigate, approvedTemplates, marketableContacts, suppressedContacts, latestCampaign, activeConversation, activeContact, openConversation, platform: platformConfig, role: account.role, campaignRetarget, setCampaignRetarget, inboxFilter: pages.inboxFilter || state?.pagination?.inbox?.appliedFilter || "", inboxQ: pages.inboxQ || "", inboxSyncError, inboxSyncing };

  const productOptions = PRODUCT_SWITCHER_IDS
    .map((id) => navItems.find((item) => item.id === id))
    .filter(Boolean)
    .filter((item) => canOpenWorkspaceView(account.role, item.id) && (!featureForView[item.id] || state.featureFlags?.[featureForView[item.id]] !== false))
    .filter((item) => item.id !== 'groups' || state.featureFlags?.whatsapp_groups);
  const activeGroup = navGroups.find((group) => group.items.some((item) => item.id === activeView));
  const secondaryItems = (activeGroup?.items || [])
    .map((item) => navItems.find((entry) => entry.id === item.id))
    .filter(Boolean)
    .filter((item) => canOpenWorkspaceView(account.role, item.id) && (!featureForView[item.id] || state.featureFlags?.[featureForView[item.id]] !== false))
    .filter((item) => item.id !== 'groups' || state.featureFlags?.whatsapp_groups);
  const isMetaSetup = activeView === 'setup' || Boolean(setupSectionByView[activeView]);
  const pageHeading = activeView === 'setup' ? 'WhatsApp connection' : workspacePageTitle(activeView);

  return (
    <main className={`productShell${isMetaSetup ? ' metaFocusShell' : ''}`}>
      <header className="productTopBar">
        <div className="productBrand">
          <div className="brandIcon">{platformConfig.logo_url ? <img src={platformConfig.logo_url} alt="" className="platformLogo" /> : <PhoneCall size={18} />}</div>
          <div>
            <strong>{platformConfig.brand_name}</strong>
            <span>{account.business.name}</span>
          </div>
        </div>
        <label className="productSwitcher">
          <span className="srOnly">Product</span>
          <select
            value={productOptions.some((item) => item.id === activeView) ? activeView : (productOptions[0]?.id || 'setup')}
            onChange={(event) => navigate(event.target.value)}
            aria-label="Switch product"
          >
            {productOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        {workspaces.length > 1 ? (
          <label className="productWorkspaceSelect">
            <span className="srOnly">Workspace</span>
            <select value={account.business.id} onChange={selectWorkspace} aria-label="Switch workspace">
              {workspaces.map((item) => (
                <option key={item.id} value={item.id} disabled={item.status === 'suspended'}>
                  {item.name}{item.status === 'suspended' ? ' (suspended)' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="productTopActions">
          <span className={`statusPill ${(state.setup?.status || 'Needs setup') === 'Connected' && Boolean(state.meta?.liveMetaReady) ? 'good' : 'warn'}`}>{(state.setup?.status || 'Needs setup') === 'Connected' && Boolean(state.meta?.liveMetaReady) ? 'Connected' : 'Needs setup'}</span>
          <button className="iconButton" type="button" title="Refresh" onClick={refresh}><RefreshCcw size={18} /></button>
          <details className="productProfileMenu">
            <summary aria-label="Account menu">{account.user.email?.split('@')[0] || 'Profile'}</summary>
            <div className="productProfilePanel" role="menu">
              <button type="button" role="menuitem" onClick={() => navigate('setup')}>WhatsApp setup</button>
              <button type="button" role="menuitem" onClick={() => navigate('security')}>Security</button>
              {canOpenWorkspaceView(account.role, 'billing') ? <button type="button" role="menuitem" onClick={() => navigate('billing')}>Billing</button> : null}
              <button type="button" role="menuitem" onClick={logout}><LogOut size={15} /> Sign out</button>
            </div>
          </details>
        </div>
      </header>
      {secondaryItems.length > 1 ? (
        <nav className="productSecondaryNav" aria-label={`${activeGroup?.label || 'Feature'} sections`}>
          {secondaryItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" className={activeView === item.id ? 'active' : ''} onClick={() => navigate(item.id)}>
                <Icon size={16} /><span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      ) : null}
      <section className="workspace productWorkspace">
        <header className="productPageHead">
          <div>
            <p className="kicker">{isMetaSetup ? 'WhatsApp' : (activeGroup?.label || 'Product')}</p>
            <h1>{pageHeading}</h1>
            {workspacePageIntro(activeView) ? <p className="pageIntro">{workspacePageIntro(activeView)}</p> : null}
          </div>
        </header>
        {notice && <div className="toast">{notice}</div>}
        {['degraded', 'reconnect_required'].includes(state.setup?.health?.status) && (
          <div className="connectionAlert" role="alert">
            <CircleAlert size={19} />
            <span>{connectionHealthMessage(state.setup?.health)}</span>
            {canOpenWorkspaceView(account.role, 'setup') && (
              <button className="secondaryAction" type="button" onClick={() => navigate('setup')}>Reconnect WhatsApp</button>
            )}
          </div>
        )}
        {featureForView[activeView] && state.featureFlags?.[featureForView[activeView]] === false ? (
          <UpgradeRequiredPanel
            planName={state.subscription?.plan?.name || state.plan?.name || 'your current plan'}
            featureKey={featureForView[activeView]}
            role={account.role}
            onBilling={() => navigate('billing')}
            onSetup={() => navigate('setup')}
          />
        ) : (
          <Screens activeView={activeView} setupSection={setupSectionByView[activeView] || null} {...screenProps} />
        )}
        {children}
      </section>
    </main>
  );
}

function AuthScreen({ onDone, platform, initialMode = "signin", onModeChange }) {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState(initialMode);
  const [error, setError] = useState("");
  const [verificationDeliveryFailed, setVerificationDeliveryFailed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [googleMfaPending, setGoogleMfaPending] = useState(false);
  const [prefillEmail, setPrefillEmail] = useState("");
  const isSignup = mode === "signup";
  const googleLoginEnabled = Boolean(platform?.google_login_enabled);
  // Sign-in without a feature destination returns to the public site.
  // Sign-up (Create workspace) continues into Meta / workspace connection.
  const returnPath = safeAuthReturnPath(
    searchParams.get("next"),
    isSignup ? DEFAULT_WORKSPACE_PATH : DEFAULT_POST_AUTH_PATH
  );
  useEffect(() => { setHydrated(true); }, []);
  useEffect(() => { setMode(initialMode); }, [initialMode]);
  useEffect(() => {
    const authError = searchParams.get("auth_error") || searchParams.get("error");
    if (authError) setError(authError);
    if (searchParams.get("mfa_required") === "1") {
      setGoogleMfaPending(true);
      setMfaRequired(true);
      const email = searchParams.get("email");
      if (email) setPrefillEmail(email);
    }
  }, [searchParams]);

  const switchMode = () => {
    if (pending) return;
    setError("");
    setVerificationDeliveryFailed(false);
    setShowPassword(false);
    setShowConfirm(false);
    setGoogleMfaPending(false);
    setMfaRequired(false);
    const nextMode = isSignup ? "signin" : "signup";
    setMode(nextMode);
    onModeChange?.(nextMode, returnPath);
  };

  const finishAuth = async () => {
    await onDone(returnPath);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setVerificationDeliveryFailed(false);
    const rawForm = Object.fromEntries(new FormData(event.currentTarget));
    if (googleMfaPending) {
      const mfaCode = rawForm.mfaCode;
      setPending(true);
      try {
        await postJson("/api/auth/google/mfa", { mfaCode });
        await finishAuth();
      } catch (err) {
        setError(err.message);
      } finally {
        setPending(false);
      }
      return;
    }
    const form = { ...rawForm, email: rawForm.workspaceEmail, password: rawForm.workspacePassword };

    if (isSignup && form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    const passwordError = authFormPasswordError(form.password, mode);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    delete form.confirmPassword;
    delete form.workspaceEmail;
    delete form.workspacePassword;
    setPending(true);
    try {
      const result = await postJson(isSignup ? '/api/auth/register' : '/api/auth/login', form);
      if (result.verificationRequired) { setVerificationDeliveryFailed(Boolean(result.deliveryFailed)); setError(result.deliveryFailed ? 'Your account was created, but verification email could not be sent. Request a new link when delivery is available.' : 'Check your email and verify the account before signing in.'); return; }
      await finishAuth();
    } catch (err) {
      if (err.code === 'MFA_REQUIRED') setMfaRequired(true);
      if (err.code === 'EMAIL_NOT_VERIFIED') setVerificationDeliveryFailed(true);
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  const googleStartHref = withAuthReturn(`/api/auth/google/start?mode=${isSignup ? "signup" : "signin"}`, returnPath);

  return (
    <main className="authShell">
      <div className="authThemeToggle"><ThemeToggle /></div>
      <section className="authPanel authPanelPro">
        <div className="brandBlock dark authBrand">
          <div className="brandIcon">{platform.logo_url ? <img src={platform.logo_url} alt="" className="platformLogo" /> : <PhoneCall size={22} />}</div>
          <div><strong>{platform.brand_name}</strong><span>{platform.product_tagline}</span></div>
        </div>
        <div className="authHeader">
          <p className="kicker">Secure workspace</p>
          <h1>{googleMfaPending ? "Confirm sign-in" : isSignup ? platform.signup_heading : platform.signin_heading}</h1>
          <p>{googleMfaPending ? "Enter your authenticator code to finish Google sign-in." : isSignup ? platform.signup_copy : platform.signin_copy}</p>
        </div>
        {!googleMfaPending && (
          <ul className="authBenefits" aria-label="Platform benefits">
            <li>Official WhatsApp Business API workspace for your team</li>
            <li>Broadcasts, inbox, automation, and ads in one place</li>
            <li>Connect your own WhatsApp number after signup</li>
          </ul>
        )}
        <form className="formGrid authForm" method="post" onSubmit={submit}>
          {googleMfaPending ? (
            <>
              <Input name="workspaceEmail" label="Email" type="email" autoComplete="email" defaultValue={prefillEmail} readOnly />
              <Input name="mfaCode" label="Authenticator or recovery code" autoComplete="one-time-code" required />
            </>
          ) : (
            <>
              {isSignup && <>
                <Input name="name" label="Your name" autoComplete="name" required />
                <Input name="businessName" label="Business name" autoComplete="organization" required />
              </>}
              <Input name="workspaceEmail" label="Email" type="email" autoComplete="email" defaultValue={prefillEmail} required />
              <PasswordField name="workspacePassword" label="Password" visible={showPassword} onToggle={() => setShowPassword((value) => !value)} autoComplete={isSignup ? "new-password" : "current-password"} required enforcePolicy={isSignup} hint={isSignup ? PASSWORD_POLICY_HINT : undefined} />
              {mfaRequired && !isSignup && <Input name="mfaCode" label="Authenticator or recovery code" autoComplete="one-time-code" required />}
              {isSignup && <PasswordField name="confirmPassword" label="Confirm password" visible={showConfirm} onToggle={() => setShowConfirm((value) => !value)} autoComplete="new-password" required enforcePolicy />}
            </>
          )}
          {error && <div className="formError" role="alert">{error}</div>}
          {verificationDeliveryFailed && <a className="textButton authHelpLink" href="/resend-verification">Request verification email</a>}
          <button className="primaryAction authSubmit" type="submit" disabled={!hydrated || pending}>
            {pending ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}
            <span>{pending ? "Please wait" : googleMfaPending ? "Complete sign-in" : isSignup ? "Create account" : "Sign in"}</span>
          </button>
          {!googleMfaPending && !isSignup && (
            <div className="authHelpLinks"><a className="textButton authHelpLink" href="/forgot-password">Forgot password?</a></div>
          )}
        </form>
        {googleLoginEnabled && !googleMfaPending && (
          <>
            <p className="authDivider" aria-hidden="true"><span>or</span></p>
            <a className="secondaryAction authSubmit authGoogleButton" href={googleStartHref}>
              Continue with Google
            </a>
          </>
        )}
        {!googleMfaPending && (
          <div className="authSwitch">
            <span>{isSignup ? "Already have a workspace?" : "New workspace?"}</span>
            <button className="textButton" type="button" onClick={switchMode}>{isSignup ? "Sign in" : "Create account"}</button>
          </div>
        )}
      </section>
    </main>
  );
}
function SystemSetup({ message, platform }) {
  return <main className="authShell"><section className="authPanel"><div className="brandBlock dark"><div className="brandIcon"><Settings2 size={22} /></div><div><strong>{platform.brand_name}</strong><span>Production database setup</span></div></div><h1>Connect PostgreSQL</h1><p className="setupCopy">{message}</p><div className="envBox"><code>DATABASE_URL</code><code>AUTH_SECRET</code><code>ENCRYPTION_KEY</code></div></section></main>;
}

function SecuritySettings() {
  const [status, setStatus] = useState({ enabled: false });
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api('/api/auth/mfa').then(setStatus).catch((reason) => setError(reason.message)); }, []);
  const run = async (body) => {
    setError(''); setMessage('');
    try {
      const result = await postJson('/api/auth/mfa', body);
      if (body.action === 'begin') setSetup(result);
      if (body.action === 'enable') { setStatus({ enabled: true }); setCodes(result.recoveryCodes || []); setSetup(null); }
      if (body.action === 'disable') { setStatus({ enabled: false }); setCodes([]); setSetup(null); }
      setMessage(body.action === 'begin' ? 'Add this key to your authenticator app, then confirm a code.' : body.action === 'enable' ? 'Multi-factor authentication is enabled.' : 'Multi-factor authentication is disabled.');
    } catch (reason) { setError(reason.message); }
  };
  return <div className='screenGrid'><section className='actionBand'><div><strong>Multi-factor authentication</strong><span>Protect this account with a time-based authenticator and single-use recovery codes.</span></div><Badge kind={status.enabled ? 'good' : 'warn'}>{status.enabled ? 'Enabled' : 'Not enabled'}</Badge></section>{!status.enabled && !setup && <Panel title='Authenticator setup' subtitle='Use Google Authenticator, Microsoft Authenticator, 1Password, or another TOTP app'><button className='primaryAction' type='button' onClick={() => run({ action: 'begin' })}><ShieldCheck size={18} /> Start setup</button></Panel>}{setup && <Panel title='Confirm authenticator' subtitle='The secret is shown once during setup'><div className='envBox'><code>{setup.secret}</code><code>{setup.otpauthUrl}</code></div><form className='formGrid' onSubmit={(event) => { event.preventDefault(); run({ action: 'enable', code: new FormData(event.currentTarget).get('code') }); }}><Input name='code' label='Six-digit code' inputMode='numeric' pattern='[0-9]{6}' required /><button className='primaryAction'><BadgeCheck size={18} /> Enable MFA</button></form></Panel>}{status.enabled && <Panel title='Disable MFA' subtitle='Password and an authenticator or recovery code are required'><form className='formGrid' onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run({ action: 'disable', password: form.get('password'), code: form.get('code') }); }}><Input name='password' label='Current password' type='password' required /><Input name='code' label='Authenticator or recovery code' required /><button className='secondaryAction dangerSoft'>Disable MFA</button></form></Panel>}{codes.length > 0 && <Panel title='Recovery codes' subtitle='Store these securely. Each code can only be used once'><div className='recoveryCodes'>{codes.map((code) => <code key={code}>{code}</code>)}</div></Panel>}{error && <div className='formError'>{error}</div>}{message && <div className='formSuccess'>{message}</div>}</div>;
}

function Screens({ activeView, setupSection = null, ...props }) {
  if (!canOpenWorkspaceView(props.role, activeView)) {
    return <Panel title="Workspace access"><p>This section is available to workspace owners{activeView === "billing" ? "" : " and managers"}.</p></Panel>;
  }
  const setupViews = new Set(Object.keys(setupSectionByView));
  const screens = {
    ads: <WhatsAppAds api={api} postJson={postJson} uploadForm={uploadForm} role={props.role} />,
    calling: <WhatsAppCalling api={api} postJson={postJson} role={props.role} />,
    conversions: <WhatsAppConversions api={api} postJson={postJson} role={props.role} />,
    commerce: <><CommerceOpsPanel api={api} role={props.role} /><WhatsAppCommerce api={api} postJson={postJson} role={props.role} automationEnabled={Boolean(props.state?.featureFlags?.automation)} /></>,
    // Overview dashboard retired from navigation; keep alias → Workspace/Meta setup.
    overview: <Setup {...props} forcedSection="connection" hideSectionTabs={false} onNavigateSection={props.setActiveView} />,
    setup: <Setup {...props} forcedSection={setupSection || 'connection'} hideSectionTabs={Boolean(setupSection && activeView !== 'setup')} onNavigateSection={props.setActiveView} />,
    contacts: <Contacts {...props} />,
    team: <Team {...props} />,
    ai_agents: <AiAgentsWorkspace {...props} />,
    billing: <Billing {...props} />,
    security: <SecuritySettings />,
    templates: <Templates {...props} />,
    automation: <AutomationFlows {...props} />,
    campaigns: <Campaigns {...props} />,
    results: <Results {...props} />,
    inbox: <InboxView {...props} />,
    unsubscribes: <Unsubscribes {...props} />
  };
  const content = setupViews.has(activeView)
    ? <Setup {...props} forcedSection={setupSectionByView[activeView]} hideSectionTabs={activeView !== 'setup'} onNavigateSection={props.setActiveView} />
    : screens[activeView];
  const pageKey = { contacts: "contacts", templates: "templates", automation: "automation", campaigns: "campaigns", results: "results", inbox: "inbox", unsubscribes: "unsubscribes" }[activeView];
  return <>
    {content}
    {activeView === "inbox" && <Pagination label="Message history" meta={props.state.pagination?.messages} onChange={(page) => props.changePage("messages", page)} />}
    {activeView === "inbox" && <Pagination label="Internal notes" meta={props.state.pagination?.notes} onChange={(page) => props.changePage("notes", page)} />}
    {pageKey && <Pagination label={activeView === "inbox" ? "Conversations" : "Records"} meta={props.state.pagination?.[pageKey] || props.state.pagination?.inbox} onChange={(page) => props.changePage(pageKey, page)} />}
  </>;
}

function UpgradeRequiredPanel({ planName, featureKey, role, onBilling, onSetup }) {
  const label = WORKSPACE_FEATURES[featureKey] || featureKey || 'This feature';
  const canBilling = role === 'Owner';
  return (
    <div className="contentGrid" aria-label="Upgrade required">
      <Panel title="Upgrade required" subtitle={`${label} is not included in ${planName}.`}>
        <p className="pageIntro" style={{ maxWidth: '40rem' }}>
          {canBilling
            ? 'This module stays locked until you upgrade. Other tools on your plan keep working.'
            : 'Ask a workspace owner to upgrade the plan for this module.'}
        </p>
        <div className="actionCluster">
          {canBilling && <button className="primaryAction" type="button" onClick={onBilling}>Review plans</button>}
          <button className="secondaryAction" type="button" onClick={onSetup}>Back to WhatsApp setup</button>
        </div>
      </Panel>
    </div>
  );
}

function Billing({ state, role }) {
  const [plans, setPlans] = useState([]);
  const [billingAvailable, setBillingAvailable] = useState(false);
  const [interval, setInterval] = useState('monthly');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmPlan, setConfirmPlan] = useState('');
  const [invoices, setInvoices] = useState([]);
  const [invoiceNote, setInvoiceNote] = useState('');
  useEffect(() => {
    api('/api/billing/plans').then((result) => {
      setPlans(result.plans || []);
      setBillingAvailable(Boolean(result.billingAvailable));
    }).catch((reason) => setError(reason.message));
  }, []);
  useEffect(() => {
    if (role !== 'Owner') return;
    api('/api/billing/invoices').then((result) => {
      setInvoices(result.invoices || []);
      setInvoiceNote(result.message || '');
    }).catch(() => {});
  }, [role]);
  const openBilling = async (path, body = {}) => {
    try {
      setPending(true);
      setError('');
      const result = await postJson(path, body);
      if (!result.url?.startsWith('https://')) throw new Error('The payment provider did not return a secure billing page.');
      window.location.assign(result.url);
    } catch (reason) { setError(reason.message); setPending(false); }
  };
  const switchPlan = async (planId) => {
    try {
      setPending(true);
      setError('');
      setNotice('');
      await postJson('/api/billing/change-plan', { planId, interval });
      setConfirmPlan('');
      setNotice('The payment provider accepted the plan change. Billing will update after its confirmation webhook; refresh this page to check.');
    } catch (reason) { setError(reason.message); }
    finally { setPending(false); }
  };
  const subscription = state.subscription || {};
  const plan = subscription.plan || {};
  const usage = subscription.usage || {};
  const limits = subscription.limits || {};
  const money = (cents, currency = plan.currency) => currency ? new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format((Number(cents) || 0) / 100) : "Not set";
  const usageValue = (key) => limits[key] == null ? `${usage[key] || 0} / Unlimited` : `${usage[key] || 0} / ${limits[key]}`;
  return <div className="screenGrid billingWorkspace" aria-label="Billing">
    <section className="heroPanel"><div><span className="softLabel">{subscription.status || "pending"}</span><h2>{plan.name || "Unassigned"}</h2><p>{plan.description || "Subscription details are managed by the platform owner."}</p><p className="pageIntro" style={{ marginTop: 8 }}>Payment status: <strong>{subscription.paymentStatus || 'none'}</strong>{subscription.provider && subscription.provider !== 'none' ? ` · Provider: ${subscription.provider}` : ''}</p></div><div className="heroMetrics"><Metric label="Monthly" value={money(plan.monthlyPriceCents)} /><Metric label="Yearly" value={money(plan.yearlyPriceCents)} /><Metric label="Period ends" value={subscription.periodEnd ? formatTime(subscription.periodEnd) : (plan.code === 'free' ? 'Never (Free)' : 'Not set')} /></div></section>
    <Panel title="Platform subscription vs messaging" subtitle="Billing for MathStrat is separate from Meta WhatsApp delivery charges"><p className="pageIntro" style={{ maxWidth: '42rem', margin: 0 }}>Your plan covers CRM seats and feature entitlements. WhatsApp conversation or per-message charges from Meta are billed separately when messaging credits or Meta billing apply. Free Forever includes no platform fee. Invoices and payment history appear here only when Razorpay billing events exist — nothing is fabricated.</p></Panel>
    <Panel title="Current usage" subtitle="Live usage against the limits configured for this plan"><div className="meterGrid usageGrid"><Metric label="Contacts" value={usageValue("contacts")} /><Metric label="Campaigns" value={usageValue("campaigns")} /><Metric label="Messages" value={usageValue("messages")} /><Metric label="Users" value={usageValue("users")} /><Metric label="Automations" value={usageValue("automationFlows")} /><Metric label="WhatsApp conversations" value={usageValue("whatsappConversations")} /></div></Panel>
    <section className="billingPlans" aria-label="Subscription plans">
      {(billingAvailable || subscription.provider === 'razorpay') && <RazorpaySubscriptionActions postJson={postJson} role={role} plans={plans} interval={interval}/>}
      <div className="billingPlansHead"><div><h2>Plans</h2><p>Prices and limits are managed by the platform owner.</p></div><div className="billingInterval" role="group" aria-label="Billing interval"><button type="button" className={interval === 'monthly' ? 'active' : ''} aria-pressed={interval === 'monthly'} onClick={() => setInterval('monthly')}>Monthly</button><button type="button" className={interval === 'yearly' ? 'active' : ''} aria-pressed={interval === 'yearly'} onClick={() => setInterval('yearly')}>Yearly</button></div></div>
      {error && <div className="formError" role="alert">{error}</div>}
      {notice && <p role="status">{notice}</p>}
      {!billingAvailable && <div className="formError">Online billing is not configured yet.</div>}
      {subscription.provider === 'razorpay' && subscription.status !== 'canceled' && <button className="secondaryAction" type="button" disabled={pending || role !== 'Owner'} onClick={() => openBilling('/api/billing/portal')}>Open Razorpay subscription</button>}
      <div className="planGrid">{plans.map((item) => { const price = interval === 'monthly' ? item.monthlyPriceCents : item.yearlyPriceCents; const activeProvider = subscription.provider === 'razorpay' && ['active', 'trialing'].includes(subscription.status); const current = activeProvider && item.code === plan.code && interval === subscription.billingInterval; const choiceKey = item.id + ':' + interval; const bullets = planMarketingFeatures(item.features); return <article className="planTile" key={item.id}><header><div><strong>{item.name}</strong><p>{item.description}</p></div>{current && <Badge kind="good">Current</Badge>}</header><div className="planPrice">{money(price, item.currency)}<small>/{interval === 'monthly' ? 'month' : 'year'}</small></div><ul>{bullets.map((feature) => <li key={feature}>{feature}</li>)}</ul><button className="primaryAction" type="button" disabled={pending || !billingAvailable || role !== 'Owner' || !price || current || (subscription.provider === 'razorpay' && subscription.status === 'past_due')} onClick={() => activeProvider ? (confirmPlan === choiceKey ? switchPlan(item.id) : setConfirmPlan(choiceKey)) : openBilling('/api/billing/checkout', { planId: item.id, interval })}>{current ? 'Current plan' : activeProvider ? confirmPlan === choiceKey ? 'Confirm switch' : 'Switch plan' : 'Choose plan'}</button>{activeProvider && confirmPlan === choiceKey && <button className="secondaryAction" type="button" onClick={() => setConfirmPlan('')}>Cancel</button>}</article>; })}</div>
      {!plans.length && <EmptyState text="No public subscription plans are available" />}
    </section>
    <Panel title="Included features" subtitle={plan.name || "Current plan"}><div className="readinessList">{planMarketingFeatures(plan.features).map((feature) => <div className="ready" key={feature}><span>{feature}</span><Badge kind="good">Included</Badge></div>)}{!planMarketingFeatures(plan.features).length && <EmptyState text="No plan features have been configured" />}</div></Panel>
    {role === 'Owner' && <Panel title="Payment history" subtitle="Razorpay subscription invoices when billing is active">
      {invoiceNote && <p className="pageIntro">{invoiceNote}</p>}
      {invoices.length ? <div className="wa-module-table"><table><thead><tr><th>Invoice</th><th>Status</th><th>Amount</th><th>Paid</th></tr></thead><tbody>{invoices.map((row) => <tr key={row.id + (row.paidAt || '')}><td>{row.id || '—'}</td><td>{row.status}</td><td>{row.currency ? money(row.amountPaid, row.currency) : row.amountPaid}</td><td>{row.paidAt ? formatTime(row.paidAt) : '—'}</td></tr>)}</tbody></table></div> : <EmptyState text="No invoices yet — use Open Razorpay subscription after your first paid checkout." />}
    </Panel>}
  </div>;
}

function Overview({ state, approvedTemplates, marketableContacts, latestCampaign, setActiveView, platform, role, openConversation }) {
  const canManage = isWorkspaceManager(role);
  const overview = state?.overview || {};
  const setup = state?.setup || {};
  const meta = state?.meta || {};
  const delivered = overview.delivered || 0;
  const read = overview.read || 0;
  const failed = overview.failed || 0;
  const openConversations = overview.openConversations || 0;
  const marketableCount = overview.marketableContacts || 0;
  const campaignCount = overview.campaignCount || 0;
  const currentCampaign = overview.latestCampaign || latestCampaign;
  const usage = state?.subscription?.usage || {};
  const limits = state?.subscription?.limits || {};
  const setupConnected = (setup.status || 'Needs setup') === 'Connected' && Boolean(meta.liveMetaReady);
  const setupItems = [
    { label: "WhatsApp connection", ready: setupConnected },
    { label: "Approved template", ready: (overview.approvedTemplates || 0) > 0 },
    { label: "Opted-in audience", ready: marketableCount > 0 },
    { label: "Automation flow", ready: (overview.activeFlows || 0) > 0 }
  ];
  return <div className="screenGrid">
    <section className="heroPanel"><div><span className="softLabel">{setupConnected ? 'Connected' : 'Setup required'}</span><h2>{setup.businessName || "Workspace"}</h2><p>{setupConnected ? (platform?.workspace_intro || 'Ready for inbox, broadcasts, and automation.') : 'Connect WhatsApp to start messaging.'}</p></div><div className="heroMetrics"><Metric label="Marketable" value={marketableCount} /><Metric label="Open chats" value={openConversations} /><Metric label="Campaigns" value={campaignCount} /></div></section>
    <section className="actionBand">{!setupConnected && canManage && <button className="primaryAction" type="button" onClick={() => setActiveView('setup')}><Link2 size={18} /> Connect WhatsApp <ChevronRight size={18} /></button>}{canManage && <button className={setupConnected ? 'primaryAction' : 'secondaryAction'} onClick={() => setActiveView("campaigns")}><Send size={18} /> {platform?.primary_cta_label || 'Broadcast'} <ChevronRight size={18} /></button>}<button className={canManage ? "secondaryAction" : "primaryAction"} onClick={() => setActiveView("inbox")}><Inbox size={18} /> Open inbox</button><button className="secondaryAction" onClick={() => setActiveView("contacts")}><UsersRound size={18} /> {canManage ? "Add audience" : "Contacts"}</button></section>
    <Panel title="Support queue" subtitle="Waiting conversations and SLA"><InboxSlaWidget api={api} role={role} onOpenInbox={() => setActiveView("inbox")} onOpenConversation={(conversationId) => { openConversation?.(conversationId); setActiveView("inbox"); }} /></Panel>
    <div className="overviewGrid"><Panel title="Delivery pulse" subtitle="Campaign recipients"><div className="statusGrid"><Metric label="Delivered" value={delivered} /><Metric label="Read" value={read} /><Metric label="Failed" value={failed} /><Metric label="Open chats" value={openConversations} /></div></Panel><Panel title="Workspace readiness" subtitle="Before scaling sends"><div className="readinessList">{setupItems.map((item) => <div key={item.label} className={item.ready ? "ready" : ""}><span>{item.label}</span><Badge kind={item.ready ? "good" : "warn"}>{item.ready ? "Ready" : "Action needed"}</Badge></div>)}</div></Panel></div>
    <details className="techDetails saasAdvancedBlock"><summary>Plan usage · {state.subscription?.plan?.name || "No plan"}</summary><div className="meterGrid usageGrid"><Metric label="Contacts" value={limits.contacts == null ? usage.contacts || 0 : (usage.contacts || 0) + " / " + limits.contacts} /><Metric label="Campaigns" value={limits.campaigns == null ? usage.campaigns || 0 : (usage.campaigns || 0) + " / " + limits.campaigns} /><Metric label="Messages" value={limits.messages == null ? usage.messages || 0 : (usage.messages || 0) + " / " + limits.messages} /><Metric label="Flows" value={limits.automationFlows == null ? usage.automationFlows || 0 : (usage.automationFlows || 0) + " / " + limits.automationFlows} /></div></details>
    <Panel title="Latest campaign" subtitle={currentCampaign ? formatTime(currentCampaign.createdAt) : "No campaigns"}>{currentCampaign ? <ResultMeters stats={currentCampaign.stats} /> : <EmptyState text="No campaign results yet" />}</Panel>
  </div>;
}

function Setup({ state, mutate, notify, reloadSetup, applyWhatsAppConnection, clearWhatsAppConnection, role, forcedSection = null, hideSectionTabs = false, onNavigateSection = null }) {
  const signupAttempt = useRef(null);
  const [connecting, setConnecting] = useState(false);
  const [signupError, setSignupError] = useState("");
  const [section, setSection] = useState(forcedSection || "connection");
  useEffect(() => {
    if (forcedSection) setSection(forcedSection);
  }, [forcedSection]);
  const setup = state?.setup || {};
  const meta = state?.meta || {};
  const accountRole = role || state?.account?.role;
  const rawOps = state?.whatsappOperations || {};
  const operations = {
    accounts: asArray(rawOps.accounts),
    phoneNumbers: asArray(rawOps.phoneNumbers),
    nativeFlows: asArray(rawOps.nativeFlows),
    mediaAssets: asArray(rawOps.mediaAssets),
    capabilities: asArray(rawOps.capabilities),
    analytics: asArray(rawOps.analytics),
    activationChecklist: rawOps.activationChecklist || null
  };
  const accountHasLiveToken = (account) => String(account?.status || "").toLowerCase() === "connected" && account?.token?.status && account.token.status !== "unknown" && account.token.status !== "expired";
  const activeAccount = operations.accounts.find((item) => item.isDefault && accountHasLiveToken(item))
    || operations.accounts.find((item) => accountHasLiveToken(item))
    || null;
  const activePhone = activeAccount
    ? (operations.phoneNumbers.find((item) => item.accountId === activeAccount.id && item.isDefault)
      || operations.phoneNumbers.find((item) => item.accountId === activeAccount.id)
      || null)
    : null;
  const metaLinked = (state.setup?.status || "Needs setup") === "Connected"
    && Boolean(state.meta?.liveMetaReady)
    && accountHasLiveToken(activeAccount);
  useEffect(() => {
    const listener = (event) => {
      const current = signupAttempt.current;
      if (!current?.listening || current.submitted) return;
      const parsed = acceptEmbeddedSignupMessage(event.origin, event.data);
      const next = reduceSignupAttempt(current, { type: 'message', parsed, generation: current.generation });
      signupAttempt.current = next;
      if (next.cancelled) setSignupError(next.error);
      if (next.cancelled || next.completion) next.notify?.();
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
      if (signupAttempt.current) signupAttempt.current.unmounted = true;
    };
  }, []);
  const connectMeta = async (mode = 'standard') => {
    if (signupAttempt.current?.listening && !signupAttempt.current.submitted) {
      signupAttempt.current.listening = false;
    }
    const attempt = createSignupAttempt(mode);
    signupAttempt.current = attempt;
    setConnecting(true);
    setSignupError("");
    try {
      const config = await api(`/api/meta/embedded-signup/config?mode=${mode}`);
      const FB = await loadFacebookSdk(config.appId, config.graphVersion);
      signupAttempt.current = reduceSignupAttempt(signupAttempt.current, { type: 'listen' });
      const loginOptions = buildEmbeddedSignupLoginOptions({
        configId: config.configId,
        mode,
        flowVersion: config.flowVersion
      });
      const response = await new Promise((resolve, reject) => {
        FB.login(metaSdkCallback(resolve, reject), loginOptions);
      });
      if (signupAttempt.current?.unmounted || signupAttempt.current?.generation !== attempt.generation) return;
      const code = response?.authResponse?.code || '';
      signupAttempt.current = reduceSignupAttempt(signupAttempt.current, { type: 'code', code });
      if (!code) {
        setSignupError(describeEmbeddedSignupFailure(response, signupAttempt.current.error));
        return;
      }
      if (!signupSubmitPayload(signupAttempt.current)) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, SIGNUP_WAIT_MS);
          signupAttempt.current.notify = () => { clearTimeout(timer); resolve(); };
        });
        if (signupAttempt.current?.generation === attempt.generation) {
          signupAttempt.current = reduceSignupAttempt(signupAttempt.current, { type: 'timeout' });
        }
      }
      const latest = signupAttempt.current;
      if (!latest || latest.generation !== attempt.generation || latest.unmounted) return;
      // Capture payload before marking submitted so the complete request always gets a JSON object.
      const payload = signupSubmitPayload(latest);
      if (latest.cancelled || !payload) {
        setSignupError(latest.error || 'Meta did not finish the WhatsApp connection. Start it again.');
        return;
      }
      if (latest.submitted) return;
      latest.submitted = true;
      const completion = await postJson('/api/meta/embedded-signup/complete', payload);
      if (typeof applyWhatsAppConnection === 'function') applyWhatsAppConnection(completion?.connection);
      let nextState = typeof reloadSetup === 'function' ? await reloadSetup() : null;
      if (!nextState && typeof reloadSetup === 'function') nextState = await reloadSetup();
      // Trust only the credential-gated setup GET — never re-stamp Connected from completion alone.
      if (nextState?.setup?.status === 'Connected' && nextState?.meta?.liveMetaReady) {
        notify('WhatsApp Business connected');
      } else if (completion?.connection?.wabaId) {
        setSignupError('WhatsApp assets were saved, but credentials are not ready yet. Wait a moment, then open Connection and tap Verify.');
      } else {
        setSignupError('Meta did not finish saving the WhatsApp connection. Start it again.');
      }
    } catch (error) {
      setSignupError(error.message || 'Meta signup could not be completed.');
    } finally {
      if (signupAttempt.current?.generation === attempt.generation) setConnecting(false);
    }
  };
  const checkConnection = async () => {
    try {
      await postJson("/api/meta/connection/check", {});
      if (typeof reloadSetup === 'function') await reloadSetup();
      notify("Connection check complete");
    } catch (error) {
      if (error?.code === "META_NOT_CONFIGURED" && typeof clearWhatsAppConnection === "function") {
        clearWhatsAppConnection();
      }
      if (typeof reloadSetup === "function") await reloadSetup();
      notify(error.message || "Connection check failed");
    }
  };
  const disconnectMessageForRemoteCleanup = (remoteCleanup) => {
    if (remoteCleanup === "pending") {
      return "Disconnected in this workspace. Meta remote cleanup is queued and will finish in the background.";
    }
    if (remoteCleanup === "unavailable") {
      return "Disconnected locally. Remote Meta cleanup could not be queued—contact support if messaging still appears linked in Meta.";
    }
    return "WhatsApp Business disconnected";
  };
  const disconnect = async () => {
    if (typeof clearWhatsAppConnection === 'function') clearWhatsAppConnection();
    try {
      const body = await postJson("/api/meta/connection/disconnect", {});
      await mutate(Promise.resolve(body), disconnectMessageForRemoteCleanup(body?.remoteCleanup));
    } catch (error) {
      notify(error.message);
    }
  };
  const runOperation = (body, message) => mutate(postJson("/api/whatsapp/operations", body), message);
  const uploadMedia = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("phoneId", activePhone?.id || "");
    mutate(uploadForm("/api/whatsapp/media", form).then(() => event.currentTarget.reset()), "Media uploaded to WhatsApp");
  };
  const submitManual = (event) => { event.preventDefault(); mutate(postJson("/api/setup", Object.fromEntries(new FormData(event.currentTarget)), "PUT"), "Manual setup saved"); };
  const metadata = setup.connectionMetadata || {};
  // Prefer the shell secondary nav (Connection / Numbers / Profile). Never stack a second identical tab bar.
  const showInnerTabs = false;
  // Same gate as Connection badge / Verify — never paint "connected" from setup.status alone.
  const connected = metaLinked;
  // Analytics / journeys / capabilities are feature pages — keep the connect hero on Connection/Numbers/Profile only.
  const showConnectHero = ['connection', 'numbers', 'profile'].includes(section);
  return <div className="screenGrid metaSetupScreen">
    {showConnectHero ? <section className="metaConnectHero" aria-labelledby="meta-connect-heading">
      <div>
        <p className="kicker">Meta</p>
        <h2 id="meta-connect-heading">{connected ? (setup.businessName || 'WhatsApp connected') : 'Connect your WhatsApp Business account'}</h2>
        <span>{connected
          ? 'Your WhatsApp Business account is linked. Use Numbers and Profile to manage assets, or reconnect if Meta access changes.'
          : 'Securely connect your WhatsApp Business account through Meta to start using messaging tools in this workspace.'}</span>
      </div>
      <div className="metaConnectActions">
        <button className="primaryAction metaConnectButton" type="button" onClick={() => connectMeta('standard')} disabled={connecting || !meta.embeddedSignupAvailable}><Link2 size={18} /> Connect with Meta</button>
        <button className="secondaryAction" type="button" onClick={() => connectMeta('coexistence')} disabled={connecting || !meta.embeddedSignupAvailable} title="For eligible WhatsApp Business App numbers"><Smartphone size={18} /> Existing Business App number</button>
      </div>
    </section> : null}
    {!meta.embeddedSignupAvailable && <div className="formError">WhatsApp connection isn&apos;t available yet. Contact support.</div>}
    {signupError && <div className="formError" role="alert">{signupError}</div>}
    <CoexistenceProgress phones={operations.phoneNumbers.filter(phone=>phone.coexistence)} api={api} postJson={postJson}/>
    {showInnerTabs && !hideSectionTabs && <nav className="operationsTabs" aria-label="WhatsApp connection">
      {[
        ["connection", Activity, "Connection", "setup"],
        ["numbers", Smartphone, "Numbers", "numbers"],
        ["profile", Building2, "Profile", "profile"]
      ].map(([id, Icon, label, viewId]) => <button key={id} type="button" className={section === id ? "active" : ""} onClick={() => { setSection(id); if (onNavigateSection && viewId) onNavigateSection(viewId); }}><Icon size={16} /><span>{label}</span></button>)}
    </nav>}
    {section === 'connection' && !connected && (
      <p className="pageIntro" style={{ margin: '0 0 8px' }}>After you connect, inbox, broadcasts, automation, and other WhatsApp tools unlock from the product menu.</p>
    )}
    {section === 'entry_points' && <WhatsAppEntryPoints key={activePhone?.id} phone={activePhone} api={api} postJson={postJson} role={accountRole}/>}
    {section === 'flows' && <WhatsAppFlowDesigner api={api} postJson={postJson} flows={operations.nativeFlows} onUploaded={()=>mutate(Promise.resolve({ok:true}), 'Flow uploaded')}/>}
    {section === 'flows' && <NativeFlowWorkspace api={api} postJson={postJson} role={accountRole}/>}
    {section === 'journeys' && <WhatsAppJourneyAnalytics api={api}/>}
    {section === 'groups' && <WhatsAppGroups api={api} postJson={postJson} enabled={state.featureFlags?.whatsapp_groups} />}
    {section === 'integrations' && isWorkspaceManager(accountRole) && <>
      <IntegrationMarketplace api={api} />
      {state.featureFlags?.connectors && <ProviderConnectors api={api} postJson={postJson} canEdit={accountRole === 'Owner'} recoveryAllowed={Boolean(state.featureFlags?.checkout_recovery && state.featureFlags?.automation)} />}
      {state.featureFlags?.segments && <TrackedLinks api={api} postJson={postJson} role={accountRole}/>}
      {state.featureFlags?.webviews&&<WhatsAppWebviews api={api} postJson={postJson}/>}
      {state.featureFlags?.crm_sync&&accountRole==='Owner'&&<><HubSpotConnection api={api} postJson={postJson} role={accountRole}/><HubSpotConnection provider="salesforce" api={api} postJson={postJson} role={accountRole}/></>}
      <details className="techDetails saasAdvancedBlock"><summary>Developer API · keys and signed webhooks</summary><WorkspaceIntegrations api={api} postJson={postJson}/></details>
    </>}
    {section === "connection" && <>
      <div className="contentGrid twoColumns">
        <Panel title="Connection health" subtitle="Status for this workspace">
          <div className="connectionSummary">
            <div><span>Connection</span><Badge kind={metaLinked ? "good" : "warn"}>{metaLinked ? "Connected" : "Needs setup"}</Badge></div>
            <div><span>Onboarding</span><strong>{setup.onboardingMethod === 'coexistence' ? 'Existing Business App number' : setup.onboardingMethod === 'embedded_signup' ? 'Meta Cloud API signup' : 'Manual'}</strong></div>
            <div><span>Events</span><Badge kind={setup.webhookSubscribed ? "good" : "warn"}>{setup.webhookSubscribed ? "Receiving" : "Not verified"}</Badge></div>
            <div><span>Business number</span><strong>{setup.whatsappNumber || "Not connected"}</strong></div>
            <div><span>Verified name</span><strong>{metadata.verifiedName || activePhone?.verifiedName || "Unavailable"}</strong></div>
            <div><span>Quality rating</span><strong>{metadata.qualityRating || activePhone?.qualityRating || "Unavailable"}</strong></div>
            <div><span>Token health</span><Badge kind={activeAccount?.token?.status === "healthy" ? "good" : "warn"}>{activeAccount?.token?.status || "Unknown"}</Badge></div>
            <div><span>Meta health</span><Badge kind={activeAccount?.health?.status === "healthy" ? "good" : "warn"}>{activeAccount?.health?.status === "healthy" ? "Healthy" : activeAccount?.health?.status === "reconnect_required" ? "Reconnect needed" : activeAccount?.health?.status === "degraded" ? "Needs attention" : "Awaiting check"}</Badge></div>
          </div>
          <div className="connectionActions"><button className="secondaryAction" type="button" onClick={checkConnection} disabled={!metaLinked}><Activity size={17} /> Verify</button><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "sync", ...(activeAccount?.id ? { accountId: activeAccount.id } : {}) }, "WhatsApp assets synchronized")} disabled={!accountHasLiveToken(activeAccount)}><RefreshCcw size={17} /> Sync assets</button><button className="secondaryAction dangerSoft" type="button" onClick={disconnect} disabled={!metaLinked}><Unplug size={17} /> Disconnect</button></div>
        </Panel>
        <Panel title="Advanced" subtitle="Optional diagnostics for support">
          <details className="techDetails"><summary>Connection IDs</summary><div className="connectionSummary"><div><span>Meta App ID</span><strong>{meta.appId || "Not configured"}</strong></div><div><span>Embedded Signup config ID</span><strong>{meta.embeddedSignupConfigId || "Not configured"}</strong></div><div><span>WABA ID</span><strong>{setup.wabaId || "Needs setup"}</strong></div><div><span>Phone Number ID</span><strong>{setup.phoneNumberId || "Needs setup"}</strong></div><div><span>Token expiry</span><strong>{activeAccount?.token?.expiresAt ? formatTime(activeAccount.token.expiresAt) : "Reconnect when Meta requests"}</strong></div><div><span>Last checked</span><strong>{formatTime(activeAccount?.health?.checkedAt)}</strong></div></div></details>
          <details className="techDetails saasAdvancedBlock"><summary>Webhook status</summary><div className="webhookCard"><code>{setup.webhookUrl || meta.webhookUrl || "Webhook URL not configured"}</code><div><span>Signature verification</span><Badge kind="good">Enabled</Badge></div><div><span>WABA subscription</span><Badge kind={activeAccount?.webhookSubscribed ? "good" : "warn"}>{activeAccount?.webhookSubscribed ? "Subscribed" : "Not subscribed"}</Badge></div><div><span>Last message/status event</span><strong>{formatTime(activeAccount?.health?.lastMessageWebhookAt)}</strong></div><div><span>Last callback</span><strong>{formatTime(activeAccount?.health?.lastWebhookAt)}</strong></div><div><span>Last event field</span><strong>{activeAccount?.health?.lastWebhookField || "None received"}</strong></div></div></details>
        </Panel>
      </div>
      <details className="manualSetup"><summary>Manual credentials fallback</summary><Panel title="Manual Meta credentials" subtitle="Use only if Embedded Signup is unavailable"><form className="formGrid" onSubmit={submitManual}><Input name="businessName" label="Business name" defaultValue={setup.businessName} /><Input name="whatsappNumber" label="WhatsApp number" defaultValue={setup.whatsappNumber} /><Input name="wabaId" label="WABA ID" defaultValue={setup.wabaId} /><Input name="phoneNumberId" label="Phone Number ID" defaultValue={setup.phoneNumberId} /><Input name="webhookUrl" label="Webhook URL" defaultValue={setup.webhookUrl} /><Input name="accessToken" label="Access token" defaultValue={setup.accessToken} placeholder="Paste token" /><button className="primaryAction" type="submit"><BadgeCheck size={18} /> Save manual setup</button></form></Panel></details>
    </>}
    {section === "numbers" && <Panel title="WhatsApp phone numbers" subtitle="Every number remains isolated to this company; the default number is used by campaigns and inbox replies">
      <div className="assetToolbar"><span>{operations.phoneNumbers.length} connected number{operations.phoneNumbers.length === 1 ? "" : "s"}</span><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "sync", ...(activeAccount?.id ? { accountId: activeAccount.id } : {}) }, "Phone numbers synchronized")} disabled={!accountHasLiveToken(activeAccount)}><RefreshCcw size={17} /> Sync from Meta</button></div>
      <div className="phoneAssetGrid">{operations.phoneNumbers.map((phone) => <article className={`phoneAsset ${phone.isDefault ? "selected" : ""}`} key={phone.id}><header><div className="assetIcon"><Smartphone size={20} /></div><div><strong>{phone.verifiedName || phone.displayPhoneNumber}</strong><span>{phone.displayPhoneNumber || phone.phoneNumberId}</span></div><Badge kind={phone.qualityRating === "GREEN" ? "good" : phone.qualityRating === "RED" ? "bad" : "warn"}>{phone.qualityRating}</Badge></header><dl><div><dt>Status</dt><dd>{phone.status}</dd></div><div><dt>Messaging tier</dt><dd>{phone.messagingLimitTier}</dd></div><div><dt>Platform</dt><dd>{phone.platformType}</dd></div><div><dt>Registration</dt><dd>{phone.registrationState}</dd></div></dl><div className="assetActions"><button className="secondaryAction" type="button" disabled={phone.isDefault} onClick={() => runOperation({ action: "select_phone", phoneId: phone.id }, "Default WhatsApp number changed")}>{phone.isDefault ? <BadgeCheck size={16} /> : <CheckCheck size={16} />}{phone.isDefault ? "Default number" : "Use this number"}</button>{!phone.coexistence && <form onSubmit={(event) => { event.preventDefault(); const pin = new FormData(event.currentTarget).get("pin"); runOperation({ action: "register_phone", phoneId: phone.id, pin }, "Phone number registered"); event.currentTarget.reset(); }}><input name="pin" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" placeholder="6-digit PIN" aria-label="Two-step verification PIN" required /><button className="secondaryAction" title="Register number"><KeyRound size={16} /> Register</button></form>}</div></article>)}</div>
      {activePhone && !activePhone.coexistence && <details className="numberVerification"><summary>Verify or migrate the selected number</summary><div><form onSubmit={(event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); runOperation({ action: "request_code", phoneId: activePhone.id, ...values }, "Verification code requested"); }}><label>Delivery method<select name="method"><option value="SMS">SMS</option><option value="VOICE">Voice call</option></select></label><Input name="language" label="Language" defaultValue="en_US" /><button className="secondaryAction"><PhoneCall size={16} /> Request code</button></form><form onSubmit={(event) => { event.preventDefault(); const code = new FormData(event.currentTarget).get("code"); runOperation({ action: "verify_code", phoneId: activePhone.id, code }, "Phone number verified"); event.currentTarget.reset(); }}><Input name="code" label="Verification code" inputMode="numeric" required /><button className="secondaryAction"><BadgeCheck size={16} /> Verify code</button></form></div></details>}
      {!operations.phoneNumbers.length && <EmptyState text="Connect Meta, then sync phone numbers" />}
    </Panel>}
    {section === "profile" && <Panel title="WhatsApp business profile" subtitle={activePhone ? `Profile for ${activePhone.displayPhoneNumber}` : "Connect a phone number first"}>
      {activePhone ? <form className="formGrid profileForm" key={activePhone.id} onSubmit={(event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); runOperation({ action: "update_profile", phoneId: activePhone.id, profile: values }, "Business profile updated"); }}><Input name="about" label="About" defaultValue={activePhone.profile.about || ""} maxLength="139" /><Input name="email" label="Public email" type="email" defaultValue={activePhone.profile.email || ""} /><Input name="address" label="Address" defaultValue={activePhone.profile.address || ""} /><label>Business category<select name="vertical" defaultValue={activePhone.profile.vertical || "OTHER"}><option value="OTHER">Other</option><option value="RETAIL">Retail</option><option value="PROF_SERVICES">Professional services</option><option value="EDU">Education</option><option value="HEALTH">Health</option><option value="TRAVEL">Travel</option><option value="RESTAURANT">Restaurant</option></select></label><label className="wideField">Description<textarea name="description" rows="4" maxLength="512" defaultValue={activePhone.profile.description || ""} /></label><label className="wideField">Websites<textarea name="websites" rows="2" defaultValue={(activePhone.profile.websites || []).join("\n")} placeholder="One URL per line" /></label><div className="formActions wideField"><button className="primaryAction" type="submit"><Save size={17} /> Save profile</button><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "sync_profile", phoneId: activePhone.id }, "Business profile synchronized")}><RefreshCcw size={17} /> Reload from Meta</button></div></form> : <EmptyState text="No active WhatsApp number" />}
    </Panel>}
{section === "flows" && <div className="contentGrid twoColumns whatsappFlowsScreen"><Panel title="Create WhatsApp Flow" subtitle="Meta in-chat forms — separate from Automation reply workflows"><form className="formGrid" onSubmit={(event) => { event.preventDefault(); runOperation({ action: "create_flow", ...Object.fromEntries(new FormData(event.currentTarget)), accountId: activeAccount?.id, phoneId: activePhone?.id }, "WhatsApp Flow created"); event.currentTarget.reset(); }}><Input name="name" label="Flow name" required /><label>Category<select name="category"><option value="LEAD_GENERATION">Lead generation</option><option value="APPOINTMENT_BOOKING">Appointment booking</option><option value="SIGN_UP">Sign up</option><option value="CONTACT_US">Contact us</option><option value="OTHER">Other</option></select></label><label className="checkRow"><input name="managedEndpoint" type="checkbox" disabled={!activePhone?.flowEncryption?.configured || activePhone?.flowEncryption?.signatureStatus !== "VALID"} /> Use CRM data endpoint</label><label>CRM endpoint mode<select name="managedEndpointMode"><option value="preset">Saved responses</option><option value="transactional">Live booking or order runtime</option></select></label><Input name="endpointUri" label="External data endpoint (optional)" type="url" /><button className="primaryAction" disabled={!accountHasLiveToken(activeAccount)}><Plus size={17} /> Create in Meta</button></form></Panel><Panel title="Meta Flow library" subtitle="Published Flows are immutable; clone in Meta before changing a published Flow"><div className="flowAssetList">{operations.nativeFlows.map((flow) => <article key={flow.id}><header><div><strong>{flow.name}</strong><span>{flow.category} | {flow.metaFlowId || "Local"}</span></div><Badge kind={flow.status === "published" ? "good" : flow.validationErrors.length ? "bad" : "warn"}>{flow.status}</Badge></header>{flow.managedEndpoint && !flow.transactionalEndpoint && <details><summary>Data responses</summary><form onSubmit={(event) => { event.preventDefault(); try { runOperation({ action: "set_flow_responses", flowId: flow.id, responses: JSON.parse(new FormData(event.currentTarget).get("responses")) }, "Flow responses saved"); } catch { mutate(Promise.reject(new Error("Enter valid response JSON."))); } }}><textarea name="responses" rows="8" defaultValue={JSON.stringify(flow.endpointResponses || {}, null, 2)} required /><button className="secondaryAction"><Save size={16} /> Save responses</button></form><small>{flow.endpointUri}</small></details>}<details><summary>Flow JSON</summary><form onSubmit={(event) => { event.preventDefault(); runOperation({ action: "upload_flow", flowId: flow.id, flowJson: new FormData(event.currentTarget).get("flowJson") }, "Flow definition uploaded"); }}><textarea name="flowJson" rows="8" defaultValue={JSON.stringify(flow.flowJson || {}, null, 2)} required /><button className="secondaryAction"><Upload size={16} /> Validate and upload</button></form></details><div className="assetActions"><button className="secondaryAction" type="button" disabled={flow.status === "published"} onClick={() => runOperation({ action: "publish_flow", flowId: flow.id }, "WhatsApp Flow published")}><Play size={16} /> Publish</button></div>{flow.validationErrors.map((error, index) => <small className="errorLine" key={index}>{error.error_user_msg || error.error || error.message || 'Fix the Flow JSON and upload again.'}</small>)}</article>)}</div><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "sync_flows", ...(activeAccount?.id ? { accountId: activeAccount.id } : {}) }, "WhatsApp Flows synchronized")} disabled={!accountHasLiveToken(activeAccount)}><RefreshCcw size={17} /> Sync from Meta</button>{!operations.nativeFlows.length && <EmptyState text="No native WhatsApp Flows yet" />}</Panel></div>}
    {section === "flows" && activePhone && <Panel title="Flow encryption" subtitle={activePhone.displayPhoneNumber}><div className="connectionActions"><Badge kind={activePhone.flowEncryption?.signatureStatus === "VALID" ? "good" : "warn"}>{activePhone.flowEncryption?.signatureStatus || "Not configured"}</Badge><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "configure_flow_encryption", phoneId: activePhone.id }, "Flow encryption configured")}><KeyRound size={17} /> Configure in Meta</button></div></Panel>}
    {section === "media" && <div className="contentGrid twoColumns mediaLibraryScreen"><Panel title="Upload" subtitle={activePhone ? `Uploads to Meta for ${activePhone.displayPhoneNumber || "this number"}` : "Connect a WhatsApp number first"}><form className="formGrid" onSubmit={uploadMedia}><label className="fileDrop"><input name="file" type="file" accept="image/jpeg,image/png,video/mp4,video/3gpp,audio/aac,audio/mp4,audio/mpeg,audio/amr,audio/ogg,application/pdf,text/plain" required /><Upload size={22} /><strong>Choose media</strong><span>Images, video, audio, PDF, or plain text within Meta Cloud API limits</span></label>{!activePhone && <p className="formError" role="status">No active WhatsApp number is selected for this workspace.</p>}{!accountHasLiveToken(activeAccount) && activePhone && <p className="formError" role="status">Reconnect WhatsApp before uploading media to Meta.</p>}<button className="primaryAction" disabled={!activePhone || !accountHasLiveToken(activeAccount)}><Upload size={16} /> Upload to Meta</button></form></Panel><Panel title="Library" subtitle={`${operations.mediaAssets.length} asset${operations.mediaAssets.length === 1 ? "" : "s"} · Meta media IDs are workspace-scoped`}><div className="mediaAssetList">{operations.mediaAssets.map((asset) => <article key={asset.id}><div><Image size={18} /><span><strong>{asset.filename || asset.metaMediaId}</strong><small>{asset.mimeType} · {Math.ceil((asset.byteSize || 0) / 1024)} KB · {asset.metaMediaId}</small></span></div><button className="iconButton dangerSoft" type="button" title="Delete media" aria-label={`Delete ${asset.filename || asset.metaMediaId}`} onClick={() => { if (window.confirm("Delete this media asset from the workspace library?")) mutate(api(`/api/whatsapp/media?id=${encodeURIComponent(asset.id)}`, { method: "DELETE" }), "Media deleted"); }}><Trash2 size={16} /></button></article>)}</div>{!operations.mediaAssets.length && <EmptyState text="No media uploaded yet. Uploaded files can be reused in templates and supported automation actions." />}</Panel></div>}
    {section === "commerce" && <div className="contentGrid twoColumns"><Panel title="Commerce settings" subtitle={activePhone ? `Catalog visibility for ${activePhone.displayPhoneNumber}` : "Connect a phone number first"}>{activePhone ? <form className="formGrid" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); runOperation({ action: "update_commerce", phoneId: activePhone.id, isCartEnabled: form.get("isCartEnabled") === "on", isCatalogVisible: form.get("isCatalogVisible") === "on" }, "Commerce settings updated"); }}><label className="checkRow"><input name="isCatalogVisible" type="checkbox" defaultChecked={Boolean(activePhone.commerceSettings.is_catalog_visible)} /> Catalog visible in WhatsApp</label><label className="checkRow"><input name="isCartEnabled" type="checkbox" defaultChecked={Boolean(activePhone.commerceSettings.is_cart_enabled)} /> Shopping cart enabled</label><div className="formActions"><button className="primaryAction"><Save size={17} /> Save settings</button><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "sync_commerce", phoneId: activePhone.id }, "Commerce settings synchronized")}><RefreshCcw size={17} /> Sync from Meta</button></div></form> : <EmptyState text="No active WhatsApp number" />}</Panel><Panel title="Send product message" subtitle="Available only to an existing contact inside the customer service window"><form className="formGrid" onSubmit={(event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); runOperation({ action: "send_commerce_message", phoneId: activePhone?.id, ...values }, "Product message sent"); event.currentTarget.reset(); }}><Input name="recipient" label="Contact phone" required /><Input name="catalogId" label="Meta catalog ID" required /><label>Message type<select name="mode"><option value="product">Single product</option><option value="product_list">Product list</option></select></label><Input name="header" label="Header" /><label className="wideField">Message<textarea name="body" rows="3" required /></label><Input name="sectionTitle" label="Section title" /><label className="wideField">Product retailer IDs<textarea name="products" rows="4" required /></label><button className="primaryAction" disabled={!activePhone}><ShoppingBag size={17} /> Send product message</button></form></Panel></div>}
    {section === "analytics" && <Panel title="Meta WhatsApp analytics" subtitle="Account-level messaging and conversation analytics from Meta Graph for this workspace.">
      <div className="assetToolbar whatsappReferralToolbar">
        <span>{operations.analytics.length} recent snapshot{operations.analytics.length === 1 ? "" : "s"}</span>
        <button className="secondaryAction" type="button" onClick={() => runOperation({ action: "sync_analytics", ...(activeAccount?.id ? { accountId: activeAccount.id } : {}) }, "Meta analytics synchronized")} disabled={!accountHasLiveToken(activeAccount)}>
          <RefreshCcw size={16} /> Sync last 30 days
        </button>
      </div>
      {!accountHasLiveToken(activeAccount) && (
        <div className="analyticsSectionError" role="status">
          <strong>Meta connection required</strong>
          <p>Reconnect WhatsApp with a live Meta token before syncing messaging analytics.</p>
          {onNavigateSection ? <button className="secondaryAction" type="button" onClick={() => onNavigateSection('setup')}>Open connection</button> : null}
        </div>
      )}
      <div className="analyticsSnapshotGrid">{operations.analytics.map((snapshot) => { const metrics = summarizeAnalyticsPayload(snapshot.payload); return <article key={snapshot.id}><BarChart3 size={19} /><div><strong>{snapshot.metricType.toUpperCase()}</strong><span>{formatTime(snapshot.periodStart)} to {formatTime(snapshot.periodEnd)}</span><small>Collected {formatTime(snapshot.collectedAt)}</small>{metrics.hasMetrics ? <div className="chipRow compact"><span>Sent {metrics.sent}</span><span>Delivered {metrics.delivered}</span><span>Read {metrics.read}</span><span>Conversations {metrics.conversations}</span>{metrics.cost > 0 && <span>Cost {metrics.cost}</span>}</div> : <small>Snapshot stored — sync again after Meta returns period metrics.</small>}</div></article>; })}</div>
      {!operations.analytics.length && accountHasLiveToken(activeAccount) && <EmptyState text="No Meta analytics snapshots yet. Sync the last 30 days to create the first one." />}
    </Panel>}
    {section === "capabilities" && <div className="contentGrid twoColumns"><Panel title="WhatsApp capabilities" subtitle="Refresh entitlements after Meta enables new features"><div className="assetToolbar"><Badge kind={operations.activationChecklist?.readyForMessaging ? "good" : "warn"}>{operations.activationChecklist?.readyForMessaging ? "Ready for messaging" : `${operations.activationChecklist?.blockerCount || 0} blocker(s)`}</Badge><button className="primaryAction" type="button" disabled={!accountHasLiveToken(activeAccount)} onClick={() => runOperation({ action: "refresh_entitlements", ...(activeAccount?.id ? { accountId: activeAccount.id } : {}) }, "Meta entitlements refreshed")}><RefreshCcw size={17} /> Refresh entitlements</button></div><div className="readinessList">{operations.activationChecklist?.steps?.map((step) => <div key={step.id} className={step.status === "pass" ? "ready" : ""}><span>{step.label}</span><Badge kind={step.status === "pass" ? "good" : step.status === "warn" ? "warn" : "bad"}>{step.status === "pass" ? "OK" : step.status === "warn" ? "Review" : "Blocked"}</Badge><small>{step.detail}</small></div>)}</div></Panel><Panel title="WhatsApp capability readiness" subtitle="Inferred from your connected WABA and synced Meta data"><div className="capabilityGrid">{operations.capabilities.map((capability) => <article key={capability.key}><div className="capabilityIcon"><RadioTower size={18} /></div><div><strong>{capability.name}</strong><span>{capability.detail || capability.prerequisite}</span></div><Badge kind={capability.status === "available" ? "good" : capability.status === "setup" ? "warn" : "neutral"}>{capability.status === "available" ? "Configured" : capability.status === "setup" ? "Setup needed" : "Not integrated"}</Badge></article>)}</div><MmLiteOptimizerPanel api={api} /></Panel></div>}
  </div>;
}
function SavedSegments({ initialSegments, canManage, mutate }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [segments, setSegments] = useState(initialSegments);
  const [hasMore, setHasMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api(`/api/segments?q=${encodeURIComponent(search)}&page=${page}`).then(result => {
        if (!active) return;
        setSegments(result.segments);
        setHasMore(result.hasMore);
        setError('');
      }).catch(reason => { if (active) setError(reason.message); });
    }, search ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [page, search, refresh, initialSegments]);
  const reload = async (promise, message) => {
    const ok = await mutate(promise, message);
    if (ok) setRefresh(current => current + 1);
  };
  return <Panel title="Saved segments" subtitle="Reusable audiences recalculated from current contact data">
    {canManage && <AudienceSegmentComposer api={api} postJson={postJson} onSaved={() => reload(Promise.resolve(), 'Segment saved')} />}
    <label className="searchBox"><Search size={17} /><input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Find a segment" maxLength={120} /></label>
    {error && <small className="errorLine" role="alert">{error}</small>}
    <div className="segmentList">{segments.map(segment => <article key={segment.id} className={segment.isRetargetAudience ? 'segmentRetargetCard' : ''}><div><strong>{segment.name}</strong>{segment.isRetargetAudience && <Badge kind="neutral">Retarget</Badge>}<span>{segment.description || 'Dynamic audience'}</span></div><Badge kind={segment.isActive ? 'good' : 'neutral'}>{segment.contactCount} contacts</Badge>{canManage && <div className="segmentRowActions">{segment.isRetargetAudience && <button className="secondaryAction compactAction" type="button" title="Refresh live retarget rules" onClick={() => reload(postJson(`/api/segments/${segment.id}/refresh`, {}), 'Retarget audience refreshed')}><RefreshCcw size={15} /> Refresh</button>}<AudienceBulkTagsPanel segment={segment} api={api} onApplied={() => reload(Promise.resolve(), 'Segment tags updated')} /><button className="iconButton dangerSoft" type="button" title="Delete segment" onClick={() => reload(api(`/api/segments/${segment.id}`, { method: 'DELETE' }), 'Segment removed')}><Trash2 size={16} /></button></div>}</article>)}{!segments.length && <EmptyState text="No saved segments match" />}</div>
    {(page > 1 || hasMore) && <nav className="pagination" aria-label="Saved segments pagination"><span>Page {page}</span><div><button className="secondaryAction" type="button" disabled={page === 1} onClick={() => setPage(current => current - 1)}>Previous</button><button className="secondaryAction" type="button" disabled={!hasMore} onClick={() => setPage(current => current + 1)}>Next</button></div></nav>}
  </Panel>;
}
function Contacts({ state, mutate }) {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [search, setSearch] = useState("");
  const [permissionFilter, setPermissionFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [contacts, setContacts] = useState(state.contacts || []);
  const [pagination, setPagination] = useState(state.pagination?.contacts || { page: 1, pages: 1, total: contacts.length });
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactsError, setContactsError] = useState('');
  const [editContact, setEditContact] = useState(null);
  const [contactsRefreshKey, setContactsRefreshKey] = useState(0);
  const canManage = isWorkspaceManager(state?.account?.role);
  const modeParam = permissionFilter === "allowed" ? "marketable" : permissionFilter === "blocked" ? "suppressed" : "all";
  const businessId = state?.account?.business?.id || "";
  useEffect(() => {
    let active = true;
    if (!businessId) return () => { active = false; };
    const timer = setTimeout(async () => {
      setLoadingContacts(true);
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "25", mode: modeParam });
        if (search.trim()) params.set("q", search.trim());
        const result = await api(`/api/workspace/contacts?${params}`);
        if (!active) return;
        setContacts(result.contacts || []);
        setPagination(result.pagination?.contacts || { page, pages: 1, total: 0 });
        setContactsError('');
      } catch (cause) {
        if (active) {
          setContactsError(cause?.message || 'Unable to load contacts.');
          setContacts([]);
        }
      } finally {
        if (active) setLoadingContacts(false);
      }
    }, search ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [page, search, modeParam, businessId, contactsRefreshKey]);
  const refreshContacts = () => setContactsRefreshKey((key) => key + 1);
  const add = (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); mutate(postJson("/api/contacts", { name: form.get("name"), phone: form.get("phone"), tags: form.get("tags"), optInSource: form.get("optInSource"), consentEvidence: form.get("consentEvidence"), marketingPermission: form.get("marketingPermission") === "on" }).then(() => { refreshContacts(); }), "Contact saved"); event.currentTarget.reset(); };
  const importRows = (event) => { event.preventDefault(); if (!csvText.trim()) return; mutate(postJson("/api/contacts/import", { csv: csvText }).then((next) => { setCsvText(""); setFileName(""); refreshContacts(); return next; }), "Contacts imported"); };
  const chooseFile = async (event) => { const file = event.target.files?.[0]; if (!file) return; event.target.value = ""; if (file.size > 2 * 1024 * 1024) { mutate(Promise.reject(new Error("Choose a CSV file no larger than 2 MB."))); return; } setFileName(file.name); setCsvText(await file.text()); };
  const saveContact = (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const allowed = form.get("marketingPermission") === "allowed"; mutate(postJson(`/api/contacts/${editContact.id}`, { name: form.get("name"), phone: form.get("phone"), tags: form.get("tags"), optInSource: form.get("optInSource"), consentEvidence: form.get("consentEvidence"), marketingPermission: allowed, unsubscribed: !allowed, customAttributes: attributesFromText(form.get("customAttributes")) }, "PATCH").then((next) => { setEditContact(null); refreshContacts(); return next; }), "Contact updated"); };
  return <div className="screenGrid">
    <div className="contentGrid audienceGrid">
      {canManage && <Panel title="Add contact" subtitle="Create a permission-aware WhatsApp contact"><form className="formGrid" onSubmit={add}><Input name="name" label="Name" required /><Input name="phone" label="Phone with country code" required /><Input name="tags" label="Tags" placeholder="lead, customer" /><Input name="optInSource" label="Opt-in source" /><Input name="consentEvidence" label="Consent evidence (when allowed)" placeholder="When and how this contact opted in" /><label className="checkRow"><input name="marketingPermission" type="checkbox" /> Marketing permission recorded</label><button className="primaryAction" type="submit"><Plus size={18} /> Add contact</button></form></Panel>}
      {canManage && <Panel title="Import contacts" subtitle="CSV: name, phone, permission, tags, opt_in_source, consent_evidence"><form className="formGrid importForm" onSubmit={importRows}><label className="fileDrop"><input type="file" accept=".csv,text/csv" onChange={chooseFile} /><Upload size={22} /><strong>{fileName || "Choose CSV file"}</strong><span>{fileName ? "Ready to import" : "or paste CSV rows below"}</span></label><label>CSV rows<textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder="name,phone,permission,tags,opt_in_source,consent_evidence" /></label><div className="importMeta"><span>{csvText.trim() ? `${csvText.trim().split(/\r?\n/).length} rows ready` : "No rows loaded"}</span><button className="secondaryAction" type="submit" disabled={!csvText.trim()}><Upload size={18} /> Import</button></div></form></Panel>}
    </div>
    {state.featureFlags?.segments && <SavedSegments initialSegments={state.audienceSegments || []} canManage={canManage} mutate={mutate} />}
    <Panel title="Contacts" subtitle={loadingContacts ? 'Loading…' : `${contacts.length} on page · ${pagination.total ?? 0} total`}><div className="dataToolbar contactToolbar"><label className="searchBox"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search contacts" aria-label="Search contacts" /></label><select value={permissionFilter} aria-label="Filter contacts by consent" onChange={(event) => { setPermissionFilter(event.target.value); setPage(1); }}><option value="all">All contacts</option><option value="allowed">Marketable</option><option value="blocked">Suppressed</option></select>{canManage && <a className="secondaryAction exportAction" href="/api/contacts/export"><Download size={18} /> Export CSV</a>}</div>{contactsError && <div className="analyticsSectionError" role="alert"><strong>Could not load contacts</strong><p>{contactsError}</p><button className="secondaryAction" type="button" onClick={refreshContacts}>Retry</button></div>}<DataTable headers={["Name", "Phone", "Permission", "Last activity", "Actions"]}>{contacts.map((contact) => <tr key={contact.id}><td><strong>{contact.name}</strong><div className="chipRow compact">{(contact.tags || []).map((tag) => <span key={tag}>{tag}</span>)}</div></td><td>{contact.phone}</td><td><Badge kind={contact.unsubscribed ? "bad" : contact.marketingPermission ? "good" : "bad"}>{contact.unsubscribed ? "Suppressed" : contact.marketingPermission ? "Allowed" : "Blocked"}</Badge></td><td>{formatTime(contact.lastMessageAt)}</td><td className="rowActions">{canManage && <><button onClick={() => setEditContact(contact)}><Pencil size={15} /> Edit</button><button className="dangerText" onClick={() => mutate(postJson(`/api/contacts/${contact.id}`, {}, "DELETE").then(() => refreshContacts()), "Removed")}><Trash2 size={15} /> Remove</button></>}</td></tr>)}</DataTable>{!contacts.length && !loadingContacts && !contactsError && <EmptyState text={search.trim() ? 'No contacts match this search' : permissionFilter !== 'all' ? 'No contacts match this filter' : 'No contacts yet'} />}{(pagination.pages > 1 || page > 1) && <nav className="pagination" aria-label="Contacts pagination"><span>Page {pagination.page} of {pagination.pages}</span><div><button className="secondaryAction" type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button><button className="secondaryAction" type="button" disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</button></div></nav>}</Panel>
    {editContact && <div className="modalBackdrop" role="presentation" onMouseDown={() => setEditContact(null)}><section className="editModal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="kicker">Contact profile</p><h2>Edit contact</h2></div><button className="iconButton" type="button" onClick={() => setEditContact(null)} aria-label="Close"><X size={18} /></button></header><form className="formGrid" onSubmit={saveContact}><Input name="name" label="Name" defaultValue={editContact.name} required /><Input name="phone" label="Phone" defaultValue={editContact.phone} required /><Input name="tags" label="Tags" defaultValue={(editContact.tags || []).join(", ")} /><Input name="optInSource" label="Opt-in source" defaultValue={editContact.optInSource || ""} /><Input name="consentEvidence" label="New consent evidence (if restoring permission)" /><label>Marketing permission<select name="marketingPermission" defaultValue={editContact.marketingPermission && !editContact.unsubscribed ? "allowed" : "blocked"}><option value="allowed">Allowed</option><option value="blocked">Suppressed</option></select></label><label>Custom fields<textarea name="customAttributes" defaultValue={attributesToText(editContact.customAttributes)} placeholder={"company=Example\ninterest=Pricing"} /></label><button className="primaryAction" type="submit"><Save size={18} /> Save changes</button></form></section></div>}
  </div>;
}
function TemplateInsights({ template }) {
  const [days, setDays] = useState(30);
  const [insights, setInsights] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  if (!template.metaTemplateId) return null;
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api(`/api/templates/${encodeURIComponent(template.id)}/analytics?days=${days}`);
      setInsights(result);
    } catch (cause) {
      setInsights(null);
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  };
  return <div className="templateInsights">
    <div className="templateInsightsControls">
      <label>Period<select value={days} onChange={(event) => { setDays(Number(event.target.value)); setInsights(null); }}>
        <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
      </select></label>
      <button className="secondaryAction" type="button" disabled={loading} onClick={load}>
        <BarChart3 size={16} /> {loading ? "Loading" : "Meta insights"}
      </button>
    </div>
    {error && <p className="errorLine" role="alert">{error}</p>}
    {insights && <div className="templateInsightsMetrics">
      <div><strong>{insights.sent}</strong><span>Sent</span></div>
      <div><strong>{insights.delivered}</strong><span>Delivered</span></div>
      <div><strong>{insights.read}</strong><span>Read</span></div>
      {!insights.daysReported && <p>Meta has no data for this period.</p>}
    </div>}
  </div>;
}
function Templates({ state, mutate }) {
  const accounts = (state.whatsappOperations?.accounts || []).filter((account) => account.status === "connected" && account.token?.status && account.token.status !== "unknown" && account.token.status !== "expired");
  const [accountId, setAccountId] = useState(accounts.find((account) => account.isDefault)?.id || accounts[0]?.id || "");
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const create = (event) => {
    event.preventDefault();
    if (!selectedAccount?.id) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    mutate(postJson("/api/templates", {
      accountId: selectedAccount.id,
      name: values.get("name"), category: values.get("category"), language: values.get("language"),
      headerFormat: values.get("headerFormat"), headerText: values.get("headerText"), headerMediaHandle: values.get("headerMediaHandle"),
      body: values.get("body"), footerText: values.get("footerText"), buttons: values.get("buttons"),
      advancedButtons: values.get("advancedButtons"), otpType: values.get("otpType"),
      otpButtonText: values.get("otpButtonText"), codeExpirationMinutes: values.get("codeExpirationMinutes"),
      otpPackageName: values.get("otpPackageName"), otpSignatureHash: values.get("otpSignatureHash"),
      otpAutofillText: values.get("otpAutofillText"),
      submitToMeta: true
    }).then((next) => { form.reset(); return next; }), "Template submitted");
  };
  const sync = () => mutate(postJson("/api/templates/sync", { accountId }), "Templates synced");
return <div className="screenGrid"><section className="actionBand"><div><strong>Meta template library</strong><span>Approval status and components stay synchronized with your WhatsApp account.</span></div><button className="secondaryAction" type="button" onClick={sync} disabled={!selectedAccount}><RefreshCcw size={18} /> Sync from Meta</button></section><label>WhatsApp account<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Select an account</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name ? `${account.name} (${account.wabaId})` : account.wabaId}</option>)}</select></label><Panel title="Create WhatsApp template" subtitle="Marketing, utility, authentication, media headers, and action buttons"><form className="templateComposer fullTemplateComposer" onSubmit={create}><Input name="name" label="Template name" required /><label>Category<select name="category"><option value="MARKETING">Marketing</option><option value="UTILITY">Utility</option><option value="AUTHENTICATION">Authentication / OTP</option></select></label><Input name="language" label="Meta language code" defaultValue="en_US" pattern="[a-z]{2,3}(_[A-Z]{2})?" maxLength="9" required /><label>Header format<select name="headerFormat"><option value="NONE">No header</option><option value="TEXT">Text</option><option value="IMAGE">Image</option><option value="VIDEO">Video</option><option value="DOCUMENT">Document</option></select></label><Input name="headerText" label="Text header" maxLength="60" /><Input name="headerMediaHandle" label="Meta media handle" /><label className="templateBodyField">Body<textarea name="body" placeholder="Use variables like {{name}}" required /></label><Input name="footerText" label="Footer" maxLength="60" /><Input name="buttons" label="Quick replies" placeholder="Pricing, Book demo" /><details className="advancedTemplateFields"><summary>Advanced buttons and OTP settings</summary><label>Buttons<textarea name="advancedButtons" rows="4" placeholder={"QUICK_REPLY|Pricing\nURL|Visit website|https://example.com\nPHONE_NUMBER|Call us|+919000000000"} /></label><div className="formSplit"><label>OTP action<select name="otpType"><option value="COPY_CODE">Copy code</option><option value="ONE_TAP">One-tap autofill</option></select></label><Input name="otpButtonText" label="OTP button text" defaultValue="Copy code" maxLength="25" /><Input name="codeExpirationMinutes" label="Code expiry (minutes)" type="number" min="1" max="90" defaultValue="10" /></div><div className="formSplit"><Input name="otpPackageName" label="Android package name (one-tap)" autoComplete="off" /><Input name="otpSignatureHash" label="Android app signature hash (one-tap)" autoComplete="off" /><Input name="otpAutofillText" label="One-tap button text" maxLength="25" /></div></details><button className="primaryAction" type="submit" disabled={!selectedAccount}><MessageSquareText size={18} /> Submit to Meta</button></form></Panel><AdvancedTemplateComposer accountId={accountId} postJson={postJson} api={api} flowsEnabled={Boolean(state.featureFlags?.whatsapp_flows)} onCreated={()=>mutate(Promise.resolve({ok:true}),"Template submitted")}/><div className="cardGrid">{state.templates.map((template) => <article className="templateCard" key={template.id}><div className="cardHead"><div><h3>{template.name}</h3><small>{template.category} | {template.language} | {accounts.find((account) => account.wabaId === template.wabaId)?.name || template.wabaId || "Unassigned"} | {template.componentSchema?.headerFormat || "TEXT"} | content revision {template.contentRevision ?? 1}</small></div><Badge kind={template.status === "Approved" ? "good" : template.status === "Pending" ? "warn" : "bad"}>{template.status}</Badge></div>{template.headerText && <strong className="templateHeaderText">{template.headerText}</strong>}<p>{template.body}</p>{template.footerText && <small className="templateFooterText">{template.footerText}</small>}<div className="chipRow">{(template.buttons || []).map((button) => <span key={`${button.type || "button"}-${button.text}`}>{button.type && button.type !== "QUICK_REPLY" ? `${button.type}: ` : ""}{button.text}</span>)}{template.variables.map((variable) => <span key={variable}>{`{{${variable}}}`}</span>)}</div><TemplateInsights template={template} />{template.rejectionReason && <small className="errorLine">{template.rejectionReason}</small>}</article>)}</div>{!state.templates.length && <Panel title="No templates"><EmptyState text="Submit or sync a WhatsApp template to begin" /></Panel>}</div>;
}
function AutomationFlows({ state, mutate, approvedTemplates, changePage }) {
  const flows = state.automationFlows || [];
  const teamMembers = state.teamMembers || [];
  const [editingId, setEditingId] = useState("");
  const [flowMeta, setFlowMeta] = useState({ name: "", description: "", status: "draft", triggerMode: "keywords", triggerKeywords: "" });
  const [nodes, setNodes] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [connectingFrom, setConnectingFrom] = useState("");
  const [selectedTemplateDetails, setSelectedTemplateDetails] = useState({});
  const [formError, setFormError] = useState("");
  const [simulateText, setSimulateText] = useState("");
  const [simulateApiOutcome, setSimulateApiOutcome] = useState("success");
  const [simulateApiStatus, setSimulateApiStatus] = useState("200");
  const [simulateAdvancedOutcome, setSimulateAdvancedOutcome] = useState("success");
  const [simulateResult, setSimulateResult] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [flowSearch, setFlowSearch] = useState("");
  const analytics = flows.reduce((totals, flow) => ({
    active: totals.active + flow.activeSessions,
    completed: totals.completed + flow.completedSessions,
    handoff: totals.handoff + flow.handoffSessions,
    pending: totals.pending + flow.pendingJobs
  }), { active: 0, completed: 0, handoff: 0, pending: 0 });
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;

  const allowedCanvasNodeTypes = useMemo(() => {
    const allowed = new Set(AUTOMATION_NODE_PALETTE.map((item) => item.type));
    if (!state.featureFlags?.whatsapp_flows) ['send_native_flow'].forEach((type) => allowed.delete(type));
    if (!state.featureFlags?.webviews) ['send_webview_cta'].forEach((type) => allowed.delete(type));
    if (!state.featureFlags?.commerce) ['single_product', 'multi_product', 'order_lookup', 'set_order_status'].forEach((type) => allowed.delete(type));
    if (!state.featureFlags?.ai_agent) ['ai_route'].forEach((type) => allowed.delete(type));
    return allowed;
  }, [state.featureFlags?.whatsapp_flows, state.featureFlags?.webviews, state.featureFlags?.commerce, state.featureFlags?.ai_agent]);
  const createNode = (type = "question", position = {}) => ({
    id: `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    body: "",
    inputKind: ["send_native_flow", "send_webview_cta", "single_product", "multi_product", "ai_route", "end", "handoff"].includes(type) ? "none" : type === "section_list" ? "list" : "buttons",
    options: [],
    next: "",
    fallback: "",
    captureAs: "",
    templateId: "",
    delayMinutes: 0,
    assignedUserId: "",
    allowedDestinations: [],
    statusBranches: [],
    productSections: [],
    canvasX: Number.isFinite(position.canvasX) ? position.canvasX : undefined,
    canvasY: Number.isFinite(position.canvasY) ? position.canvasY : undefined
  });
  const reset = () => { setEditingId(""); setFlowMeta({ name: "", description: "", status: "draft", triggerMode: "keywords", triggerKeywords: "" }); setNodes([]); setSelectedNodeId(""); setConnectingFrom(""); setFormError(""); setEditorOpen(false); setSimulateResult(null); };
  const startNewWorkflow = () => {
    setEditingId("");
    setFlowMeta({ name: "", description: "", status: "draft", triggerMode: "keywords", triggerKeywords: "" });
    setNodes([]);
    setSelectedNodeId("");
    setConnectingFrom("");
    setFormError("");
    setSimulateResult(null);
    setEditorOpen(true);
  };
  const updateMeta = (key, value) => setFlowMeta((current) => ({ ...current, [key]: value }));
  const updateNode = (nodeId, key, value) => setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, [key]: value } : node));
  const addNode = (type = "question", position = {}) => {
    const nextType = allowedCanvasNodeTypes.has(type) ? type : 'question';
    const node = createNode(nextType, position);
    setNodes((current) => [...current, node]);
    setSelectedNodeId(node.id);
    setEditorOpen(true);
  };
  const removeNode = (nodeId) => {
    setNodes((current) => current.filter((node) => node.id !== nodeId).map((node) => ({
      ...node,
      next: node.next === nodeId ? "" : node.next,
      falseNext: node.falseNext === nodeId ? "" : node.falseNext,
      errorNext: node.errorNext === nodeId ? "" : node.errorNext,
      timeoutNext: node.timeoutNext === nodeId ? "" : node.timeoutNext,
      options: (node.options || []).map((option) => ({ ...option, next: option.next === nodeId ? "" : option.next })),
      allowedDestinations: (node.allowedDestinations || []).filter((id) => id !== nodeId)
    })));
    setSelectedNodeId((current) => current === nodeId ? "" : current);
    setConnectingFrom((current) => current === nodeId ? "" : current);
  };
  const connectNodes = (fromId, toId) => {
    updateNode(fromId, "next", toId);
    setConnectingFrom("");
    setSelectedNodeId(fromId);
  };
  const addOption = (nodeId) => setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, options: [...node.options, { id: `option_${node.options.length + 1}`, label: "", description: "", match: "", next: "" }] } : node));
  const updateOption = (nodeId, index, key, value) => setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, options: node.options.map((option, optionIndex) => optionIndex === index ? { ...option, [key]: value } : option) } : node));
  const removeOption = (nodeId, index) => setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, options: node.options.filter((_, optionIndex) => optionIndex !== index) } : node));

  const loadFlow = (flow) => {
    setEditingId(flow.id);
    setFlowMeta({ name: flow.name, description: flow.description || "", status: flow.status || "draft", triggerMode: flow.triggerMode || "keywords", triggerKeywords: (flow.triggerKeywords || []).join(", ") });
    const loaded = (flow.definition?.nodes || []).map((node) => ({
      id: node.id,
      type: node.type || "question",
      body: node.body || "",
      inputKind: node.inputKind || "text",
      options: (node.options || []).map((option) => ({ ...option, match: (option.match || []).join(", ") })),
      next: node.next || "",
      fallback: node.fallback || "",
      captureAs: node.captureAs || "",
      buttonText: node.buttonText || "",
      sectionTitle: node.sectionTitle || "",
      templateId: node.templateId || "",
      templateValues: node.templateValues || {},
      templateParameters: node.templateParameters || {},
      delayMinutes: node.delayMinutes || 0,
      assignedUserId: node.assignedUserId || "",
      canvasX: node.canvasX,
      canvasY: node.canvasY,
      errorNext:node.errorNext||"",falseNext:node.falseNext||"",timeoutNext:node.timeoutNext||"",statusBranches:node.statusBranches||[],attribute:node.attribute||"",operator:node.operator||"equals",compareValue:node.compareValue??"",valueSource:node.valueSource||{kind:'context',key:''},connectionId:node.connectionId||"",requestFields:node.requestFields||[],responseMapping:node.responseMapping||[],orderIdSource:node.orderIdSource||{kind:'context',key:''},orderStatus:node.orderStatus||"processing",model:node.model||"",prompt:node.prompt||"",allowedDestinations:node.allowedDestinations||[],catalogId:node.catalogId||"",retailerId:node.retailerId||"",productSections:node.productSections||[],nativeFlowId:node.nativeFlowId||"",ctaLabel:node.ctaLabel||"Open",expiresHours:node.expiresHours||24,webviewId:node.webviewId||"",waitForCompletion:node.waitForCompletion===true
    }));
    setNodes(loaded);
    setSelectedNodeId(flow.definition?.startNodeId || loaded[0]?.id || "");
    setConnectingFrom("");
    setFormError("");
    setEditorOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const duplicateFlow = (flow) => {
    loadFlow(flow);
    setEditingId("");
    setFlowMeta((current) => ({ ...current, name: `${flow.name} copy`, status: "draft" }));
  };

  const buildDefinition = () => {
    const cleanNodes = nodes.map((node) => ({
      id: node.id.trim(),
      type: node.type,
      body: node.body.trim(),
      inputKind: node.inputKind,
      options: node.options.map((option) => ({
        id: option.id.trim(),
        label: option.label.trim(),
        description: option.description.trim(),
        section: String(option.section || "").trim(),
        match: String(option.match || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
        next: option.next
      })).filter((option) => option.id && option.label),
      next: node.next,
      fallback: node.fallback.trim(),
      captureAs: node.captureAs.trim(),
      buttonText: String(node.buttonText || "").trim(),
      sectionTitle: String(node.sectionTitle || "").trim(),
      templateId: node.templateId,
      templateValues: node.templateValues || {},
      templateParameters: node.templateParameters || {},
      delayMinutes: Math.max(0, Number(node.delayMinutes) || 0),
      assignedUserId: node.assignedUserId,
      canvasX: Number.isFinite(Number(node.canvasX)) ? Number(node.canvasX) : undefined,
      canvasY: Number.isFinite(Number(node.canvasY)) ? Number(node.canvasY) : undefined,
      errorNext:node.errorNext||"",falseNext:node.falseNext||"",timeoutNext:node.timeoutNext||"",statusBranches:node.statusBranches||[],attribute:node.attribute||"",operator:node.operator||"equals",compareValue:node.compareValue??"",valueSource:node.valueSource||{kind:'context',key:''},connectionId:node.connectionId||"",requestFields:node.requestFields||[],responseMapping:node.responseMapping||[],orderIdSource:node.orderIdSource||{kind:'context',key:''},orderStatus:node.orderStatus||"processing",model:node.model||"",prompt:node.prompt||"",allowedDestinations:node.allowedDestinations||[],catalogId:node.catalogId||"",retailerId:node.retailerId||"",productSections:node.productSections||[],nativeFlowId:node.nativeFlowId||"",ctaLabel:node.ctaLabel||"Open",expiresHours:Number(node.expiresHours)||24,webviewId:node.webviewId||"",waitForCompletion:node.waitForCompletion===true
    })).filter((node) => node.id);
    return { startNodeId: cleanNodes[0]?.id || "", nodes: cleanNodes };
  };

  const submit = async (event) => {
    event.preventDefault();
    setFormError("");
    const definition = buildDefinition();
    if (!definition.nodes.length) { setFormError("Add at least one node before saving."); return; }
    if (["keywords", "regex"].includes(flowMeta.triggerMode) && !flowMeta.triggerKeywords.trim()) { setFormError("Add triggers or choose another trigger mode."); return; }
    if (flowMeta.status === 'active') {
      const blocked = gatedNodeTypesBlocked(definition.nodes);
      if (blocked) { setFormError(blocked); return; }
    }
    const wasEditing = Boolean(editingId);
    const saved = await mutate(postJson("/api/automation/flows", {
      id: editingId,
      name: flowMeta.name,
      description: flowMeta.description,
      status: flowMeta.status,
      triggerMode: flowMeta.triggerMode,
      triggerKeywords: flowMeta.triggerKeywords.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
      definition
    }).then((next) => { reset(); return next; }), editingId ? "Automation flow updated" : "Automation flow saved");
    if (saved && !wasEditing) await changePage("automation", 1);
  };

  const gatedNodeTypesBlocked = (definitionNodes = []) => {
    const types = new Set((definitionNodes || []).map((item) => item.type));
    if (types.has('send_native_flow') && !state.featureFlags?.whatsapp_flows) return 'This flow uses WhatsApp Flows, which are not on your plan.';
    if (types.has('send_webview_cta') && !state.featureFlags?.webviews) return 'This flow uses hosted pages, which are not on your plan.';
    if ((types.has('single_product') || types.has('multi_product') || types.has('order_lookup') || types.has('set_order_status')) && !state.featureFlags?.commerce) return 'This flow uses commerce features, which are not on your plan.';
    if (types.has('ai_route') && !state.featureFlags?.ai_agent) return 'This flow uses AI routing, which is not on your plan.';
    return '';
  };
  const updateStatus = (flow, status) => {
    if (status === 'active') {
      const blocked = gatedNodeTypesBlocked(flow.definition?.nodes || flow.nodes);
      if (blocked) { mutate(Promise.reject(new Error(blocked))); return; }
    }
    mutate(postJson(`/api/automation/flows/${flow.id}`, { status }, "PATCH"), status === "active" ? "Flow activated" : "Flow paused");
  };
  const archive = (flow) => mutate(postJson(`/api/automation/flows/${flow.id}`, {}, "DELETE"), "Flow archived");
  const process = () => mutate(postJson("/api/automation/process", { limit: 25 }), "Automation queue processed");
  const node = selectedNode;
  const selectedGatedWarning = gatedNodeTypesBlocked(nodes);

  const flowLimit = state?.subscription?.limits?.automationFlows;
  const flowUsage = state?.subscription?.usage?.automationFlows ?? flows.length;
  const filteredFlows = flows.filter((flow) => {
    const q = flowSearch.trim().toLowerCase();
    if (!q) return true;
    return [flow.name, flow.description, flow.status, flow.triggerMode, ...(flow.triggerKeywords || [])].join(" ").toLowerCase().includes(q);
  });
  const dirty = editorOpen && (Boolean(flowMeta.name.trim()) || nodes.length > 0);

  if (!editorOpen) {
    return <div className="screenGrid automationScreen automationWorkspace automationListView">
      <section className="actionBand automationTopbar compactAutomationTopbar">
        <div>
          <strong>Workflows</strong>
          <span>{flowLimit != null ? `${flowUsage} / ${flowLimit} on this plan` : `${flows.length} saved`} · {analytics.active} active sessions · {analytics.pending} pending</span>
        </div>
        <div className="actionCluster">
          <button className="primaryAction" type="button" onClick={startNewWorkflow}><Plus size={16} /> New workflow</button>
          <details className="techDetails automationOpsMenu">
            <summary>Ops</summary>
            <button className="secondaryAction" type="button" onClick={process}><RefreshCcw size={16} /> Run pending steps</button>
            <AutomationLiveOpsPanel api={api} />
          </details>
        </div>
      </section>
      <label className="searchBox automationFlowSearch"><Search size={16} /><input value={flowSearch} onChange={(event) => setFlowSearch(event.target.value)} placeholder="Search workflows" /></label>
      <div className="flowCardGrid" aria-label="Saved workflows">
        {filteredFlows.map((flow) => <article className="templateCard flowCard" key={flow.id}>
          <div className="cardHead"><div><h3>{flow.name}</h3><p>{flow.description || "No description"}</p></div><Badge kind={flow.status === "active" ? "good" : flow.status === "paused" ? "warn" : "neutral"}>{flow.status}</Badge></div>
          <div className="chipRow">{(flow.triggerKeywords || []).map((keyword) => <span key={keyword}>{keyword}</span>)}{!(flow.triggerKeywords || []).length && <span>{flow.triggerMode}</span>}</div>
          <small className="fieldHint">{flow.activeSessions || 0} active · {flow.pendingJobs || 0} pending · {flow.completedSessions || 0} completed{flow.lastActivityAt ? ` · last ${formatTime(flow.lastActivityAt)}` : ""}</small>
          <div className="flowActions">
            <button className="secondaryAction" type="button" onClick={() => loadFlow(flow)}>Edit</button>
            <button className="secondaryAction" type="button" onClick={() => duplicateFlow(flow)}>Duplicate</button>
            <button className="secondaryAction" type="button" onClick={() => updateStatus(flow, flow.status === "active" ? "paused" : "active")}>{flow.status === "active" ? "Pause" : "Activate"}</button>
            <button className="secondaryAction dangerSoft" type="button" onClick={() => { if (window.confirm(`Archive "${flow.name}"? Active sessions will stop matching this flow.`)) archive(flow); }}><Trash2 size={16} /> Archive</button>
          </div>
        </article>)}
        {!flows.length && <Panel title="No workflows yet"><EmptyState text="Create a workflow, connect nodes on the canvas, save as draft, then activate when ready." /><button className="primaryAction" type="button" onClick={startNewWorkflow}><Plus size={16} /> New workflow</button></Panel>}
        {flows.length > 0 && !filteredFlows.length && <Panel title="No matches"><EmptyState text="No workflows match this search." /></Panel>}
      </div>
      <details className="techDetails saasAdvancedBlock"><summary>API connections</summary><AutomationConnections api={api} postJson={postJson} role={state?.account?.role}/></details>
    </div>;
  }

  return <div className="screenGrid automationScreen automationWorkspace automationEditorView">
    <section className="actionBand automationTopbar compactAutomationTopbar">
      <div>
        <strong>{editingId ? (flowMeta.name || "Edit workflow") : "New workflow"}</strong>
        <span>{dirty ? "Unsaved changes" : "Draft until you save"} · {flowMeta.status}</span>
      </div>
      <div className="actionCluster">
        <button className="secondaryAction" type="button" onClick={() => { if (dirty && !window.confirm("Discard unsaved workflow changes and return to the list?")) return; reset(); }}>Back to list</button>
        <button className="secondaryAction" type="button" onClick={() => addNode("question")}><Plus size={16} /> Add node</button>
        <details className="techDetails automationOpsMenu">
          <summary>Ops</summary>
          <button className="secondaryAction" type="button" onClick={process}><RefreshCcw size={16} /> Run pending steps</button>
          <span className="fieldHint">Sessions: {analytics.active} active · {analytics.pending} pending · {analytics.completed} completed</span>
          <AutomationLiveOpsPanel api={api} />
        </details>
      </div>
    </section>

    <form className="visualFlowShell visualFlowShellCanvas automationEditorShell" onSubmit={submit}>
      <AutomationFlowCanvas
        nodes={nodes}
        startNodeId={nodes[0]?.id || ""}
        selectedId={selectedNodeId}
        onSelect={setSelectedNodeId}
        onNodesChange={setNodes}
        onAddNode={addNode}
        onRemoveNode={removeNode}
        onConnect={connectNodes}
        connectingFrom={connectingFrom}
        onStartConnect={setConnectingFrom}
        onCancelConnect={() => setConnectingFrom("")}
        allowedNodeTypes={allowedCanvasNodeTypes}
      />

      <div className="automationInspector">
      <Panel title="Workflow" subtitle="Name, trigger, and publish state">
        <div className="formGrid automationForm">
          <Input label="Flow name" value={flowMeta.name} onChange={(event) => updateMeta("name", event.target.value)} placeholder="Flow name" required />
          <label>Description<textarea rows="2" value={flowMeta.description} onChange={(event) => updateMeta("description", event.target.value)} placeholder="Optional internal note"></textarea></label>
          <div className="formSplit"><label>Status<select value={flowMeta.status} onChange={(event) => updateMeta("status", event.target.value)}><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option></select></label><label>Trigger mode<select value={flowMeta.triggerMode} onChange={(event) => updateMeta("triggerMode", event.target.value)}><option value="keywords">Keywords</option><option value="regex">Safe regex</option><option value="any_inbound">Any inbound message</option><option value="manual">Manual only</option></select></label></div>
          <label>{flowMeta.triggerMode === "regex" ? "Regex triggers" : "Trigger keywords"}<textarea rows="3" maxLength="4000" value={flowMeta.triggerKeywords} onChange={(event) => updateMeta("triggerKeywords", event.target.value)} placeholder="Comma or line separated triggers"></textarea></label>
          {formError && <div className="formError" role="alert">{formError}</div>}
          {selectedGatedWarning && <div className="formError" role="alert">{selectedGatedWarning}</div>}
          <details className="techDetails"><summary>Simulate path</summary>
            <div className="formSplit"><label>Sample reply<input value={simulateText} onChange={(event) => setSimulateText(event.target.value)} placeholder="Text a customer might send" /></label><label>API outcome<select value={simulateApiOutcome} onChange={(event) => setSimulateApiOutcome(event.target.value)}><option value="success">Success</option><option value="timeout">Timeout</option><option value="error">Error</option></select></label></div>
            <div className="formSplit"><label>API status<input value={simulateApiStatus} onChange={(event) => setSimulateApiStatus(event.target.value)} placeholder="200 or 4xx" /></label><label>Advanced node outcome<select value={simulateAdvancedOutcome} onChange={(event) => setSimulateAdvancedOutcome(event.target.value)}><option value="success">Success</option><option value="error">Error</option></select></label></div>
            <button className="secondaryAction" type="button" onClick={async () => { setFormError(""); try { setSimulateResult(await postJson("/api/automation/simulate", { definition: buildDefinition(), text: simulateText, apiOutcome: simulateApiOutcome, apiStatus: simulateApiStatus, advancedOutcome: simulateAdvancedOutcome })); } catch (error) { setFormError(error.message); setSimulateResult(null); } }}>Run simulation</button>
            {simulateResult && <ol className="simulateTrail">{simulateResult.steps.map((step) => <li key={step.nodeId}><strong>{step.type}</strong> {step.body || step.detail || ""}</li>)}</ol>}
          </details>
          <button className="primaryAction" type="submit"><Bot size={16} /> <span>{editingId ? "Save changes" : "Save draft"}</span></button>
        </div>
      </Panel>

      {node ? <Panel title="Node" subtitle={node.type}>
        <div className="nodeFields">
          <label>Node ID<input value={node.id} onChange={(event) => { const nextId = event.target.value; setNodes((current) => current.map((item) => item.id === node.id ? { ...item, id: nextId } : item)); setSelectedNodeId(nextId); }} /></label>
          <label>Type<select value={node.type} onChange={(event) => { const value = event.target.value; setNodes((current) => current.map((item) => item.id === node.id ? { ...item, type: value, ...(value === "section_list" ? { inputKind: "list" } : {}), ...(["send_native_flow", "send_webview_cta", "single_product", "multi_product", "ai_route"].includes(value) ? { inputKind: "none" } : {}) } : item)); }}><option value="question">Question</option><option value="message">Message</option><option value="template">Template follow-up</option>{state.featureFlags?.whatsapp_flows && <option value="send_native_flow">Send native WhatsApp Flow</option>}{state.featureFlags?.webviews && <option value="send_webview_cta">Send hosted page CTA</option>}<option value="section_list">Section list</option>{state.featureFlags?.commerce && <option value="single_product">Single product</option>}{state.featureFlags?.commerce && <option value="multi_product">Multi-product list</option>}{state.featureFlags?.ai_agent && <option value="ai_route">AI route</option>}<option value="handoff">Human handoff</option><option value="end">End</option><option value="attribute_condition">Contact condition</option><option value="set_contact_attribute">Set contact field</option><option value="api_request">API request</option>{state.featureFlags?.commerce && <option value="order_lookup">Order lookup</option>}{state.featureFlags?.commerce && <option value="set_order_status">Update order status</option>}</select></label>
          <label>Input<select value={node.type === "section_list" ? "list" : node.inputKind} disabled={node.type === "section_list"} onChange={(event) => updateNode(node.id, "inputKind", event.target.value)}><option value="buttons">Buttons</option><option value="list">List</option><option value="text">Free text</option><option value="none">No input</option></select></label>
          {node.type === "section_list" && <div className="nodeFields"><label>List button text<input maxLength={20} value={node.buttonText || ""} onChange={(event) => updateNode(node.id, "buttonText", event.target.value)} placeholder="Choose" /></label><label>Section title<input maxLength={24} value={node.sectionTitle || ""} onChange={(event) => updateNode(node.id, "sectionTitle", event.target.value)} placeholder="Options" /></label></div>}
          <label>Next node<select value={node.next} onChange={(event) => updateNode(node.id, "next", event.target.value)}><option value="">None</option>{nodes.filter((item) => item.id !== node.id).map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>
          <label className="checkRow"><input type="checkbox" checked={nodes[0]?.id === node.id} onChange={() => setNodes((current) => { const index = current.findIndex((item) => item.id === node.id); if (index <= 0) return current; const next = [...current]; const [moved] = next.splice(index, 1); next.unshift(moved); return next; })} /> Mark as start node</label>
        </div>
        <AutomationAdvancedNodeFields node={node} nodes={nodes} update={(key,value)=>updateNode(node.id,key,value)} api={api}/>
        {node.type === "template" && <div className="nodeFields"><label>Approved template<ApprovedTemplatePicker api={api} initialTemplates={approvedTemplates} value={node.templateId} onChange={value => updateNode(node.id, "templateId", value)} onTemplate={template => setSelectedTemplateDetails(current => current[node.id]?.id === template?.id ? current : { ...current, [node.id]: template })} /></label><label>Delay minutes<input type="number" min="0" value={node.delayMinutes} onChange={(event) => updateNode(node.id, "delayMinutes", event.target.value)} /></label></div>}
        {node.type === "template" && <><div className="nodeFields">{(selectedTemplateDetails[node.id]?.id === node.templateId ? selectedTemplateDetails[node.id] : approvedTemplates.find(template=>template.id===node.templateId))?.variables?.map(key=><label key={key}>Variable {key}<input required value={node.templateValues?.[key]||""} onChange={event=>updateNode(node.id,"templateValues",{...(node.templateValues||{}),[key]:event.target.value})}/></label>)}</div><TemplateParameterFields template={selectedTemplateDetails[node.id]?.id === node.templateId ? selectedTemplateDetails[node.id] : approvedTemplates.find(template=>template.id===node.templateId)} value={node.templateParameters||{}} onChange={value=>updateNode(node.id,"templateParameters",value)}/></>}
        {node.type === "send_native_flow" && <div className="nodeFields"><label>Published Flow ID<input required value={node.nativeFlowId || ""} onChange={(event) => updateNode(node.id, "nativeFlowId", event.target.value)} placeholder="waf_…" /></label><label>CTA label<input maxLength={20} value={node.ctaLabel || "Open"} onChange={(event) => updateNode(node.id, "ctaLabel", event.target.value)} /></label><label>Expires (hours)<input type="number" min="1" max="168" value={node.expiresHours || 24} onChange={(event) => updateNode(node.id, "expiresHours", event.target.value)} /></label><label>Resume node<select value={node.next || ""} onChange={(event) => updateNode(node.id, "next", event.target.value)}><option value="">End after submission</option>{nodes.filter((item) => item.id !== node.id).map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label></div>}
        {node.type === "send_webview_cta" && <div className="nodeFields"><label>Hosted page ID<input required value={node.webviewId || ""} onChange={(event) => updateNode(node.id, "webviewId", event.target.value)} placeholder="wv_…" /></label><label className="checkRow"><input type="checkbox" checked={node.waitForCompletion === true} onChange={(event) => updateNode(node.id, "waitForCompletion", event.target.checked)} /> Wait for transactional completion</label><label>Next node<select value={node.next || ""} onChange={(event) => updateNode(node.id, "next", event.target.value)}><option value="">Stop</option>{nodes.filter((item) => item.id !== node.id).map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label></div>}
        {node.type === "handoff" && <label>Assign to<select value={node.assignedUserId} onChange={(event) => updateNode(node.id, "assignedUserId", event.target.value)}><option value="">Keep unassigned</option>{teamMembers.map((member) => <option key={member.id} value={member.id}>{member.name || member.email}</option>)}</select></label>}
        <label>Message<textarea rows="4" value={node.body} onChange={(event) => updateNode(node.id, "body", event.target.value)} placeholder="Message body. Use variables like {{name}} or captured values."></textarea></label>
        <div className="nodeFields"><label>Fallback<textarea rows="2" value={node.fallback} onChange={(event) => updateNode(node.id, "fallback", event.target.value)} placeholder="Shown when reply does not match"></textarea></label><label>Capture as<input value={node.captureAs} onChange={(event) => updateNode(node.id, "captureAs", event.target.value)} placeholder="Variable name" /></label></div>
        {(node.inputKind === "buttons" || node.inputKind === "list" || node.type === "section_list") && <div className="optionEditor"><div className="optionHead"><strong>{node.type === "section_list" ? "Section rows" : "Options"}</strong><button className="secondaryAction" type="button" onClick={() => addOption(node.id)} disabled={node.options.length >= (node.inputKind === "buttons" && node.type !== "section_list" ? 3 : 10)}><Plus size={16} /> Add option</button></div>{node.options.map((option, optionIndex) => <div className="optionRow" key={`${node.id}-${optionIndex}`}>{node.type === "section_list"&&<input value={option.section||""} maxLength="24" onChange={(event) => updateOption(node.id, optionIndex, "section", event.target.value)} placeholder="section" />}<input value={option.id} onChange={(event) => updateOption(node.id, optionIndex, "id", event.target.value)} placeholder="id" /><input value={option.label} onChange={(event) => updateOption(node.id, optionIndex, "label", event.target.value)} placeholder="label" /><input value={option.match} onChange={(event) => updateOption(node.id, optionIndex, "match", event.target.value)} placeholder="match terms" /><select value={option.next} onChange={(event) => updateOption(node.id, optionIndex, "next", event.target.value)}><option value="">Next</option>{nodes.filter((item) => item.id !== node.id).map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select><button className="iconButton dangerSoft" type="button" onClick={() => removeOption(node.id, optionIndex)}><Trash2 size={15} /></button></div>)}</div>}
      </Panel> : <Panel title="Node" subtitle="Select a node on the canvas"><EmptyState text="Click a node to configure it here." /></Panel>}
      </div>
    </form>
  </div>;
}
function Campaigns({ state, approvedTemplates, marketableContacts, mutate, setActiveView, campaignRetarget, setCampaignRetarget }) {
  const phones = (state.whatsappOperations?.phoneNumbers || []).filter((phone) => state.whatsappOperations?.accounts?.some((account) => account.id === phone.accountId && account.status === "connected" && account.token?.status && account.token.status !== "unknown" && account.token.status !== "expired"));
  const [phoneNumberId, setPhoneNumberId] = useState(phones.find((phone) => phone.isDefault)?.phoneNumberId || phones[0]?.phoneNumberId || "");
  const selectedPhone = phones.find((phone) => phone.phoneNumberId === phoneNumberId);
  const selectedAccount = state.whatsappOperations?.accounts?.find((account) => account.id === selectedPhone?.accountId);
  const availableTemplates = approvedTemplates.filter((item) => item.wabaId === selectedAccount?.wabaId || (!item.wabaId && selectedAccount?.wabaId === state?.setup?.wabaId));
  const activeFlows = (state.automationFlows || []).filter((flow) => flow.status === "active");
  const segments = (state.audienceSegments || []).filter((segment) => segment.isActive);
  const [templateId, setTemplateId] = useState(availableTemplates[0]?.id || "");
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [deliveryMethod, setDeliveryMethod] = useState('cloud_api');
  const [templateParameters, setTemplateParameters] = useState({});
  useEffect(() => { setTemplateParameters({}); }, [templateId]);
  const [automationFlowId, setAutomationFlowId] = useState("");
  const [segmentId, setSegmentId] = useState(campaignRetarget?.segmentId || "");
  const [selectedSegment, setSelectedSegment] = useState(null);
  useEffect(() => {
    if (!campaignRetarget?.segmentId) return;
    setSegmentId(campaignRetarget.segmentId);
    const match = segments.find((item) => item.id === campaignRetarget.segmentId);
    if (match) setSelectedSegment(match);
  }, [campaignRetarget?.segmentId, segments]);
  const [variables, setVariables] = useState({});
  const [recipientSearch, setRecipientSearch] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const filteredRecipients = marketableContacts.filter((contact) => [contact.name, contact.phone, ...(contact.tags || [])].join(" ").toLowerCase().includes(recipientSearch.toLowerCase()));
  useEffect(() => { if (!templateId && availableTemplates[0]?.id) setTemplateId(availableTemplates[0].id); }, [availableTemplates, templateId]);
  const template = selectedTemplate?.id === templateId ? selectedTemplate : approvedTemplates.find((item) => item.id === templateId);
  const segmentsEnabled = Boolean(state.featureFlags?.segments);
  const automationEnabled = Boolean(state.featureFlags?.automation);
  const marketingMessagesEnabled = Boolean(state.featureFlags?.marketing_messages);
  const marketingMessagesReady = selectedAccount?.marketingMessagesStatus === 'ONBOARDED' && marketingMessagesEnabled;
  useEffect(() => {
    if (!marketingMessagesReady && deliveryMethod === 'marketing_messages_api') setDeliveryMethod('cloud_api');
  }, [marketingMessagesReady, deliveryMethod]);
  useEffect(() => { if (!segmentsEnabled) { setSegmentId(''); setSelectedSegment(null); } }, [segmentsEnabled]);
  useEffect(() => { if (!automationEnabled) setAutomationFlowId(''); }, [automationEnabled]);
  const templateMatchesSender = Boolean(template && selectedAccount && (template.wabaId === selectedAccount.wabaId || (!template.wabaId && selectedAccount.wabaId === state?.setup?.wabaId)));
  const segment = segmentsEnabled ? (selectedSegment || segments.find((item) => item.id === segmentId)) : null;
  const editableVariables = (template?.variables || []).filter((variable) => variable !== "name");
  const preview = template ? renderPreview(template.body, marketableContacts[0], variables) : "Select an approved template first.";
  const toggleContact = (contactId) => setSelectedContactIds((current) => current.includes(contactId) ? current.filter((id) => id !== contactId) : [...current, contactId]);
  const submit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const safeSegmentId = segmentsEnabled ? segmentId : '';
    const safeAutomationFlowId = automationEnabled ? automationFlowId : '';
    const safeDeliveryMethod = marketingMessagesReady ? deliveryMethod : 'cloud_api';
    try {
      const created = await postJson("/api/campaigns", { name: form.get("name"), phoneNumberId, templateId, deliveryMethod: safeDeliveryMethod, parameters: templateParameters, automationFlowId: safeAutomationFlowId, segmentId: safeSegmentId, variables, contactIds: selectedContactIds, scheduledAt: form.get("scheduledAt") ? new Date(form.get("scheduledAt")).toISOString() : "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, frequencyHours: form.get('frequencyHours'), recurringIntervalDays: form.get('recurringIntervalDays') || 0, requireApproval: form.get('requireApproval')==='on', dynamicAudience: Boolean(safeSegmentId), retargetSourceCampaignId: campaignRetarget?.sourceCampaignId || "" });
      await mutate(postJson("/api/campaigns/process", { limit: 25 }), created.approvalStatus==='pending' ? 'Campaign awaiting owner review' : "Campaign queued");
      setCampaignRetarget?.(null);
      setActiveView("results");
    } catch (error) { mutate(Promise.reject(error)); }
  };
  const targetCount = segment ? segment.contactCount : selectedContactIds.length;
  return <><CampaignPolicy role={state?.account?.role} businessId={state?.account?.business?.id || ''} api={api} postJson={postJson} /><div className="campaignLayout"><Panel title="Campaign" subtitle="Send an approved template to contacts or a saved segment"><form className="formGrid" onSubmit={submit}><Input name="name" label="Campaign name" required /><label>Sending number<select value={phoneNumberId} onChange={(event) => { setPhoneNumberId(event.target.value); setTemplateId(""); setSelectedTemplate(null); setDeliveryMethod("cloud_api"); }} required><option value="">Select a number</option>{phones.map((phone) => <option key={phone.phoneNumberId} value={phone.phoneNumberId}>{phone.displayPhoneNumber || phone.verifiedName || phone.phoneNumberId}</option>)}</select></label><label>Approved template<ApprovedTemplatePicker api={api} initialTemplates={approvedTemplates.filter((item) => item.wabaId === selectedAccount?.wabaId || (!item.wabaId && selectedAccount?.wabaId === state?.setup?.wabaId))} wabaId={selectedAccount?.wabaId || ""} value={templateId} onChange={value => { setTemplateId(value); setVariables({}); setDeliveryMethod('cloud_api'); }} onTemplate={setSelectedTemplate} /></label><label>Delivery API<select value={deliveryMethod} onChange={(event) => setDeliveryMethod(event.target.value)}><option value="cloud_api">Cloud API</option>{template?.category === "MARKETING" && marketingMessagesEnabled && <option value="marketing_messages_api" disabled={!marketingMessagesReady}>Marketing Messages API</option>}</select>{template?.category === "MARKETING" && <small>Meta status: {selectedAccount?.marketingMessagesStatus || "UNKNOWN"}{!marketingMessagesEnabled ? ' · plan upgrade required for Marketing Messages API' : ''}</small>}</label>{segmentsEnabled ? <label>Saved segment<SearchableOptionPicker api={api} endpoint="/api/segments?active=1" itemsKey="segments" initialOptions={segments} value={segmentId} onChange={(value, item) => { setSegmentId(value); setSelectedSegment(item); if (value) setSelectedContactIds([]); }} label="Saved segment" placeholder="Find a saved segment" noneLabel="Select contacts manually" formatOption={item => item.name + " (" + item.contactCount + ")"} /></label> : <small>Select contacts manually — saved segments are not on this plan.</small>}<label>Schedule<input name="scheduledAt" type="datetime-local" /><small>Schedule up to {state.operationsPolicy?.campaignMaxScheduleDays ?? 60} days ahead (deployment policy).</small></label><label>Marketing interval (hours)<input name="frequencyHours" type="number" min="0" max="8760" step="1" defaultValue="0" required /></label><label>Recurring broadcast (days)<input name="recurringIntervalDays" type="number" min="0" max="365" step="1" defaultValue="0" title="After a campaign completes, spawn the next one after this many days (0 = off)" /></label><label className="checkboxLabel"><input name="requireApproval" type="checkbox" />Require owner approval</label>{automationEnabled ? <label>Reply automation<SearchableOptionPicker api={api} endpoint="/api/automation/options" itemsKey="flows" initialOptions={activeFlows} value={automationFlowId} onChange={setAutomationFlowId} label="Reply automation" placeholder="Find an active flow" noneLabel="No follow-up flow" formatOption={item => item.name} /></label> : null}{editableVariables.map((variable) => <label key={variable}>{variable}<input value={variables[variable] || ""} onChange={(event) => setVariables((current) => ({ ...current, [variable]: event.target.value }))} placeholder={`Value for {{${variable}}}`} /></label>)}{template && !templateMatchesSender && <small className="errorLine">This template belongs to another WhatsApp account. Select a matching number or template.</small>}<TemplateParameterFields template={template} value={templateParameters} onChange={setTemplateParameters} /><div className="recipientHeader"><label className="searchBox recipientSearch"><Search size={17} /><input value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} placeholder="Search eligible contacts" /></label><span>{segment ? `${segment.contactCount} from segment` : `${selectedContactIds.length} selected`}</span></div><div className="recipientBox">{filteredRecipients.map((contact) => <label key={contact.id}><span>{contact.name}<small>{contact.phone}</small></span><input checked={selectedContactIds.includes(contact.id)} onChange={() => toggleContact(contact.id)} type="checkbox" /></label>)}{!marketableContacts.length && <EmptyState text="No eligible contacts" />}</div><button className="primaryAction" type="submit" disabled={!templateMatchesSender || (!segmentId && !selectedContactIds.length)}><Clock3 size={18} /> Queue campaign{targetCount ? ` (${targetCount})` : ""}</button></form></Panel><Panel title="WhatsApp preview" subtitle={template ? `${template.name} | ${template.language}` : "No approved template selected"}><div className="phonePreview"><div className="waBubble">{template?.headerText && <strong>{template.headerText}</strong>}<p>{preview}</p>{template?.footerText && <small>{template.footerText}</small>}{template?.buttons?.length > 0 && <div className="waQuickReplies">{template.buttons.map((button) => <span key={button.text}>{button.text}</span>)}</div>}</div></div></Panel></div>{Boolean(state.featureFlags?.campaigns) && <CampaignDripManager api={api} postJson={postJson} role={state?.account?.role} businessId={state?.account?.business?.id || ''} segments={segmentsEnabled ? segments : []} approvedTemplates={approvedTemplates} />}</>;
}
function WhatsAppReferralReport() {
  const [days, setDays] = useState(30);
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    setLoading(true);
    api(`/api/whatsapp/referrals?days=${days}`).then((result) => {
      if (active) setReport(result);
    }).catch((cause) => {
      if (active) setError(cause.message || "Entry sources could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [days, refresh]);
  return <Panel title="WhatsApp entry sources" subtitle="Conversations that began from a WhatsApp ad or post" className="analyticsEntrySources">
    <div className="assetToolbar whatsappReferralToolbar">
      <label>Period<select value={days} onChange={(event) => setDays(Number(event.target.value))} disabled={loading}>
        <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
      </select></label>
      <button className="secondaryAction" type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCcw size={16} /> Refresh</button>
    </div>
    {error && (
      <div className="analyticsSectionError" role="alert">
        <strong>Entry sources unavailable</strong>
        <p>{error}</p>
        <button className="secondaryAction" type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Retry</button>
      </div>
    )}
    {!error && loading && !report && <p className="wa-module-note">Loading entry sources…</p>}
    {report && <DataTable headers={["Source", "Meta ID", "Conversations", "Latest referral"]}>
      {report.sources.map((source) => <tr key={`${source.sourceType}-${source.sourceId}`}>
        <td>{source.sourceType === "AD" ? "WhatsApp ad" : "WhatsApp post"}</td>
        <td>{source.sourceId}</td>
        <td><strong>{source.conversations}</strong></td>
        <td>{formatTime(source.lastReferralAt)}</td>
      </tr>)}
    </DataTable>}
    {report && !report.sources.length && !error && <EmptyState text="No WhatsApp ad or post referrals in this period" />}
  </Panel>;
}
function Results({ state, mutate, setActiveView, setCampaignRetarget }) {
  const campaignsEnabled = Boolean(state.featureFlags?.campaigns);
  const processQueue = () => mutate(postJson("/api/campaigns/process", { limit: 25 }), "Queue processed");
  const canManage = isWorkspaceManager(state?.account?.role);
  const segmentsEnabled = Boolean(state.featureFlags?.segments);
  const lifecycle = (campaign, action) => mutate(postJson(`/api/campaigns/${campaign.id}`, { action }, "PATCH"), `Campaign ${action}d`);
  const control = async (campaign, action, values) => { await postJson(`/api/campaigns/${campaign.id}`, { action, ...values }, 'PATCH'); await mutate(Promise.resolve({ ok: true }), 'Campaign updated'); };
  const launchRetargetCampaign = async (campaign, presetId) => {
    const seg = await postJson(`/api/campaigns/${campaign.id}/retarget`, { presetId });
    await mutate(Promise.resolve({ ok: true }), 'Retarget audience saved');
    setCampaignRetarget?.({ segmentId: seg.segmentId, sourceCampaignId: campaign.id });
    setActiveView('campaigns');
  };
  return (
    <div className="screenGrid analyticsScreen">
      {!canManage && (
        <section className="actionBand">
          <div>
            <strong>Campaign results</strong>
            <span>Read-only delivery stats for your role.</span>
          </div>
        </section>
      )}
      {canManage && campaignsEnabled && <WorkspaceResultsManagerShell api={api} postJson={postJson} />}
      {canManage && <WhatsAppReferralReport />}
      {canManage && campaignsEnabled && (
        <section className="actionBand analyticsQueueBand">
          <div><strong>Scheduled sends</strong><span>Run pending and retry deliveries.</span></div>
          <button className="secondaryAction" type="button" onClick={processQueue}><RefreshCcw size={16} /> Run pending sends</button>
        </section>
      )}
      {state.campaigns.map((campaign) => (
        <Panel key={campaign.id} title={campaign.name} subtitle={campaign.scheduledAt ? `Scheduled ${formatTime(campaign.scheduledAt)} | ${campaign.timezone}` : formatTime(campaign.createdAt)}>
          <div className="resultHeader campaignResultActions">
            <Badge kind={campaign.status === "failed" || campaign.status === "cancelled" ? "bad" : ["scheduled", "processing", "paused", "queued", "draft", "pending_approval"].includes(campaign.status) ? "warn" : "good"}>{campaign.status}</Badge>
            <Badge kind="neutral">{campaign.deliveryMethod === "marketing_messages_api" ? "Marketing Messages API" : "Cloud API"}</Badge>
            <Badge kind="neutral">{campaignSourceLabel(campaign.sourceKind)}</Badge>
            {campaign.dynamicAudience && <Badge kind="neutral">Dynamic audience</Badge>}
            {campaign.recurringIntervalDays > 0 && <Badge kind="neutral">Repeats every {campaign.recurringIntervalDays}d</Badge>}
            {canManage && campaignsEnabled && ["queued", "scheduled", "processing"].includes(campaign.status) && <button className="secondaryAction compactAction" onClick={() => lifecycle(campaign, "pause")}><Pause size={15} /> Pause</button>}
            {canManage && campaignsEnabled && campaign.status === "paused" && <button className="secondaryAction compactAction" onClick={() => lifecycle(campaign, "resume")}><Play size={15} /> Resume</button>}
            {canManage && campaignsEnabled && ["queued", "scheduled", "processing", "paused"].includes(campaign.status) && <button className="secondaryAction compactAction dangerSoft" onClick={() => lifecycle(campaign, "cancel")}><X size={15} /> Cancel</button>}
          </div>
          {campaignsEnabled && <CampaignControls campaign={campaign} role={state?.account?.role} submit={control} />}
          <ResultMeters stats={campaign.stats} />
          {campaign.statsOnly && <p className="wa-module-note">Delivery summary for agents. Per-recipient rows are available to owners and managers.</p>}
          {segmentsEnabled && canManage && (campaign.stats?.total || 0) > 0 && (
            <WhatsAppRetargetingPanel
              api={api}
              postJson={postJson}
              campaign={campaign}
              canManage={canManage}
              onSegmentCreated={() => mutate(Promise.resolve({ ok: true }), 'Retarget audience saved')}
              onLaunchCampaign={(presetId) => launchRetargetCampaign(campaign, presetId)}
            />
          )}
          {!campaign.statsOnly && <DataTable headers={["Customer", "Status", "Message"]}>
            {asArray(campaign.recipients).map((recipient) => {
              const contact = state.contacts.find((item) => item.id === recipient.contactId) || {};
              return (
                <tr key={recipient.id || recipient.metaMessageId}>
                  <td><strong>{recipient.contactName || contact.name || "Unknown"}</strong></td>
                  <td><Badge kind={recipient.status === "failed" ? "bad" : recipient.status === "queued" ? "warn" : "good"}>{recipient.status}</Badge></td>
                  <td>
                    <span>{recipient.message}</span>
                    {recipient.jobStatus && <small>{recipient.jobStatus} | Attempts {recipient.attempts} / {recipient.maxAttempts}</small>}
                    {recipient.nextRunAt && <small>Next attempt: {formatTime(recipient.nextRunAt)}</small>}
                    {recipient.jobError && recipient.jobError !== recipient.errorMessage && <small>{recipient.jobError}</small>}
                    {recipient.errorMessage && <small className="errorLine">{recipient.errorMessage}</small>}
                  </td>
                </tr>
              );
            })}
          </DataTable>}
        </Panel>
      ))}
      {!state.campaigns.length && <Panel title="No results"><EmptyState text="No campaigns yet" /></Panel>}
    </div>
  );
}
function MessageContent({ message }) {
  const mediaUrl = `/api/media/${message.id}`;
  const referral = message.metadata?.referral;
  const sourceLabel = message.metadata?.source === 'coexistence_history' ? 'Imported Business App history' : message.metadata?.source === 'coexistence_echo' ? 'Sent from Business App' : '';
  let content;
  if (message.messageType === "image" || message.messageType === "sticker") content = <><a className="mediaPreview" href={mediaUrl} target="_blank" rel="noreferrer"><Image size={16} /><img src={mediaUrl} alt={message.caption || "WhatsApp attachment"} loading="lazy" /></a>{message.caption && <p>{message.caption}</p>}</>;
  else if (message.messageType === "video") content = <><video className="messageMedia" controls preload="metadata" src={mediaUrl} /><p>{message.caption}</p></>;
  else if (message.messageType === "audio") content = <audio className="messageAudio" controls preload="metadata" src={mediaUrl} />;
  else if (message.messageType === "document") content = <a className="mediaDownload" href={mediaUrl} target="_blank" rel="noreferrer"><FileText size={17} /><span>{message.metadata?.filename || message.caption || "Open document"}</span></a>;
  else content = <p>{message.body}</p>;
  return <>{sourceLabel&&<small>{sourceLabel}</small>}{referral && <div className="messageReferral"><span>{referral.sourceType === "AD" ? "WhatsApp ad" : "WhatsApp post"} / {referral.sourceId}</span>{referral.headline && <strong>{referral.headline}</strong>}</div>}{content}</>;
}

function TemplateReplyForm({ approvedTemplates, activeContact, mutate, flowsEnabled = false }) {
  const [templateId, setTemplateId] = useState(approvedTemplates[0]?.id || "");
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [parameters, setParameters] = useState({});
  useEffect(() => { if (!templateId && approvedTemplates[0]?.id) setTemplateId(approvedTemplates[0].id); }, [approvedTemplates, templateId]);
  const template = selectedTemplate?.id === templateId ? selectedTemplate : approvedTemplates.find((item) => item.id === templateId);
  const flowButtons = template?.componentSchema?.components?.find((component) => String(component.type).toUpperCase() === 'BUTTONS')?.buttons || template?.componentSchema?.buttons || template?.buttons || [];
  const flowTemplate = flowButtons.some((button) => String(button.type).toUpperCase() === 'FLOW');
  const flowBlocked = flowTemplate && !flowsEnabled;
  const replyVariables = (template?.variables || []).filter((variable) => variable !== "name");
  const submit = async (event) => {
    event.preventDefault();
    if (flowBlocked) {
      mutate(Promise.reject(new Error('WhatsApp Flows are not included in your current plan. Open Billing to review upgrades.')));
      return;
    }
    const form = new FormData(event.currentTarget);
    const variables = Object.fromEntries(replyVariables.map((variable) => [variable, form.get(variable)]));
    const {flowInvite, ...sendParameters} = parameters;
    const path = flowTemplate ? '/api/whatsapp/flow-templates' : '/api/messages/template-reply';
    const payload = {contactId: activeContact.id, templateId, variables, parameters: flowTemplate ? {...sendParameters, flowInvite: flowInvite || {requestId: crypto.randomUUID(), expiresHours: 24}} : sendParameters};
    if (flowTemplate) payload.action = 'send';
    const succeeded = await mutate(postJson(path, payload), 'Template sent');
    if (flowTemplate && succeeded) setParameters({...sendParameters, flowInvite: {requestId: crypto.randomUUID(), expiresHours: flowInvite?.expiresHours || 24}});
  };
  return <form className="composer templateLine" onSubmit={submit}><ApprovedTemplatePicker api={api} initialTemplates={approvedTemplates} value={templateId} onChange={value => { setTemplateId(value); setParameters({}); }} onTemplate={setSelectedTemplate} />{replyVariables.map((variable) => <input key={variable} name={variable} placeholder={`{{${variable}}}`} required />)}<TemplateParameterFields template={template} value={parameters} onChange={setParameters} />{flowBlocked && <small className="errorLine" role="alert">This template needs WhatsApp Flows. Upgrade your plan to send it.</small>}<button className="secondaryAction" disabled={!template || flowBlocked}><Send size={17} /> Send template</button></form>;
}

function InteractiveReplyForm({ activeContact, mutate }) {
  const submit = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const options = String(values.options || "").split(/\r?\n/).map((row, index) => {
      const [optionId, label, description] = row.split("|").map((item) => item.trim());
      return { id: optionId || `option_${index + 1}`, label, description };
    }).filter((item) => item.label);
    if (!activeContact || !values.body?.trim() || !options.length) return;
    mutate(postJson("/api/messages/reply", {
      contactId: activeContact.id,
      body: values.body,
      mode: values.mode,
      buttonText: values.buttonText,
      sectionTitle: values.sectionTitle,
      options
    }), "Interactive message sent");
    form.reset();
  };
  return <details className="interactiveComposer"><summary><MessageSquareText size={16} /> Interactive message</summary><form onSubmit={submit}><label>Message<textarea name="body" rows="3" required /></label><div className="formSplit"><label>Format<select name="mode"><option value="buttons">Reply buttons (up to 3)</option><option value="list">List (up to 10)</option></select></label><Input name="buttonText" label="List button text" placeholder="Choose" maxLength="20" /></div><Input name="sectionTitle" label="List section title" placeholder="Options" maxLength="24" /><label>Options<textarea name="options" rows="4" placeholder={"pricing|Pricing|View pricing\ndemo|Book a demo|Choose a time"} required /></label><small>Use one option per line: identifier | title | description</small><button className="secondaryAction"><Send size={17} /> Send interactive message</button></form></details>;
}

function InboxView({ state, activeConversation, activeContact, approvedTemplates, openConversation, mutate, reloadInbox, setActiveView, inboxFilter: serverFilter = "", inboxQ: serverQ = "", inboxSyncError = "", inboxSyncing = false }) {
  const teamMembers = state.teamMembers || [];
  const currentUserId = state.account?.user?.id || "";
  const [search, setSearch] = useState(serverQ);
  const [inboxFilter, setInboxFilter] = useState(serverFilter || state?.pagination?.inbox?.appliedFilter || "all");
  const [inboxSurface, setInboxSurface] = useState("direct");
  const [replyDrafts, setReplyDrafts] = useState({});
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState('');
  const [suggestionContext, setSuggestionContext] = useState(null);
  const [sendingConversationId, setSendingConversationId] = useState(null);
  const [pendingMedia, setPendingMedia] = useState(null);
  const [profileOpen, setProfileOpen] = useState(true);
  const mediaInputRef = useRef(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const suggestionRevision = useRef(0);
  const sendingReply = useRef(false);
  const activeSuggestionConversation = useRef(activeConversation?.id);
  activeSuggestionConversation.current = activeConversation?.id;
  const conversationId = activeConversation?.id;
  const replyDraft = replyDrafts[conversationId] || '';
  const latestMessageId = activeConversation?.messages?.at?.(-1)?.id || null;
  const activeSuggestionMessage = useRef(latestMessageId);
  activeSuggestionMessage.current = latestMessageId;
  const activeSuggestion = suggestionContext?.conversationId === conversationId
    && suggestionContext?.messageId === latestMessageId
    && suggestionContext?.draft === replyDraft
    ? suggestionContext
    : null;
  // Guard every field: `?.` on the first clause alone is not enough (&& still evaluates later accesses when the left side is true-ish for other reasons).
  const staleSuggestion = Boolean(suggestionContext)
    && suggestionContext?.conversationId === conversationId
    && suggestionContext?.messageId !== latestMessageId
    && suggestionContext?.draft === replyDraft;
  useEffect(() => {
    if (!state.featureFlags?.ai_agent) { setAiAvailable(false); return; }
    let active = true;
    api('/api/ai-agent/availability').then(result => { if (active) setAiAvailable(result.enabled); }).catch(() => { if (active) setAiAvailable(false); });
    return () => { active = false; };
  }, [state.featureFlags?.ai_agent]);
  useEffect(() => { setSuggestionError(''); }, [activeConversation?.id]);
  const skipSearchReload = useRef(true);
  const reloadInboxRef = useRef(reloadInbox);
  reloadInboxRef.current = reloadInbox;
  useEffect(() => { setSearch(serverQ); setInboxFilter(serverFilter || "all"); }, [serverFilter, serverQ]);
  useEffect(() => {
    if (!reloadInboxRef.current || skipSearchReload.current) { skipSearchReload.current = false; return undefined; }
    const handle = window.setTimeout(() => {
      reloadInboxRef.current({ inboxFilter, inboxQ: search.trim(), page: 1 });
    }, 400);
    return () => window.clearTimeout(handle);
    // inboxFilter changes reload via the select handler; only debounce free-text search here.
  }, [search]);
  const filteredConversations = Array.isArray(state?.conversations) ? state.conversations : [];
  const contacts = Array.isArray(state?.contacts) ? state.contacts : [];
  const assignedUser = teamMembers.find((member) => member.id === activeConversation?.assignedUserId);
  const workflowAction = (action, extra = {}) => {
    if (!activeConversation) return;
    const payload = { action, ...extra };
    if (activeConversation.version != null) payload.expectedVersion = activeConversation.version;
    mutate(postJson(`/api/conversations/${activeConversation.id}/workflow`, payload, "PATCH"), action === "note" ? "Note added" : "Conversation updated");
  };
  const selectConversation = (conversation) => {
    suggestionRevision.current += 1;
    setProfileOpen(true);
    openConversation(conversation.id);
    if (conversation.unreadCount > 0) {
      const payload = { action: "mark_read" };
      if (conversation.version != null) payload.expectedVersion = conversation.version;
      mutate(postJson(`/api/conversations/${conversation.id}/workflow`, payload, "PATCH"));
    }
  };
  const editReplyDraft = (value) => {
    if (!conversationId) return;
    suggestionRevision.current += 1;
    setReplyDrafts(current => saveConversationDraft(current, conversationId, value));
    setSuggestionContext(null);
    setSuggestionError('');
  };
  const reply = async (event) => {
    event.preventDefault();
    const body = replyDraft.trim();
    const mediaFile = pendingMedia;
    if (!conversationId || !activeContact || (!body && !mediaFile) || sendingReply.current || staleSuggestion) return;
    const contactId = activeContact.id;
    const sentDraft = replyDraft;
    sendingReply.current = true;
    setSendingConversationId(conversationId);
    try {
      const afterSend = (result) => {
        setReplyDrafts(current => clearSentConversationDraft(current, conversationId, sentDraft));
        setSuggestionContext(current => current?.conversationId === conversationId && current.draft === sentDraft ? null : current);
        setPendingMedia(null);
        if (mediaInputRef.current) mediaInputRef.current.value = '';
        return result;
      };
      if (mediaFile) {
        const form = new FormData();
        form.set('contactId', contactId);
        form.set('file', mediaFile);
        if (body) form.set('caption', body);
        if (activeConversation?.version != null) form.set('expectedVersion', String(activeConversation.version));
        await mutate(uploadForm('/api/messages/reply-media', form).then(afterSend), 'Media sent');
      } else {
        const replyPayload = { contactId, body };
        if (activeConversation?.version != null) replyPayload.expectedVersion = activeConversation.version;
        await mutate(postJson('/api/messages/reply', replyPayload).then(afterSend), 'Message sent');
      }
    } finally {
      sendingReply.current = false;
      setSendingConversationId(null);
    }
  };
  const suggestReply = async () => {
    if (!activeConversation || suggesting) return;
    const conversationId = activeConversation.id;
    if (replyDraft.trim()) { setSuggestionError('Clear this draft before requesting a new suggestion.'); return; }
    const messageId = latestMessageId;
    const revision = suggestionRevision.current;
    setSuggesting(true); setSuggestionError(''); setSuggestionContext(null);
    try {
      const result = await postJson('/api/ai-agent/draft', { conversationId });
      if (!canApplySupportSuggestion({ requestedConversationId: conversationId, activeConversationId: activeSuggestionConversation.current, requestedMessageId: messageId, activeMessageId: activeSuggestionMessage.current, requestedRevision: revision, activeRevision: suggestionRevision.current })) return;
      if (result.handoff) setSuggestionError('No grounded suggestion is available. Continue with a human reply.');
      else {
        setReplyDrafts(current => saveConversationDraft(current, conversationId, result.suggestion));
        setSuggestionContext({ conversationId, messageId, draft: result.suggestion, sources: result.sources || [] });
      }
    } catch (cause) { if (canApplySupportSuggestion({ requestedConversationId: conversationId, activeConversationId: activeSuggestionConversation.current, requestedMessageId: messageId, activeMessageId: activeSuggestionMessage.current, requestedRevision: revision, activeRevision: suggestionRevision.current })) setSuggestionError(cause.message); }
    finally { setSuggesting(false); }
  };
  const note = (event) => { event.preventDefault(); const form = event.currentTarget; const value = new FormData(form).get("note"); if (!value?.trim()) return; workflowAction("note", { note: value }); form.reset(); };
  const groupsEnabled = Boolean(state.featureFlags?.whatsapp_groups);
  const whatsappConnected = (state?.setup?.status || 'Needs setup') === 'Connected' && Boolean(state?.meta?.liveMetaReady);
  const webhookSubscribed = state?.setup?.webhookSubscribed === true
    || state?.whatsappAccounts?.some?.((account) => account.webhookSubscribed === true);
  const hasSearch = Boolean(search.trim());
  const hasActiveFilter = inboxFilter && inboxFilter !== 'all';
  const listIsEmpty = !filteredConversations.length;
  let emptyTitle = 'No conversations yet';
  let emptyBody = whatsappConnected
    ? 'Incoming WhatsApp messages to your connected number will appear here.'
    : 'Connect WhatsApp to receive conversations in this inbox.';
  if (inboxSyncError) {
    emptyTitle = 'Inbox could not load';
    emptyBody = inboxSyncError;
  } else if (listIsEmpty && hasSearch) {
    emptyTitle = 'No search results';
    emptyBody = 'Try a different name or phone number.';
  } else if (listIsEmpty && inboxFilter === 'mine') {
    emptyTitle = 'Nothing assigned to you';
    emptyBody = 'Switch to Unassigned or All conversations to pick up open chats.';
  } else if (listIsEmpty && hasActiveFilter) {
    emptyTitle = 'No matches for this filter';
    emptyBody = 'Try All conversations or clear the current filter.';
  }
  return <>
    {!whatsappConnected && (
      <div className="saasBanner" role="status">
        <div>
          <strong>Connect WhatsApp to use the Inbox</strong>
          <p style={{ margin: '4px 0 0' }}>Your Shared Inbox is ready. Connect a WhatsApp Business number through Meta to receive and send conversations.</p>
        </div>
        <button className="primaryAction" type="button" onClick={() => (setActiveView ? setActiveView('setup') : window.location.assign('/app/settings/whatsapp'))}>Open Connection</button>
      </div>
    )}
    {whatsappConnected && !webhookSubscribed && (
      <div className="saasBanner" role="status">
        <div>
          <strong>Webhook subscription not verified</strong>
          <p style={{ margin: '4px 0 0' }}>The workspace is Connected, but inbound WhatsApp events may not arrive until the Meta webhook subscription is confirmed.</p>
        </div>
        <button className="secondaryAction" type="button" onClick={() => (setActiveView ? setActiveView('setup') : window.location.assign('/app/settings/whatsapp'))}>Check connection</button>
      </div>
    )}
    {groupsEnabled && <div className="wa-inbox-modes" role="tablist" aria-label="Inbox surface">
      <button type="button" role="tab" aria-selected={inboxSurface === "direct"} className={inboxSurface === "direct" ? "active" : ""} onClick={() => setInboxSurface("direct")}>1:1 conversations</button>
      <button type="button" role="tab" aria-selected={inboxSurface === "groups"} className={inboxSurface === "groups" ? "active" : ""} onClick={() => setInboxSurface("groups")}>Groups</button>
    </div>}
    {inboxSurface === "groups" ? <WhatsAppGroups api={api} postJson={postJson} enabled={groupsEnabled} embedded /> : <><section className={`inboxShell${activeConversation && activeContact && !profileOpen ? ' inboxShellProfileCollapsed' : ''}`}>
    <aside className="threadList"><div className="threadTools"><label className="searchBox"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or phone" aria-label="Search conversations" /></label><select value={inboxFilter} aria-label="Filter conversations" onChange={(event) => { const value = event.target.value; setInboxFilter(value); reloadInbox?.({ inboxFilter: value, inboxQ: search.trim(), page: 1 }); }}><option value="all">All conversations</option><option value="requesting">Awaiting agent reply</option><option value="active">Active (open)</option><option value="intervened">Human intervened</option><option value="unread">Unread</option><option value="mine">Assigned to me</option><option value="unassigned">Unassigned</option><option value="human">Human takeover</option><option value="replyable">Reply window open</option><option value="closed">Closed</option></select></div>{inboxSyncing && <p className="inboxSyncStatus" role="status">Refreshing conversations…</p>}{inboxSyncError && <div className="inboxEmptyHero" role="alert"><strong>Inbox could not load</strong><p>{inboxSyncError}</p><button className="secondaryAction compactAction" type="button" onClick={() => reloadInbox?.({ inboxFilter, inboxQ: search.trim(), page: 1 })}>Retry</button></div>}{!inboxSyncError && filteredConversations.map((conversation) => { const contact = contacts.find((item) => item.id === conversation.contactId) || {}; const latest = conversation.messages?.at?.(-1); return <button key={conversation.id} type="button" className={conversation.id === activeConversation?.id ? "active" : ""} onClick={() => selectConversation(conversation)}><span className="threadTitle"><strong>{contact.name || contact.phone || 'Unknown contact'}</strong>{conversation.unreadCount > 0 && <b>{conversation.unreadCount}</b>}</span><span>{latest?.body || "No messages yet"}</span><em>{formatTime(conversation.updatedAt)}</em><small>{conversation.status === "closed" ? "Closed" : conversation.automationPaused ? "Human takeover" : conversation.assignedUserId ? "Assigned" : "Unassigned"}</small></button>; })}{!inboxSyncError && listIsEmpty && <div className="inboxEmptyHero" role="status"><strong>{emptyTitle}</strong><p>{emptyBody}</p></div>}</aside>
    <div className="threadPane">{activeConversation && activeContact ? <>
      <header><div><strong>{activeContact.name}</strong><small>{activeContact.phone} | {assignedUser ? `Assigned to ${assignedUser.name || assignedUser.email}` : "Unassigned"}</small></div><div className="threadPaneHeaderActions"><button className="secondaryAction compactAction" type="button" onClick={() => setProfileOpen((open) => !open)}>{profileOpen ? 'Hide profile' : 'Show profile'}</button><Badge kind={activeConversation.status === "closed" ? "neutral" : activeConversation.automationPaused ? "warn" : activeConversation.canReply ? "good" : "neutral"}>{activeConversation.status === "closed" ? "Closed" : activeConversation.automationPaused ? "Human" : activeConversation.canReply ? "24h open" : "Template only"}</Badge></div></header>
      <div className="inboxControls"><select value={activeConversation.assignedUserId || ""} onChange={(event) => workflowAction("assign", { assignedUserId: event.target.value })}><option value="">Unassigned</option>{teamMembers.map((member) => <option key={member.id} value={member.id}>{member.name || member.email}</option>)}</select><button className="secondaryAction" type="button" onClick={() => workflowAction("takeover", { assignedUserId: activeConversation.assignedUserId || currentUserId })}>Take over</button><button className="secondaryAction" type="button" onClick={() => workflowAction("resume")} disabled={!activeConversation.automationPaused}>Resume automation</button><button className="secondaryAction" type="button" onClick={() => workflowAction(activeConversation.status === "closed" ? "reopen" : "close")}>{activeConversation.status === "closed" ? <Play size={16} /> : <CheckCheck size={16} />}{activeConversation.status === "closed" ? "Reopen" : "Close"}</button></div>
      <div className="messages">{(activeConversation.messages || []).map((message) => <div key={message.id} className={`bubble ${message.direction}`}><MessageContent message={message} /><small>{formatTime(message.at)} | {message.status}</small></div>)}</div>
      {activeConversation.status !== "closed" && activeConversation.canReply && <div className="aiReplyComposer">
        <form className="composer" onSubmit={reply}>
          <input ref={mediaInputRef} type="file" hidden accept="image/jpeg,image/png,video/mp4,video/3gpp,audio/*,application/pdf,text/plain" onChange={(event) => setPendingMedia(event.target.files?.[0] || null)} />
          <button className="iconButton" type="button" title="Attach image, video, audio, or document" onClick={() => mediaInputRef.current?.click()} disabled={sendingConversationId !== null}><Paperclip size={18} /></button>
          {pendingMedia && <span className="composerAttachment">{pendingMedia.name} <button type="button" className="iconButton" title="Remove attachment" onClick={() => { setPendingMedia(null); if (mediaInputRef.current) mediaInputRef.current.value = ''; }}><X size={14} /></button></span>}
          <textarea name="body" value={replyDraft} onChange={event => editReplyDraft(event.target.value)} placeholder={pendingMedia ? 'Optional caption' : 'Write a WhatsApp reply'} required={!pendingMedia} />
          <button className="primaryAction" type="submit" disabled={sendingConversationId !== null || staleSuggestion || (!replyDraft.trim() && !pendingMedia)}><Send size={18} /> {sendingConversationId === conversationId ? "Sending" : "Send"}</button>
        </form>
        {staleSuggestion && <small className="errorLine" role="alert">A new message arrived. Review and edit this suggestion before sending.</small>}
        {aiAvailable && <button className="secondaryAction" type="button" onClick={suggestReply} disabled={suggesting}><Bot size={16} /> {suggesting ? "Preparing suggestion" : "Suggest reply"}</button>}
        {suggestionError && <small className="errorLine" role="alert">{suggestionError}</small>}
        {activeSuggestion?.sources?.length > 0 && <small>Sources: {activeSuggestion.sources.map(item => item.title).join(", ")}</small>}
      </div>}
      {activeConversation.status !== "closed" && !activeConversation.canReply && <TemplateReplyForm approvedTemplates={approvedTemplates} activeContact={activeContact} mutate={mutate} flowsEnabled={Boolean(state.featureFlags?.whatsapp_flows)} />}
      <aside className="conversationNotes"><header><div><StickyNote size={17} /><strong>Internal notes</strong></div><span>{activeConversation.notes?.length || 0}</span></header><div className="noteList">{(activeConversation.notes || []).map((item) => <article key={item.id}><p>{item.body}</p><small>{item.author} | {formatTime(item.createdAt)}</small></article>)}{!activeConversation.notes?.length && <span>No internal notes yet</span>}</div><form onSubmit={note}><input name="note" placeholder="Add a note for your team" required /><button className="iconButton" title="Add note"><Plus size={17} /></button></form></aside>
    </> : <div className="threadPaneEmpty" role="status">{listIsEmpty ? 'Select a conversation when messages arrive.' : 'Select a conversation to start messaging.'}</div>}</div>
    {profileOpen ? <InboxContact360 contactId={activeContact?.id || null} api={api} /> : null}
  </section>{activeConversation?.status !== "closed" && activeConversation?.canReply && activeContact && <InteractiveReplyForm activeContact={activeContact} mutate={mutate} />}</>}</>;
}
function AiAgentsWorkspace({ state, role: roleProp }) {
  const role = roleProp || state?.account?.role;
  const canManage = ['Owner', 'Manager'].includes(role);
  if (!state?.featureFlags?.ai_agent) {
    return (
      <div className="contentGrid">
        <Panel title="AI Agents unavailable" subtitle="This feature is disabled for your workspace or plan.">
          <p>Ask your workspace owner to enable AI Agents for this company.</p>
        </Panel>
      </div>
    );
  }
  if (!canManage) {
    return (
      <div className="contentGrid">
        <Panel title="AI Agents" subtitle="Configuration is limited to owners and managers.">
          <p>You can still use AI reply suggestions in the inbox when they are enabled for this workspace.</p>
        </Panel>
      </div>
    );
  }
  return (
    <div className="screenGrid aiAgentsWorkspace">
      <AiSupportSettings api={api} postJson={postJson} uploadForm={uploadForm} role={role} />
    </div>
  );
}

function Team({ state, mutate }) {
  return <><TeamMembers state={state} mutate={mutate}/>{['Owner','Manager'].includes(state.account?.role)&&<SupportPolicy endpoint="/api/team/support-policy" canEdit={state.account?.role==='Owner'} api={api} postJson={postJson}/>}{/* AI Agents have a dedicated workspace at /app/ai-agents */}</>;
}

function TeamMembers({ state, mutate }) {
  const members = state.teamMembers || [];
  const canManage = ["Owner", "Manager"].includes(state.account?.role);
  const [invitations, setInvitations] = useState([]);
  const [inviteUrl, setInviteUrl] = useState("");
  const refreshInvites = () => { if (!canManage) return; api("/api/team/invitations").then((result) => setInvitations(result.invitations || [])).catch(() => setInvitations([])); };
  useEffect(() => { refreshInvites(); }, [canManage, members.length]);
  const [inviteEmailSent, setInviteEmailSent] = useState(null);
  const invite = async (event) => { event.preventDefault(); const form = event.currentTarget; try { const result = await postJson("/api/team/invitations", Object.fromEntries(new FormData(form))); setInvitations(result.invitations || []); setInviteUrl(result.inviteUrl || ""); setInviteEmailSent(result.emailSent === true); form.reset(); } catch (error) { mutate(Promise.reject(error)); } };
  const copyInvite = async () => { if (inviteUrl) await navigator.clipboard.writeText(inviteUrl); };
  const updateMember = (member, role) => mutate(postJson(`/api/team/members/${member.id}`, { role }, "PATCH"), "Team role updated");
  const updateAvailability = (availability) => mutate(postJson(`/api/team/members/${state.account.user.id}`, { availability }, "PATCH"), "Availability updated");
  const removeMember = (member) => mutate(api(`/api/team/members/${member.id}`, { method: "DELETE" }), "Team member removed");
  return <div className="screenGrid"><section className="teamStatus"><div><p className="kicker">Agent availability</p><h2>{state.account.user.name}</h2><span>Set your current inbox availability.</span></div><select value={members.find((member) => member.id === state.account.user.id)?.availability || "offline"} onChange={(event) => updateAvailability(event.target.value)}><option value="available">Available</option><option value="away">Away</option><option value="offline">Offline</option></select></section>{canManage && <Panel title="Invite team member" subtitle="Invite links expire automatically and can be revoked"><form className="teamInviteForm" onSubmit={invite}><Input name="email" label="Work email" type="email" required /><label>Company role<select name="role"><option value="Agent">Agent</option><option value="Manager">Manager</option></select></label><button className="primaryAction" type="submit"><UserPlus size={18} /> Create invite</button></form>{inviteUrl && <div className="inviteResult"><div><strong>Invitation link created</strong><span>{inviteUrl}</span><small>{inviteEmailSent ? "Invite email sent." : "Email delivery not configured — share this link manually."}</small></div><button className="secondaryAction" type="button" onClick={copyInvite}><Copy size={17} /> Copy</button></div>}<div className="pendingInvites">{invitations.map((item) => <article key={item.id}><div><strong>{item.email}</strong><span>{item.role} | expires {formatTime(item.expiresAt)}</span></div><button className="iconButton dangerSoft" title="Revoke invite" onClick={async () => { const result = await api(`/api/team/invitations/${item.id}`, { method: "DELETE" }); setInvitations(result.invitations || []); }}><Trash2 size={16} /></button></article>)}</div></Panel>}<Panel title="Company team" subtitle={`${members.length} workspace member${members.length === 1 ? "" : "s"}`}><DataTable headers={["Member", "Role", "Availability", "Actions"]}>{members.map((member) => <tr key={member.id}><td><strong>{member.name}</strong><small>{member.email}</small></td><td>{canManage && member.role !== "Owner" ? <select value={member.role} onChange={(event) => updateMember(member, event.target.value)}><option value="Agent">Agent</option><option value="Manager">Manager</option></select> : <Badge kind={member.role === "Owner" ? "good" : "neutral"}>{member.role}</Badge>}</td><td><Badge kind={member.availability === "available" ? "good" : member.availability === "away" ? "warn" : "neutral"}>{member.availability}</Badge></td><td className="rowActions">{canManage && member.role !== "Owner" && member.id !== state.account.user.id && <button className="dangerText" onClick={() => removeMember(member)}><Trash2 size={15} /> Remove</button>}</td></tr>)}</DataTable></Panel></div>;
}

function Unsubscribes({ state, suppressedContacts, mutate }) {
  const [restoreContact, setRestoreContact] = useState(null);
  const [consentSettings, setConsentSettings] = useState(null);
  const [customFields, setCustomFields] = useState([]);
  const canManage = isWorkspaceManager(state?.account?.role);
  const isOwner = state?.account?.role === "Owner";
  useEffect(() => {
    let active = true;
    api("/api/workspace/consent").then((result) => { if (active) setConsentSettings(result.settings || null); }).catch(() => {});
    api("/api/workspace/custom-fields").then((result) => { if (active) setCustomFields(result.fields || []); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const restore = (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    mutate(postJson(`/api/contacts/${restoreContact.id}`, {
      marketingPermission: true,
      unsubscribed: false,
      optInSource: values.get("optInSource"),
      consentEvidence: values.get("consentEvidence")
    }, "PATCH").then((result) => {
      setRestoreContact(null);
      return result;
    }), "Permission restored");
  };
  const saveConsent = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      optOutKeywords: String(form.get("optOutKeywords") || "").split(",").map((item) => item.trim()).filter(Boolean),
      optInKeywords: String(form.get("optInKeywords") || "").split(",").map((item) => item.trim()).filter(Boolean),
      optOutAutoReply: form.get("optOutAutoReply"),
      optInAutoReply: form.get("optInAutoReply")
    };
    if (isOwner) payload.marketingMessagingEnabled = form.get("marketingMessagingEnabled") === "on";
    mutate(postJson("/api/workspace/consent", payload).then((result) => {
      setConsentSettings(result.settings || consentSettings);
      return result;
    }), "Consent settings saved");
  };
  const addField = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutate(postJson("/api/workspace/custom-fields", {
      action: "create",
      label: form.get("label"),
      key: form.get("key"),
      type: form.get("type") || "text"
    }).then((result) => {
      setCustomFields(result.fields || []);
      event.currentTarget.reset();
      return result;
    }), "Custom field created");
  };
  return <>
    {canManage && consentSettings && <Panel title="WhatsApp consent settings" subtitle="Keyword opt-in/out, marketing master switch, and suppression controls"><form className="formGrid" onSubmit={saveConsent}>{isOwner && <label className="checkRow"><input name="marketingMessagingEnabled" type="checkbox" defaultChecked={consentSettings.marketingMessagingEnabled !== false} /> Marketing messaging enabled</label>}<Input name="optOutKeywords" label="Opt-out keywords (max 5, comma separated)" defaultValue={(consentSettings.optOutKeywords || []).join(", ")} /><Input name="optInKeywords" label="Opt-in keywords (max 5, comma separated)" defaultValue={(consentSettings.optInKeywords || []).join(", ")} /><Input name="optOutAutoReply" label="Opt-out confirmation message" defaultValue={consentSettings.optOutAutoReply || ""} /><Input name="optInAutoReply" label="Opt-in confirmation message" defaultValue={consentSettings.optInAutoReply || ""} /><button className="primaryAction" type="submit"><Save size={18} /> Save consent settings</button></form></Panel>}
    {canManage && <Panel title="Contact custom fields" subtitle="Reusable attribute keys for segmentation and personalization"><form className="formGrid" onSubmit={addField}><Input name="label" label="Field label" required /><Input name="key" label="Field key" placeholder="loyalty_tier" /><label>Type<select name="type"><option value="text">Text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="date">Date</option></select></label><button className="primaryAction" type="submit"><Plus size={18} /> Add field</button></form><DataTable headers={["Label", "Key", "Type", "Action"]}>{customFields.map((field) => <tr key={field.id}><td><strong>{field.label}</strong></td><td>{field.key}</td><td>{field.type}</td><td><button type="button" className="dangerText" onClick={() => mutate(postJson("/api/workspace/custom-fields", { action: "delete", id: field.id }).then((result) => { setCustomFields(result.fields || []); return result; }), "Custom field removed")}>Remove</button></td></tr>)}</DataTable>{!customFields.length && <EmptyState text="No custom fields defined" />}</Panel>}
    <Panel title="Suppression"><DataTable headers={["Name", "Phone", "Reason", "Action"]}>{suppressedContacts.map((contact) => <tr key={contact.id}><td><strong>{contact.name}</strong></td><td>{contact.phone}</td><td>{contact.unsubscribed ? "Unsubscribed" : "No permission"}</td><td>{canManage && <button type="button" onClick={() => setRestoreContact(contact)}>Record new consent</button>}</td></tr>)}</DataTable>{!suppressedContacts.length && <EmptyState text="No suppressed contacts" />}</Panel>
    {restoreContact && <div className="modalBackdrop" role="presentation" onMouseDown={() => setRestoreContact(null)}><section className="editModal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="kicker">Marketing permission</p><h2>Record new consent</h2></div><button className="iconButton" type="button" onClick={() => setRestoreContact(null)} aria-label="Close"><X size={18} /></button></header><form className="formGrid" onSubmit={restore}><p>{restoreContact.name} | {restoreContact.phone}</p><Input name="optInSource" label="Consent source" required /><Input name="consentEvidence" label="Evidence of new consent" required minLength="10" /><button className="primaryAction" type="submit"><Save size={18} /> Restore permission</button></form></section></div>}
  </>;
}

function Panel({ title, subtitle, children, className = "" }) { return <section className={["panel", className].filter(Boolean).join(" ")}><div className="panelHead"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>{children}</section>; }
function Metric({ label, value }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
function Badge({ kind = "neutral", children }) { return <span className={`badge ${kind}`}>{children}</span>; }
function Input({ label, ...props }) { return <label>{label}<input {...props} /></label>; }
function PasswordField({ label, visible, onToggle, hint, enforcePolicy = false, ...props }) {
  const inputId = props.id || props.name;
  // Sign-in must accept existing accounts (e.g. Meta reviewer password may predate 12-char signup policy).
  const minLength = enforcePolicy ? PASSWORD_MIN_LENGTH : undefined;
  return <div className='fieldGroup'><label htmlFor={inputId}>{label}</label><span className="passwordWrap"><input {...props} id={inputId} type={visible ? "text" : "password"} minLength={minLength} /><button type="button" onClick={onToggle} aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>{hint ? <small className="fieldHint">{hint}</small> : null}</div>;
}
function EmptyState({ text }) { return <div className="emptyState"><CircleAlert size={20} /><span>{text}</span></div>; }
function Pagination({ meta, onChange, label = "Records" }) {
  if (!meta || meta.pages <= 1) return null;
  const first = (meta.page - 1) * meta.pageSize + 1;
  const last = Math.min(meta.page * meta.pageSize, meta.total);
  return <nav className="pagination" aria-label={`${label} pagination`}><span>{label} {first}-{last} of {meta.total}</span><div><button className="secondaryAction" type="button" disabled={meta.page <= 1} onClick={() => onChange(meta.page - 1)}>Previous</button><strong>Page {meta.page} of {meta.pages}</strong><button className="secondaryAction" type="button" disabled={meta.page >= meta.pages} onClick={() => onChange(meta.page + 1)}>Next</button></div></nav>;
}
function DataTable({ headers, children }) {
  const rows = Children.map(children, (row) => {
    if (!isValidElement(row)) return row;
    const cells = Children.map(row.props.children, (cell, index) => isValidElement(cell) ? cloneElement(cell, { "data-label": headers[index] || "" }) : cell);
    return cloneElement(row, {}, cells);
  });
  return <div className="tableWrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>;
}
function ResultMeters({ stats }) {
  const safe = stats && typeof stats === 'object' ? stats : {};
  return (
    <div className="meterGrid">
      <Metric label="Total" value={safe.total || 0} />
      <Metric label="Queued" value={safe.queued || 0} />
      <Metric label="Sent" value={safe.sent || 0} />
      <Metric label="Delivered" value={safe.delivered || 0} />
      <Metric label="Read" value={safe.read || 0} />
      <Metric label="Replies" value={safe.replied || 0} />
      <Metric label="Failed" value={safe.failed || 0} />
    </div>
  );
}
