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
import AudienceSegmentComposer from './audience-segment-composer';
import AudienceBulkTagsPanel from './audience-bulk-tags-panel';
import CampaignDripManager from './campaign-drip-manager';
import InboxContact360 from './inbox-contact-360';
import CampaignSourceAnalyticsPanel from './campaign-source-analytics-panel';
import { campaignSourceLabel } from '../lib/campaign-source-labels.js';
import WhatsAppRetargetingPanel from './whatsapp-retargeting-panel';
import ApprovedTemplatePicker from './approved-template-picker';
import SearchableOptionPicker from './searchable-option-picker';
import AiSupportSettings from './ai-support-settings';
import { isSessionFailure, createRequestGate, authFormPasswordError } from '../lib/auth-navigation';
import { PASSWORD_MIN_LENGTH, PASSWORD_POLICY_HINT } from '../lib/password-policy.js';
import { metaSdkCallback } from '../lib/meta-sdk-callback';
import { saveConversationDraft, clearSentConversationDraft, canApplySupportSuggestion } from '../lib/inbox-drafts';
import { canOpenWorkspaceView, featureForView, managerViews, workspaceRoutes } from './workspace/nav-config.js';

import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BadgeCheck, Ban, BarChart3, Bot, ChevronRight, CircleAlert, Download, FileText, Image, Inbox, LayoutDashboard,
  Eye, EyeOff, Loader2, LogOut, Menu, MessageSquare, MessageSquareText, PhoneCall, Plus, RefreshCcw, Send, Settings2,
  ShieldCheck, Sparkles, Trash2, Upload, UsersRound, X, Search, Clock3, Activity, CheckCheck, Copy, Link2, Pause, Play, Pencil, Save, StickyNote, Unplug, UserPlus, WalletCards,
  Smartphone, Workflow, RadioTower, Building2, KeyRound, ShoppingBag, Paperclip
} from "lucide-react";

const navItems = [
  { id: "overview", label: "Command", icon: LayoutDashboard },
  { id: "setup", label: "Meta Setup", icon: Settings2 },
  { id: "contacts", label: "Audience", icon: UsersRound },
  { id: "team", label: "Team", icon: UserPlus },
  { id: "billing", label: "Billing", icon: WalletCards },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: "templates", label: "Templates", icon: MessageSquareText },
  { id: "automation", label: "Automation", icon: Bot },
  { id: "campaigns", label: "Campaigns", icon: Send },
  { id: 'commerce', label: 'Commerce', icon: ShoppingBag },
  { id: 'conversions', label: 'Conversions', icon: Activity },
  { id: 'calling', label: 'Calls', icon: PhoneCall },
  { id: 'ads', label: 'WhatsApp Ads', icon: RadioTower },
  { id: "results", label: "Results", icon: BarChart3 },
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "unsubscribes", label: "Suppression", icon: Ban }
];

function workspaceLocation(pathname) {
  if (pathname?.startsWith("/app/inbox/")) {
    return { view: "inbox", conversationId: decodeURIComponent(pathname.slice("/app/inbox/".length)) || null };
  }
  const entry = Object.entries(workspaceRoutes).find(([, route]) => route === pathname);
  return { view: entry?.[0] || "overview", conversationId: null };
}

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
  if (health?.reason === "authorization_invalid" || health?.reason === "scope_missing") return "Meta access has expired or changed. Reconnect WhatsApp to restore messaging.";
  if (health?.reason === "authorization_expiring") return "Meta access expires soon. Reconnect WhatsApp before it stops working.";
  if (health?.reason === "webhook_unsubscribed") return "The WhatsApp webhook subscription could not be restored. Verify the connection.";
  if (health?.reason === "monitor_stale") return "Connection checks have stopped updating. Ask the platform owner to check the background worker.";
  if (health?.reason === "platform_configuration") return "The platform's Meta configuration needs attention.";
  return "Meta connection checks are failing. Verify the connection before sending campaigns.";
}
const emptyWorkspaceState = {
  contacts: [], audienceSegments: [], templates: [], campaigns: [], conversations: [],
  events: [], automationFlows: [], teamMembers: [], pagination: {}
};

function mergeWorkspaceState(current, incoming) {
  return {
    ...emptyWorkspaceState,
    ...(current || {}),
    ...incoming,
    pagination: { ...(current?.pagination || {}), ...(incoming?.pagination || {}) }
  };
}

function stateUrl(view, { page = 1, messagePage = 1, notePage = 1, conversationId = "", inboxFilter = "", q = "" } = {}) {
  const params = new URLSearchParams({ page: String(page), messagePage: String(messagePage), notePage: String(notePage) });
  if (conversationId) params.set("conversationId", conversationId);
  if (inboxFilter) params.set("inboxFilter", inboxFilter);
  if (q) params.set("q", q);
  return `/api/workspace/${encodeURIComponent(view)}?${params}`;
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

export default function WorkspaceApp({ initialView = "overview", initialConversationId = null, authMode = "", initialPlatform = null, children = null }) {
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [campaignRetarget, setCampaignRetarget] = useState(null);
  const [pages, setPages] = useState({});
  const [workspaces, setWorkspaces] = useState([]);
  const scopeGate = useRef(null);
  const inboxRevisionRef = useRef(0);
  if (!scopeGate.current) scopeGate.current = createRequestGate();

  const approvedTemplates = useMemo(() => state?.templates.filter((template) => template.status === "Approved") || [], [state]);
  const marketableContacts = useMemo(() => state?.contacts.filter((contact) => contact.marketingPermission && !contact.unsubscribed) || [], [state]);
  const suppressedContacts = useMemo(() => state?.contacts.filter((contact) => contact.unsubscribed || !contact.marketingPermission) || [], [state]);

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
  useEffect(() => {
    if (!account || authMode) return;
    const location = workspaceLocation(pathname);
    if (location.view === "inbox") setPages((current) => ({ ...current, messages: 1, notes: 1 }));
    loadScope(location, true, location.view === "inbox" ? { messagePage: 1, notePage: 1 } : {})
      .then(result => { if (result) setBootstrapError(null); })
      .catch((error) => {
        if (isSessionFailure(error)) setAccount(null);
        setBootstrapError(error);
      });
  }, [account, authMode, pathname]);
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
      if (!cancelled) timer = window.setTimeout(poll, location.view === "inbox" ? 250 : 15000);
    };
    timer = window.setTimeout(poll, 1000);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [account, pages, pathname]);

  const notify = (message) => { if (!message) return; setNotice(message); setTimeout(() => setNotice(""), 2600); };

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
      const location = authMode ? { view: "overview", conversationId: "" } : workspaceLocation(pathname);
      const nextState = await api(stateUrl(location.view, { conversationId: location.conversationId || "" }));
      if (!scopeGate.current.current(request)) return;
      setState(mergeWorkspaceState(null, nextState));
      setAccount(me);
      setPlatform({ ...fallbackPlatform, ...(nextState.platform || publicConfig.platform || {}) });
      setConfigError("");
    } catch (error) {
      if (!scopeGate.current.current(request)) return;
      setState(null);
      if (isSessionFailure(error)) setAccount(null);
      else if (verifiedAccount) setAccount(verifiedAccount);
      setBootstrapError(error);
      if (["DB_NOT_CONFIGURED", "AUTH_NOT_CONFIGURED"].includes(error.code)) setConfigError(error.message);
    } finally {
      if (scopeGate.current.current(request)) setLoading(false);
    }
  };

  const loadScope = async (location = workspaceLocation(pathname), updatePlatform = true, overrides = {}) => {
    const request = scopeGate.current.begin();
    const page = overrides.page || pages[location.view] || 1;
    const messagePage = overrides.messagePage || pages.messages || 1;
    const notePage = overrides.notePage || pages.notes || 1;
    const inboxFilter = overrides.inboxFilter ?? pages.inboxFilter ?? "";
    const inboxQ = overrides.inboxQ ?? pages.inboxQ ?? "";
    let nextState;
    try {
      nextState = await api(stateUrl(location.view, {
        page, messagePage, notePage, conversationId: location.conversationId || "", inboxFilter, q: inboxQ
      }));
    }
    catch (error) { if (scopeGate.current.current(request)) throw error; return null; }
    if (!scopeGate.current.current(request)) return null;
    setState((current) => mergeWorkspaceState(current, nextState));
    if (updatePlatform && nextState.platform) setPlatform((current) => ({ ...current, ...nextState.platform }));
    return nextState;
  };

  const refresh = async () => {
    try { await loadScope(); }
    catch (error) { notify(error.message); if (isSessionFailure(error)) { setBootstrapError(error); setAccount(null); } }
  };

  const mutate = async (promise, message) => {
    try { await promise; await loadScope(); notify(message); return true; }
    catch (error) { notify(error.message); return false; }
  };

  const changePage = async (key, page) => {
    const nextPage = Math.max(1, page);
    const location = workspaceLocation(pathname);
    const overrides = key === "messages" ? { messagePage: nextPage } : key === "notes" ? { notePage: nextPage } : { page: nextPage };
    setPages((current) => ({ ...current, [key]: nextPage, ...(["messages", "notes"].includes(key) ? {} : { [location.view]: nextPage }) }));
    try { await loadScope(location, false, overrides); }
    catch (error) { notify(error.message); }
  };

  const reloadInbox = async ({ inboxFilter, inboxQ, page = 1 } = {}) => {
    const location = workspaceLocation(pathname);
    const nextFilter = inboxFilter ?? pages.inboxFilter ?? "";
    const nextQ = inboxQ ?? pages.inboxQ ?? "";
    setPages((current) => ({ ...current, inbox: page, inboxFilter: nextFilter, inboxQ: nextQ }));
    try { await loadScope(location, false, { page, inboxFilter: nextFilter, inboxQ: nextQ }); }
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
      window.location.assign("/app/dashboard");
    } catch (error) {
      event.target.value = account.business.id;
      notify(error.message);
    }
  };

  const navigate = (view) => {
    const route = workspaceRoutes[view];
    if (!route) return;
    if (featureForView[view] && state?.featureFlags?.[featureForView[view]] === false) { notify('This feature is disabled by the platform administrator.'); return; }
    setActiveView(view);
    setMobileNavOpen(false);
    router.push(route);
  };

  const openConversation = (conversationId) => {
    setActiveConversationId(conversationId);
    setPages((current) => ({ ...current, messages: 1, notes: 1 }));
    setMobileNavOpen(false);
    router.push(`/app/inbox/${encodeURIComponent(conversationId)}`);
  };

  if (loading) return <main className="loading"><Sparkles size={32} /><p>Loading workspace</p></main>;
  if (configError) return <SystemSetup message={configError} platform={platform} />;
  if (!authMode && isSessionFailure(bootstrapError)) return <main className='loading'><Loader2 className='spin' size={30} /><p>Opening sign in</p></main>;
  if (account && !state && bootstrapError) return <main className='loading errorLoading'><CircleAlert size={32} /><p>Workspace could not be loaded</p><span>{bootstrapError.message || 'The server returned an unexpected response.'}</span><button className='primaryAction' type='button' onClick={bootstrap}>Retry</button></main>;
  if (!account && !authMode && bootstrapError && !isSessionFailure(bootstrapError)) return <main className='loading errorLoading'><CircleAlert size={32} /><p>Workspace could not be loaded</p><span>{bootstrapError.message || 'The server returned an unexpected response.'}</span><button className='primaryAction' type='button' onClick={bootstrap}>Retry</button></main>;
  if (!account && authMode) return <AuthScreen onDone={() => window.location.replace('/app/dashboard')} platform={platform} initialMode={authMode} onModeChange={(mode) => router.push(mode === "signup" ? "/signup" : "/login")} />;
  if (!account) return <main className="loading"><Loader2 className="spin" size={30} /><p>Opening sign in</p></main>;
  if (authMode) return <main className="loading"><Loader2 className="spin" size={30} /><p>Opening workspace</p></main>;
  if (!state) return <main className="loading"><Sparkles size={32} /><p>Preparing workspace</p></main>;

  const activeConversation = activeConversationId
    ? state.conversations.find((conversation) => conversation.id === activeConversationId) || null
    : state.conversations[0];
  const activeContact = activeConversation ? state.contacts.find((contact) => contact.id === activeConversation.contactId) : null;
  const latestCampaign = state.campaigns[0];
  const platformConfig = { ...platform, ...(state.platform || {}) };
  const screenProps = { state, mutate, changePage, reloadInbox, setActiveView: navigate, approvedTemplates, marketableContacts, suppressedContacts, latestCampaign, activeConversation, activeContact, openConversation, platform: platformConfig, role: account.role, campaignRetarget, setCampaignRetarget, inboxFilter: pages.inboxFilter || "", inboxQ: pages.inboxQ || "" };

  return (
    <main className="shell">
      <aside className={`sideRail ${mobileNavOpen ? "open" : ""}`}>
        <div className="brandBlock"><div className="brandIcon">{platformConfig.logo_url?<img src={platformConfig.logo_url} alt="" className="platformLogo"/>:<PhoneCall size={22} />}</div><div><strong>{platformConfig.brand_name}</strong><span>{account.business.name}</span></div><button className="mobileCloseButton" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={20} /></button></div>
        {workspaces.length > 1 && <label className="workspaceSwitcher"><span>Workspace</span><select value={account.business.id} onChange={selectWorkspace}>{workspaces.map((item) => <option key={item.id} value={item.id} disabled={item.status === "suspended"}>{item.name}{item.status === "suspended" ? " (suspended)" : ""}</option>)}</select></label>}
        <nav className="navList" aria-label="Product sections">
          {navItems.filter((item) => canOpenWorkspaceView(account.role, item.id) && (!featureForView[item.id] || state.featureFlags?.[featureForView[item.id]] !== false)).map((item) => { const Icon = item.icon; return <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>; })}
        </nav>
        <div className="railNote"><ShieldCheck size={18} /><span>{account.user.email}</span></div>
      </aside>
      {mobileNavOpen && <button className="mobileNavScrim" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
      <section className="workspace">
        <header className="heroBar">
          <button className="mobileMenuButton" type="button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><div><p className="kicker">{navItems.find((item) => item.id === activeView)?.label}</p><h1>{pageTitle(activeView)}</h1></div>
          <div className="topActions"><button className="iconButton" title="Refresh" onClick={refresh}><RefreshCcw size={18} /></button><button className="iconButton" title="Sign out" onClick={logout}><LogOut size={18} /></button><span className={`statusPill ${state.setup.status === "Connected" ? "good" : "warn"}`}>{state.setup.status}</span></div>
        </header>
        {notice && <div className="toast">{notice}</div>}
        {["degraded", "reconnect_required"].includes(state.setup.health?.status) && <div className="connectionAlert" role="alert"><CircleAlert size={19} /><span>{connectionHealthMessage(state.setup.health)}</span>{canOpenWorkspaceView(account.role, "setup") && <button className="secondaryAction" type="button" onClick={() => navigate("setup")}>Open WhatsApp settings</button>}</div>}
        {featureForView[activeView] && state.featureFlags?.[featureForView[activeView]] === false ? <div className='contentGrid'><Panel title='Feature unavailable' subtitle='This feature is disabled by the platform administrator.'><button className='secondaryAction' type='button' onClick={() => navigate('overview')}>Open dashboard</button></Panel></div> : <Screens activeView={activeView} {...screenProps} />}
        {children}
      </section>
    </main>
  );
}

function AuthScreen({ onDone, platform, initialMode = "signin", onModeChange }) {
  const [mode, setMode] = useState(initialMode);
  const [error, setError] = useState("");
  const [verificationDeliveryFailed, setVerificationDeliveryFailed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const isSignup = mode === "signup";
  useEffect(() => { setHydrated(true); }, []);
  useEffect(() => { setMode(initialMode); }, [initialMode]);

  const switchMode = () => {
    if (pending) return;
    setError("");
    setVerificationDeliveryFailed(false);
    setShowPassword(false);
    setShowConfirm(false);
    const nextMode = isSignup ? "signin" : "signup";
    setMode(nextMode);
    onModeChange?.(nextMode);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setVerificationDeliveryFailed(false);
    const rawForm = Object.fromEntries(new FormData(event.currentTarget));
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
      await onDone();
    } catch (err) {
      if (err.code === 'MFA_REQUIRED') setMfaRequired(true);
      if (err.code === 'EMAIL_NOT_VERIFIED') setVerificationDeliveryFailed(true);
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return <main className="authShell"><section className="authPanel authPanelPro"><div className="brandBlock dark authBrand"><div className="brandIcon">{platform.logo_url?<img src={platform.logo_url} alt="" className="platformLogo"/>:<PhoneCall size={22} />}</div><div><strong>{platform.brand_name}</strong><span>{platform.product_tagline}</span></div></div><div className="authHeader"><p className="kicker">Secure workspace</p><h1>{isSignup ? platform.signup_heading : platform.signin_heading}</h1><p>{isSignup ? platform.signup_copy : platform.signin_copy}</p></div><form className="formGrid authForm" method="post" onSubmit={submit}>{isSignup && <><Input name="name" label="Your name" autoComplete="name" required /><Input name="businessName" label="Business name" autoComplete="organization" required /></>}<Input name="workspaceEmail" label="Email" type="email" autoComplete="email" required /><PasswordField name="workspacePassword" label="Password" visible={showPassword} onToggle={() => setShowPassword((value) => !value)} autoComplete={isSignup ? 'new-password' : 'current-password'} required hint={isSignup ? PASSWORD_POLICY_HINT : undefined} />{mfaRequired && !isSignup && <Input name="mfaCode" label="Authenticator or recovery code" autoComplete="one-time-code" required />}{isSignup && <PasswordField name="confirmPassword" label="Confirm password" visible={showConfirm} onToggle={() => setShowConfirm((value) => !value)} autoComplete="new-password" required />}{error && <div className="formError" role="alert">{error}</div>}{verificationDeliveryFailed && <a className="textButton authHelpLink" href="/resend-verification">Request verification email</a>}<button className="primaryAction authSubmit" type="submit" disabled={!hydrated || pending}>{pending ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />} <span>{pending ? 'Please wait' : isSignup ? 'Create account' : 'Sign in'}</span></button>{!isSignup && <div className='authHelpLinks'><a className="textButton authHelpLink" href="/forgot-password">Forgot password?</a></div>}</form><div className="authSwitch"><span>{isSignup ? 'Already have a workspace?' : 'New workspace?'}</span><button className="textButton" type="button" onClick={switchMode}>{isSignup ? 'Sign in' : 'Create account'}</button></div></section></main>;
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

function Screens({ activeView, ...props }) {
  if (!canOpenWorkspaceView(props.role, activeView)) {
    return <Panel title="Workspace access"><p>This section is available to workspace owners{activeView === "billing" ? "" : " and managers"}.</p></Panel>;
  }
  const screens = { ads: <WhatsAppAds api={api} postJson={postJson} uploadForm={uploadForm} role={props.role} />, calling: <WhatsAppCalling api={api} postJson={postJson} role={props.role} />, conversions: <WhatsAppConversions api={api} postJson={postJson} role={props.role} />, commerce: <><CommerceOpsPanel api={api} role={props.role} /><WhatsAppCommerce api={api} postJson={postJson} role={props.role} /></>, overview: <Overview {...props} />, setup: <Setup {...props} />, contacts: <Contacts {...props} />, team: <Team {...props} />, billing: <Billing {...props} />, security: <SecuritySettings />, templates: <Templates {...props} />, automation: <AutomationFlows {...props} />, campaigns: <Campaigns {...props} />, results: <Results {...props} />, inbox: <InboxView {...props} />, unsubscribes: <Unsubscribes {...props} /> };
  const pageKey = { contacts: "contacts", templates: "templates", automation: "automation", campaigns: "campaigns", results: "results", inbox: "inbox", unsubscribes: "unsubscribes" }[activeView];
  return <>
    {screens[activeView]}
    {activeView === "inbox" && <Pagination label="Message history" meta={props.state.pagination?.messages} onChange={(page) => props.changePage("messages", page)} />}
    {activeView === "inbox" && <Pagination label="Internal notes" meta={props.state.pagination?.notes} onChange={(page) => props.changePage("notes", page)} />}
    {pageKey && <Pagination label={activeView === "inbox" ? "Conversations" : "Records"} meta={props.state.pagination?.[pageKey] || props.state.pagination?.inbox} onChange={(page) => props.changePage(pageKey, page)} />}
  </>;
}

function pageTitle(view) {
  return { overview: "Command center", setup: "Business connection", contacts: "Audience", team: "Team workspace", billing: "Subscription and billing", security: 'Account security', templates: "Template library", automation: "Automation flows", campaigns: "Campaign builder", results: "Campaign results", inbox: "Inbox", unsubscribes: "Suppression list" }[view];
}

function Billing({ state, role }) {
  const [plans, setPlans] = useState([]);
  const [billingAvailable, setBillingAvailable] = useState(false);
  const [interval, setInterval] = useState('monthly');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmPlan, setConfirmPlan] = useState('');
  useEffect(() => {
    api('/api/billing/plans').then((result) => {
      setPlans(result.plans || []);
      setBillingAvailable(Boolean(result.billingAvailable));
    }).catch((reason) => setError(reason.message));
  }, []);
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
  return <div className="screenGrid">
    <section className="heroPanel"><div><span className="softLabel">{subscription.status || "pending"}</span><h2>{plan.name || "Unassigned"}</h2><p>{plan.description || "Subscription details are managed by the platform owner."}</p></div><div className="heroMetrics"><Metric label="Monthly" value={money(plan.monthlyPriceCents)} /><Metric label="Yearly" value={money(plan.yearlyPriceCents)} /><Metric label="Period ends" value={subscription.periodEnd ? formatTime(subscription.periodEnd) : "Not set"} /></div></section>
    <Panel title="Current usage" subtitle="Live usage against the limits configured for this plan"><div className="meterGrid usageGrid"><Metric label="Contacts" value={usageValue("contacts")} /><Metric label="Campaigns" value={usageValue("campaigns")} /><Metric label="Messages" value={usageValue("messages")} /><Metric label="Users" value={usageValue("users")} /><Metric label="Automations" value={usageValue("automationFlows")} /><Metric label="WhatsApp conversations" value={usageValue("whatsappConversations")} /></div></Panel>
    <section className="billingPlans" aria-label="Subscription plans">
      {(billingAvailable || subscription.provider === 'razorpay') && <RazorpaySubscriptionActions postJson={postJson} role={role} plans={plans} interval={interval}/>}
      <div className="billingPlansHead"><div><h2>Plans</h2><p>Prices and limits are managed by the platform owner.</p></div><div className="billingInterval" role="group" aria-label="Billing interval"><button type="button" className={interval === 'monthly' ? 'active' : ''} aria-pressed={interval === 'monthly'} onClick={() => setInterval('monthly')}>Monthly</button><button type="button" className={interval === 'yearly' ? 'active' : ''} aria-pressed={interval === 'yearly'} onClick={() => setInterval('yearly')}>Yearly</button></div></div>
      {error && <div className="formError" role="alert">{error}</div>}
      {notice && <p role="status">{notice}</p>}
      {!billingAvailable && <div className="formError">Online billing is not configured yet.</div>}
      {subscription.provider === 'razorpay' && subscription.status !== 'canceled' && <button className="secondaryAction" type="button" disabled={pending || role !== 'Owner'} onClick={() => openBilling('/api/billing/portal')}>Open Razorpay subscription</button>}
      <div className="planGrid">{plans.map((item) => { const price = interval === 'monthly' ? item.monthlyPriceCents : item.yearlyPriceCents; const activeProvider = subscription.provider === 'razorpay' && ['active', 'trialing'].includes(subscription.status); const current = activeProvider && item.code === plan.code && interval === subscription.billingInterval; const choiceKey = item.id + ':' + interval; return <article className="planTile" key={item.id}><header><div><strong>{item.name}</strong><p>{item.description}</p></div>{current && <Badge kind="good">Current</Badge>}</header><div className="planPrice">{money(price, item.currency)}<small>/{interval === 'monthly' ? 'month' : 'year'}</small></div><ul>{(item.features || []).map((feature) => <li key={feature}>{feature}</li>)}</ul><button className="primaryAction" type="button" disabled={pending || !billingAvailable || role !== 'Owner' || !price || current || (subscription.provider === 'razorpay' && subscription.status === 'past_due')} onClick={() => activeProvider ? (confirmPlan === choiceKey ? switchPlan(item.id) : setConfirmPlan(choiceKey)) : openBilling('/api/billing/checkout', { planId: item.id, interval })}>{current ? 'Current plan' : activeProvider ? confirmPlan === choiceKey ? 'Confirm switch' : 'Switch plan' : 'Choose plan'}</button>{activeProvider && confirmPlan === choiceKey && <button className="secondaryAction" type="button" onClick={() => setConfirmPlan('')}>Cancel</button>}</article>; })}</div>
      {!plans.length && <EmptyState text="No public subscription plans are available" />}
    </section>
    <Panel title="Included features" subtitle={plan.name || "Current plan"}><div className="readinessList">{(plan.features || []).map((feature) => <div className="ready" key={feature}><span>{feature}</span><Badge kind="good">Included</Badge></div>)}{!(plan.features || []).length && <EmptyState text="No plan features have been configured" />}</div></Panel>
  </div>;
}

function Overview({ state, approvedTemplates, marketableContacts, latestCampaign, setActiveView, platform, role, openConversation }) {
  const canManage = isWorkspaceManager(role);
  const overview = state.overview || {};
  const delivered = overview.delivered || 0;
  const read = overview.read || 0;
  const failed = overview.failed || 0;
  const openConversations = overview.openConversations || 0;
  const marketableCount = overview.marketableContacts || 0;
  const campaignCount = overview.campaignCount || 0;
  const currentCampaign = overview.latestCampaign || latestCampaign;
  const usage = state.subscription?.usage || {};
  const limits = state.subscription?.limits || {};
  const setupItems = [
    { label: "WhatsApp connection", ready: state.meta.liveMetaReady },
    { label: "Approved template", ready: (overview.approvedTemplates || 0) > 0 },
    { label: "Opted-in audience", ready: marketableCount > 0 },
    { label: "Automation flow", ready: (overview.activeFlows || 0) > 0 }
  ];
  return <div className="screenGrid">
    <section className="heroPanel"><div><span className="softLabel">{state.setup.mode}</span><h2>{state.setup.businessName || "Workspace"}</h2><p>{platform.workspace_intro}</p></div><div className="heroMetrics"><Metric label="Marketable" value={marketableCount} /><Metric label="Open chats" value={openConversations} /><Metric label="Campaigns" value={campaignCount} /></div></section>
    <section className="actionBand">{canManage && <button className="primaryAction" onClick={() => setActiveView("campaigns")}><Send size={18} /> {platform.primary_cta_label} <ChevronRight size={18} /></button>}<button className={canManage ? "secondaryAction" : "primaryAction"} onClick={() => setActiveView("inbox")}><Inbox size={18} /> Open inbox</button><button className="secondaryAction" onClick={() => setActiveView("contacts")}><UsersRound size={18} /> {canManage ? "Add audience" : "Contacts"}</button>{canManage && <button className="secondaryAction" onClick={() => setActiveView("results")}><BarChart3 size={18} /> Results</button>}</section>
    <Panel title="Support queue" subtitle="Live SLA and waiting conversations for every role"><InboxSlaWidget api={api} role={role} onOpenInbox={() => setActiveView("inbox")} onOpenConversation={(conversationId) => { openConversation?.(conversationId); setActiveView("inbox"); }} /></Panel>
    <div className="overviewGrid"><Panel title="Delivery pulse" subtitle="All WhatsApp campaign recipients"><div className="statusGrid"><Metric label="Delivered" value={delivered} /><Metric label="Read" value={read} /><Metric label="Failed" value={failed} /><Metric label="Open chats" value={openConversations} /></div></Panel><Panel title="Workspace readiness" subtitle="Complete these before scaling sends"><div className="readinessList">{setupItems.map((item) => <div key={item.label} className={item.ready ? "ready" : ""}><span>{item.label}</span><Badge kind={item.ready ? "good" : "warn"}>{item.ready ? "Ready" : "Action needed"}</Badge></div>)}</div></Panel></div>
    <Panel title="Subscription usage" subtitle={state.subscription?.plan?.name || "No plan assigned"}><div className="meterGrid usageGrid"><Metric label="Contacts" value={limits.contacts == null ? usage.contacts || 0 : (usage.contacts || 0) + " / " + limits.contacts} /><Metric label="Campaigns" value={limits.campaigns == null ? usage.campaigns || 0 : (usage.campaigns || 0) + " / " + limits.campaigns} /><Metric label="Messages" value={limits.messages == null ? usage.messages || 0 : (usage.messages || 0) + " / " + limits.messages} /><Metric label="Flows" value={limits.automationFlows == null ? usage.automationFlows || 0 : (usage.automationFlows || 0) + " / " + limits.automationFlows} /></div></Panel>
    <Panel title="Latest campaign" subtitle={currentCampaign ? formatTime(currentCampaign.createdAt) : "No campaigns"}>{currentCampaign ? <ResultMeters stats={currentCampaign.stats} /> : <EmptyState text="No campaign results yet" />}</Panel>
  </div>;
}

function Setup({ state, mutate }) {
  const signupData = useRef({});
  const signupCompletion = useRef(null);
  const [connecting, setConnecting] = useState(false);
  const [signupError, setSignupError] = useState("");
  const [section, setSection] = useState("connection");
  const operations = state.whatsappOperations || { accounts: [], phoneNumbers: [], nativeFlows: [], mediaAssets: [], capabilities: [], analytics: [] };
  const activeAccount = operations.accounts.find((item) => item.isDefault) || operations.accounts[0];
  const activePhone = operations.phoneNumbers.find((item) => item.isDefault) || operations.phoneNumbers[0];
  useEffect(() => {
    const listener = (event) => {
      if (!/^https:\/\/([a-z0-9-]+\.)*facebook\.com$/i.test(event.origin)) return;
      let payload = event.data;
      if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { return; } }
      if (payload?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (payload.event === 'FINISH' || payload.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
        signupData.current = { ...(payload.data || {}), sessionEvent: payload.event };
        setSignupError("");
        signupCompletion.current?.();
        return;
      }
      if (payload.event === "CANCEL" || payload.event === "ERROR") {
        const detail = payload.data?.error_message || payload.data?.message || payload.data?.current_step || "Meta did not complete the WhatsApp connection.";
        signupData.current = { error: String(detail) };
        setSignupError(String(detail));
        signupCompletion.current?.();
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  const connectMeta = async (mode = 'standard') => {
    setConnecting(true);
    setSignupError("");
    signupData.current = {};
    try {
      const config = await api(`/api/meta/embedded-signup/config?mode=${mode}`);
      const FB = await loadFacebookSdk(config.appId, config.graphVersion);
      FB.login(metaSdkCallback(async (response) => {
        const code = response?.authResponse?.code;
        if (!code) {
          const reason = response?.status === 'not_authorized' ? 'Meta did not authorize this app. Confirm the Embedded Signup configuration and app permissions.' : 'Meta sign-up was cancelled or did not return authorization. Confirm the configuration ID, app domain, and allowed OAuth domain in Meta.';
          setSignupError(signupData.current.error || reason);
          setConnecting(false);
          return;
        }
        if (mode === 'coexistence' && !signupData.current.sessionEvent) {
          await new Promise((resolve) => {
            signupCompletion.current = resolve;
            setTimeout(resolve, 15000);
          });
          signupCompletion.current = null;
        }
        if (mode === 'coexistence' && signupData.current.sessionEvent !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
          setConnecting(false);
          setSignupError(signupData.current.error || 'Meta did not complete Business App coexistence onboarding.');
          return;
        }
        const completion = await postJson('/api/meta/embedded-signup/complete', { code, mode, sessionEvent: signupData.current.sessionEvent,
          wabaId: signupData.current.waba_id, phoneNumberId: signupData.current.phone_number_id
        });
        await mutate(Promise.resolve(completion), 'WhatsApp Business connected');
        setConnecting(false);
      }, (error) => { setConnecting(false); setSignupError(error.message || 'Meta signup could not be completed.'); }), { config_id: config.configId, response_type: 'code', override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: '3', ...(mode === 'coexistence' ? { featureType: 'whatsapp_business_app_onboarding' } : {}) } });
    } catch (error) { setConnecting(false); setSignupError(error.message || 'Meta signup could not be opened.'); }
  };
  const checkConnection = () => mutate(postJson("/api/meta/connection/check", {}), "Connection check complete");
  const disconnect = () => mutate(postJson("/api/meta/connection/disconnect", {}), "WhatsApp Business disconnected");
  const runOperation = (body, message) => mutate(postJson("/api/whatsapp/operations", body), message);
  const uploadMedia = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("phoneId", activePhone?.id || "");
    mutate(uploadForm("/api/whatsapp/media", form).then(() => event.currentTarget.reset()), "Media uploaded to WhatsApp");
  };
  const submitManual = (event) => { event.preventDefault(); mutate(postJson("/api/setup", Object.fromEntries(new FormData(event.currentTarget)), "PUT"), "Manual setup saved"); };
  const metadata = state.setup.connectionMetadata || {};
  return <div className="screenGrid metaSetupScreen">
    <section className="metaConnectHero">
      <div><p className="kicker">Official Meta onboarding</p><h2>{state.setup.status === 'Connected' ? 'WhatsApp Business is connected' : 'Connect your WhatsApp Business account'}</h2><span>Choose the connection that matches where your business number is used today.</span></div>
      <div className="metaConnectActions">
        <button className="primaryAction metaConnectButton" type="button" onClick={() => connectMeta('standard')} disabled={connecting || !state.meta.embeddedSignupAvailable}><Link2 size={18} /> Cloud API number</button>
        <button className="secondaryAction" type="button" onClick={() => connectMeta('coexistence')} disabled={connecting || !state.meta.embeddedSignupAvailable}><Smartphone size={18} /> Existing Business App number</button>
      </div>
    </section>
    {!state.meta.embeddedSignupAvailable && <div className="formError">The platform owner must configure META_APP_ID, META_APP_SECRET and META_EMBEDDED_SIGNUP_CONFIG_ID on the server.</div>}
    {signupError && <div className="formError" role="alert">{signupError}</div>}
    <CoexistenceProgress phones={operations.phoneNumbers.filter(phone=>phone.coexistence)} api={api} postJson={postJson}/>
    <nav className="operationsTabs" aria-label="WhatsApp settings">
      {[
        ["connection", Activity, "Connection"], ["numbers", Smartphone, "Numbers"], ["profile", Building2, "Profile"],
        ["flows", Workflow, "WhatsApp Flows"], ["media", Paperclip, "Media"], ["commerce", ShoppingBag, "Commerce"],
        ["entry_points", Link2, "Links and QR codes"], ["analytics", BarChart3, "Meta analytics"], ["journeys", Activity, "Customer journeys"], ["capabilities", RadioTower, "Capabilities"], ...(state.featureFlags?.whatsapp_groups ? [["groups", MessageSquare, "Groups"]] : []), ...(["Owner", "Manager"].includes(state.account.role) ? [["integrations", KeyRound, "Integrations"]] : [])
      ].map(([id, Icon, label]) => <button key={id} type="button" className={section === id ? "active" : ""} onClick={() => setSection(id)}><Icon size={16} /><span>{label}</span></button>)}
    </nav>
    {section === 'entry_points' && <WhatsAppEntryPoints key={activePhone?.id} phone={activePhone} api={api} postJson={postJson} role={state.account.role}/>}
    {section === 'flows' && <WhatsAppFlowDesigner api={api} postJson={postJson} flows={operations.nativeFlows} onUploaded={()=>mutate(Promise.resolve({ok:true}), 'Flow uploaded')}/>}
    {section === 'flows' && <NativeFlowWorkspace api={api} postJson={postJson} role={state.account.role}/>}
    {section === 'journeys' && <WhatsAppJourneyAnalytics api={api}/>}
    {section === 'groups' && <WhatsAppGroups api={api} postJson={postJson} enabled={state.featureFlags?.whatsapp_groups} />}
    {section === 'integrations' && isWorkspaceManager(state.account.role) && <><IntegrationMarketplace api={api} /><WorkspaceIntegrations api={api} postJson={postJson}/><ProviderConnectors api={api} postJson={postJson} canEdit={state.account.role === 'Owner'} /><TrackedLinks api={api} postJson={postJson} role={state.account.role}/>{state.featureFlags?.webviews&&<WhatsAppWebviews api={api} postJson={postJson}/>} {state.featureFlags?.crm_sync&&state.account.role==='Owner'&&<><HubSpotConnection api={api} postJson={postJson} role={state.account.role}/><HubSpotConnection provider="salesforce" api={api} postJson={postJson} role={state.account.role}/></>}</>}
    {section === "connection" && <>
<div className="contentGrid twoColumns"><Panel title="Connection health" subtitle="Live values verified against this company workspace"><div className="connectionSummary"><div><span>Connection</span><Badge kind={state.setup.status === "Connected" ? "good" : "warn"}>{state.setup.status}</Badge></div><div><span>Onboarding</span><strong>{state.setup.onboardingMethod === 'coexistence' ? 'Business App coexistence' : state.setup.onboardingMethod === 'embedded_signup' ? 'Embedded Signup' : 'Manual'}</strong></div><div><span>Webhook subscription</span><Badge kind={state.setup.webhookSubscribed ? "good" : "warn"}>{state.setup.webhookSubscribed ? "Subscribed" : "Not verified"}</Badge></div><div><span>Business number</span><strong>{state.setup.whatsappNumber || "Not connected"}</strong></div><div><span>WABA ID</span><strong>{state.setup.wabaId || "Not connected"}</strong></div><div><span>Phone Number ID</span><strong>{state.setup.phoneNumberId || "Not connected"}</strong></div><div><span>Verified name</span><strong>{metadata.verifiedName || activePhone?.verifiedName || "Unavailable"}</strong></div><div><span>Quality rating</span><strong>{metadata.qualityRating || activePhone?.qualityRating || "Unavailable"}</strong></div><div><span>Token health</span><Badge kind={activeAccount?.token.status === "healthy" ? "good" : "warn"}>{activeAccount?.token.status || "Unknown"}</Badge></div><div><span>Token expiry</span><strong>{activeAccount?.token.expiresAt ? formatTime(activeAccount.token.expiresAt) : "Reconnect when Meta requests"}</strong></div><div><span>Meta health</span><Badge kind={activeAccount?.health?.status === "healthy" ? "good" : "warn"}>{activeAccount?.health?.status === "healthy" ? "Healthy" : activeAccount?.health?.status === "reconnect_required" ? "Reconnect needed" : activeAccount?.health?.status === "degraded" ? "Needs attention" : "Awaiting check"}</Badge></div><div><span>Last checked</span><strong>{formatTime(activeAccount?.health?.checkedAt)}</strong></div></div><div className="connectionActions"><button className="secondaryAction" type="button" onClick={checkConnection} disabled={state.setup.status !== "Connected"}><Activity size={17} /> Verify</button><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "sync", accountId: activeAccount?.id }, "WhatsApp assets synchronized")} disabled={!activeAccount}><RefreshCcw size={17} /> Sync assets</button><button className="secondaryAction dangerSoft" type="button" onClick={disconnect} disabled={state.setup.status !== "Connected"}><Unplug size={17} /> Disconnect</button></div></Panel><Panel title="Webhook endpoint" subtitle="Subscribe this HTTPS callback to WhatsApp webhook fields"><div className="webhookCard"><code>{state.setup.webhookUrl || state.meta.webhookUrl || "Configure APP_URL on the server"}</code><div><span>Signature verification</span><Badge kind="good">Server-side</Badge></div><div><span>WABA subscription</span><Badge kind={activeAccount?.webhookSubscribed ? "good" : "warn"}>{activeAccount?.webhookSubscribed ? "Subscribed" : "Not subscribed"}</Badge></div><div><span>Last message/status event</span><strong>{formatTime(activeAccount?.health?.lastMessageWebhookAt)}</strong></div><div><span>Last callback</span><strong>{formatTime(activeAccount?.health?.lastWebhookAt)}</strong></div><div><span>Last event field</span><strong>{activeAccount?.health?.lastWebhookField || "None received"}</strong></div></div></Panel></div>
      <details className="manualSetup"><summary>Manual credentials fallback</summary><Panel title="Manual Meta credentials" subtitle="Embedded Signup is recommended for customer workspaces"><form className="formGrid" onSubmit={submitManual}><Input name="businessName" label="Business name" defaultValue={state.setup.businessName} /><Input name="whatsappNumber" label="WhatsApp number" defaultValue={state.setup.whatsappNumber} /><Input name="wabaId" label="WABA ID" defaultValue={state.setup.wabaId} /><Input name="phoneNumberId" label="Phone Number ID" defaultValue={state.setup.phoneNumberId} /><Input name="webhookUrl" label="Webhook URL" defaultValue={state.setup.webhookUrl} /><Input name="accessToken" label="Access token" defaultValue={state.setup.accessToken} placeholder="Paste token" /><button className="primaryAction" type="submit"><BadgeCheck size={18} /> Save manual setup</button></form></Panel></details>
    </>}
    {section === "numbers" && <Panel title="WhatsApp phone numbers" subtitle="Every number remains isolated to this company; the default number is used by campaigns and inbox replies">
      <div className="assetToolbar"><span>{operations.phoneNumbers.length} connected number{operations.phoneNumbers.length === 1 ? "" : "s"}</span><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "sync", accountId: activeAccount?.id }, "Phone numbers synchronized")} disabled={!activeAccount}><RefreshCcw size={17} /> Sync from Meta</button></div>
      <div className="phoneAssetGrid">{operations.phoneNumbers.map((phone) => <article className={`phoneAsset ${phone.isDefault ? "selected" : ""}`} key={phone.id}><header><div className="assetIcon"><Smartphone size={20} /></div><div><strong>{phone.verifiedName || phone.displayPhoneNumber}</strong><span>{phone.displayPhoneNumber || phone.phoneNumberId}</span></div><Badge kind={phone.qualityRating === "GREEN" ? "good" : phone.qualityRating === "RED" ? "bad" : "warn"}>{phone.qualityRating}</Badge></header><dl><div><dt>Status</dt><dd>{phone.status}</dd></div><div><dt>Messaging tier</dt><dd>{phone.messagingLimitTier}</dd></div><div><dt>Platform</dt><dd>{phone.platformType}</dd></div><div><dt>Registration</dt><dd>{phone.registrationState}</dd></div></dl><div className="assetActions"><button className="secondaryAction" type="button" disabled={phone.isDefault} onClick={() => runOperation({ action: "select_phone", phoneId: phone.id }, "Default WhatsApp number changed")}>{phone.isDefault ? <BadgeCheck size={16} /> : <CheckCheck size={16} />}{phone.isDefault ? "Default number" : "Use this number"}</button>{!phone.coexistence && <form onSubmit={(event) => { event.preventDefault(); const pin = new FormData(event.currentTarget).get("pin"); runOperation({ action: "register_phone", phoneId: phone.id, pin }, "Phone number registered"); event.currentTarget.reset(); }}><input name="pin" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" placeholder="6-digit PIN" aria-label="Two-step verification PIN" required /><button className="secondaryAction" title="Register number"><KeyRound size={16} /> Register</button></form>}</div></article>)}</div>
      {activePhone && !activePhone.coexistence && <details className="numberVerification"><summary>Verify or migrate the selected number</summary><div><form onSubmit={(event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); runOperation({ action: "request_code", phoneId: activePhone.id, ...values }, "Verification code requested"); }}><label>Delivery method<select name="method"><option value="SMS">SMS</option><option value="VOICE">Voice call</option></select></label><Input name="language" label="Language" defaultValue="en_US" /><button className="secondaryAction"><PhoneCall size={16} /> Request code</button></form><form onSubmit={(event) => { event.preventDefault(); const code = new FormData(event.currentTarget).get("code"); runOperation({ action: "verify_code", phoneId: activePhone.id, code }, "Phone number verified"); event.currentTarget.reset(); }}><Input name="code" label="Verification code" inputMode="numeric" required /><button className="secondaryAction"><BadgeCheck size={16} /> Verify code</button></form></div></details>}
      {!operations.phoneNumbers.length && <EmptyState text="Connect Meta, then sync phone numbers" />}
    </Panel>}
    {section === "profile" && <Panel title="WhatsApp business profile" subtitle={activePhone ? `Profile for ${activePhone.displayPhoneNumber}` : "Connect a phone number first"}>
      {activePhone ? <form className="formGrid profileForm" key={activePhone.id} onSubmit={(event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); runOperation({ action: "update_profile", phoneId: activePhone.id, profile: values }, "Business profile updated"); }}><Input name="about" label="About" defaultValue={activePhone.profile.about || ""} maxLength="139" /><Input name="email" label="Public email" type="email" defaultValue={activePhone.profile.email || ""} /><Input name="address" label="Address" defaultValue={activePhone.profile.address || ""} /><label>Business category<select name="vertical" defaultValue={activePhone.profile.vertical || "OTHER"}><option value="OTHER">Other</option><option value="RETAIL">Retail</option><option value="PROF_SERVICES">Professional services</option><option value="EDU">Education</option><option value="HEALTH">Health</option><option value="TRAVEL">Travel</option><option value="RESTAURANT">Restaurant</option></select></label><label className="wideField">Description<textarea name="description" rows="4" maxLength="512" defaultValue={activePhone.profile.description || ""} /></label><label className="wideField">Websites<textarea name="websites" rows="2" defaultValue={(activePhone.profile.websites || []).join("\n")} placeholder="One URL per line" /></label><div className="formActions wideField"><button className="primaryAction" type="submit"><Save size={17} /> Save profile</button><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "sync_profile", phoneId: activePhone.id }, "Business profile synchronized")}><RefreshCcw size={17} /> Reload from Meta</button></div></form> : <EmptyState text="No active WhatsApp number" />}
    </Panel>}
{section === "flows" && <div className="contentGrid twoColumns"><Panel title="Create native WhatsApp Flow" subtitle="Meta-hosted forms for booking, lead capture, and structured onboarding"><form className="formGrid" onSubmit={(event) => { event.preventDefault(); runOperation({ action: "create_flow", ...Object.fromEntries(new FormData(event.currentTarget)), accountId: activeAccount?.id, phoneId: activePhone?.id }, "WhatsApp Flow created"); event.currentTarget.reset(); }}><Input name="name" label="Flow name" required /><label>Category<select name="category"><option value="LEAD_GENERATION">Lead generation</option><option value="APPOINTMENT_BOOKING">Appointment booking</option><option value="SIGN_UP">Sign up</option><option value="CONTACT_US">Contact us</option><option value="OTHER">Other</option></select></label><label className="checkRow"><input name="managedEndpoint" type="checkbox" disabled={!activePhone?.flowEncryption?.configured || activePhone?.flowEncryption?.signatureStatus !== "VALID"} /> Use CRM data endpoint</label><label>CRM endpoint mode<select name="managedEndpointMode"><option value="preset">Saved responses</option><option value="transactional">Live booking or order runtime</option></select></label><Input name="endpointUri" label="External data endpoint (optional)" type="url" /><button className="primaryAction" disabled={!activeAccount}><Plus size={17} /> Create in Meta</button></form></Panel><Panel title="Meta Flow library" subtitle="Published Flows are immutable; clone in Meta before changing a published Flow"><div className="flowAssetList">{operations.nativeFlows.map((flow) => <article key={flow.id}><header><div><strong>{flow.name}</strong><span>{flow.category} | {flow.metaFlowId || "Local"}</span></div><Badge kind={flow.status === "published" ? "good" : flow.validationErrors.length ? "bad" : "warn"}>{flow.status}</Badge></header>{flow.managedEndpoint && !flow.transactionalEndpoint && <details><summary>Data responses</summary><form onSubmit={(event) => { event.preventDefault(); try { runOperation({ action: "set_flow_responses", flowId: flow.id, responses: JSON.parse(new FormData(event.currentTarget).get("responses")) }, "Flow responses saved"); } catch { mutate(Promise.reject(new Error("Enter valid response JSON."))); } }}><textarea name="responses" rows="8" defaultValue={JSON.stringify(flow.endpointResponses || {}, null, 2)} required /><button className="secondaryAction"><Save size={16} /> Save responses</button></form><small>{flow.endpointUri}</small></details>}<details><summary>Flow JSON</summary><form onSubmit={(event) => { event.preventDefault(); runOperation({ action: "upload_flow", flowId: flow.id, flowJson: new FormData(event.currentTarget).get("flowJson") }, "Flow definition uploaded"); }}><textarea name="flowJson" rows="8" defaultValue={JSON.stringify(flow.flowJson || {}, null, 2)} required /><button className="secondaryAction"><Upload size={16} /> Validate and upload</button></form></details><div className="assetActions"><button className="secondaryAction" type="button" disabled={flow.status === "published"} onClick={() => runOperation({ action: "publish_flow", flowId: flow.id }, "WhatsApp Flow published")}><Play size={16} /> Publish</button></div>{flow.validationErrors.map((error, index) => <small className="errorLine" key={index}>{error.error || error.message || JSON.stringify(error)}</small>)}</article>)}</div><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "sync_flows", accountId: activeAccount?.id }, "WhatsApp Flows synchronized")} disabled={!activeAccount}><RefreshCcw size={17} /> Sync from Meta</button>{!operations.nativeFlows.length && <EmptyState text="No native WhatsApp Flows yet" />}</Panel></div>}
    {section === "flows" && activePhone && <Panel title="Flow encryption" subtitle={activePhone.displayPhoneNumber}><div className="connectionActions"><Badge kind={activePhone.flowEncryption?.signatureStatus === "VALID" ? "good" : "warn"}>{activePhone.flowEncryption?.signatureStatus || "Not configured"}</Badge><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "configure_flow_encryption", phoneId: activePhone.id }, "Flow encryption configured")}><KeyRound size={17} /> Configure in Meta</button></div></Panel>}
    {section === "media" && <div className="contentGrid twoColumns"><Panel title="Upload WhatsApp media" subtitle="Files are uploaded directly to Meta; only their IDs and metadata are retained"><form className="formGrid" onSubmit={uploadMedia}><label className="fileDrop"><input name="file" type="file" accept="image/jpeg,image/png,video/mp4,video/3gpp,audio/*,application/pdf,text/plain" required /><Upload size={22} /><strong>Choose media</strong></label><button className="primaryAction" disabled={!activePhone}><Upload size={17} /> Upload to Meta</button></form></Panel><Panel title="Media library" subtitle="Tenant-owned Meta media handles for messages and templates"><div className="mediaAssetList">{operations.mediaAssets.map((asset) => <article key={asset.id}><div><Image size={18} /><span><strong>{asset.filename || asset.metaMediaId}</strong><small>{asset.mimeType} | {Math.ceil(asset.byteSize / 1024)} KB</small></span></div><button className="iconButton dangerSoft" type="button" title="Delete media" onClick={() => mutate(api(`/api/whatsapp/media?id=${encodeURIComponent(asset.id)}`, { method: "DELETE" }), "Media deleted")}><Trash2 size={16} /></button></article>)}</div>{!operations.mediaAssets.length && <EmptyState text="No uploaded WhatsApp media" />}</Panel></div>}
    {section === "commerce" && <div className="contentGrid twoColumns"><Panel title="Commerce settings" subtitle={activePhone ? `Catalog visibility for ${activePhone.displayPhoneNumber}` : "Connect a phone number first"}>{activePhone ? <form className="formGrid" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); runOperation({ action: "update_commerce", phoneId: activePhone.id, isCartEnabled: form.get("isCartEnabled") === "on", isCatalogVisible: form.get("isCatalogVisible") === "on" }, "Commerce settings updated"); }}><label className="checkRow"><input name="isCatalogVisible" type="checkbox" defaultChecked={Boolean(activePhone.commerceSettings.is_catalog_visible)} /> Catalog visible in WhatsApp</label><label className="checkRow"><input name="isCartEnabled" type="checkbox" defaultChecked={Boolean(activePhone.commerceSettings.is_cart_enabled)} /> Shopping cart enabled</label><div className="formActions"><button className="primaryAction"><Save size={17} /> Save settings</button><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "sync_commerce", phoneId: activePhone.id }, "Commerce settings synchronized")}><RefreshCcw size={17} /> Sync from Meta</button></div></form> : <EmptyState text="No active WhatsApp number" />}</Panel><Panel title="Send product message" subtitle="Available only to an existing contact inside the customer service window"><form className="formGrid" onSubmit={(event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); runOperation({ action: "send_commerce_message", phoneId: activePhone?.id, ...values }, "Product message sent"); event.currentTarget.reset(); }}><Input name="recipient" label="Contact phone" required /><Input name="catalogId" label="Meta catalog ID" required /><label>Message type<select name="mode"><option value="product">Single product</option><option value="product_list">Product list</option></select></label><Input name="header" label="Header" /><label className="wideField">Message<textarea name="body" rows="3" required /></label><Input name="sectionTitle" label="Section title" /><label className="wideField">Product retailer IDs<textarea name="products" rows="4" required /></label><button className="primaryAction" disabled={!activePhone}><ShoppingBag size={17} /> Send product message</button></form></Panel></div>}
    {section === "analytics" && <Panel title="Meta WhatsApp analytics" subtitle="Account-level messaging and conversation analytics are stored as dated snapshots"><div className="assetToolbar"><span>{operations.analytics.length} recent snapshot{operations.analytics.length === 1 ? "" : "s"}</span><button className="primaryAction" type="button" onClick={() => runOperation({ action: "sync_analytics", accountId: activeAccount?.id }, "Meta analytics synchronized")} disabled={!activeAccount}><RefreshCcw size={17} /> Sync last 30 days</button></div><div className="analyticsSnapshotGrid">{operations.analytics.map((snapshot) => <article key={snapshot.id}><BarChart3 size={19} /><div><strong>{snapshot.metricType.toUpperCase()}</strong><span>{formatTime(snapshot.periodStart)} to {formatTime(snapshot.periodEnd)}</span><small>Collected {formatTime(snapshot.collectedAt)}</small></div></article>)}</div>{!operations.analytics.length && <EmptyState text="Sync Meta analytics to create the first snapshot" />}</Panel>}
    {section === "capabilities" && <div className="contentGrid twoColumns"><Panel title="Post-approval activation" subtitle="Run after Meta App Review to pull entitlements into this workspace"><div className="assetToolbar"><Badge kind={operations.activationChecklist?.readyForMessaging ? "good" : "warn"}>{operations.activationChecklist?.readyForMessaging ? "Ready for messaging" : `${operations.activationChecklist?.blockerCount || 0} blocker(s)`}</Badge><button className="primaryAction" type="button" disabled={!activeAccount} onClick={() => runOperation({ action: "refresh_entitlements", accountId: activeAccount?.id }, "Meta entitlements refreshed")}><RefreshCcw size={17} /> Refresh entitlements</button></div><div className="readinessList">{operations.activationChecklist?.steps?.map((step) => <div key={step.id} className={step.status === "pass" ? "ready" : ""}><span>{step.label}</span><Badge kind={step.status === "pass" ? "good" : step.status === "warn" ? "warn" : "bad"}>{step.status === "pass" ? "OK" : step.status === "warn" ? "Review" : "Blocked"}</Badge><small>{step.detail}</small></div>)}</div></Panel><Panel title="WhatsApp capability readiness" subtitle="Inferred from your connected WABA and synced Meta data"><div className="capabilityGrid">{operations.capabilities.map((capability) => <article key={capability.key}><div className="capabilityIcon"><RadioTower size={18} /></div><div><strong>{capability.name}</strong><span>{capability.detail || capability.prerequisite}</span></div><Badge kind={capability.status === "available" ? "good" : capability.status === "setup" ? "warn" : "neutral"}>{capability.status === "available" ? "Configured" : capability.status === "setup" ? "Setup needed" : "Not integrated"}</Badge></article>)}</div><MmLiteOptimizerPanel api={api} /></Panel></div>}
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
  const [editContact, setEditContact] = useState(null);
  const canManage = isWorkspaceManager(state.account.role);
  const modeParam = permissionFilter === "allowed" ? "marketable" : permissionFilter === "blocked" ? "suppressed" : "all";
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoadingContacts(true);
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "25", mode: modeParam });
        if (search.trim()) params.set("q", search.trim());
        const result = await api(`/api/workspace/contacts?${params}`);
        if (!active) return;
        setContacts(result.contacts || []);
        setPagination(result.pagination?.contacts || { page, pages: 1, total: 0 });
      } catch {
        if (active) setContacts([]);
      } finally {
        if (active) setLoadingContacts(false);
      }
    }, search ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [page, search, modeParam, state.account.business.id]);
  const refreshContacts = () => setPage((p) => p);
  const add = (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); mutate(postJson("/api/contacts", { name: form.get("name"), phone: form.get("phone"), tags: form.get("tags"), optInSource: form.get("optInSource"), consentEvidence: form.get("consentEvidence"), marketingPermission: form.get("marketingPermission") === "on" }).then(() => { refreshContacts(); }), "Contact saved"); event.currentTarget.reset(); };
  const importRows = (event) => { event.preventDefault(); if (!csvText.trim()) return; mutate(postJson("/api/contacts/import", { csv: csvText }).then((next) => { setCsvText(""); setFileName(""); return next; }), "Contacts imported"); };
  const chooseFile = async (event) => { const file = event.target.files?.[0]; if (!file) return; event.target.value = ""; if (file.size > 2 * 1024 * 1024) { mutate(Promise.reject(new Error("Choose a CSV file no larger than 2 MB."))); return; } setFileName(file.name); setCsvText(await file.text()); };
  const saveContact = (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const allowed = form.get("marketingPermission") === "allowed"; mutate(postJson(`/api/contacts/${editContact.id}`, { name: form.get("name"), phone: form.get("phone"), tags: form.get("tags"), optInSource: form.get("optInSource"), consentEvidence: form.get("consentEvidence"), marketingPermission: allowed, unsubscribed: !allowed, customAttributes: attributesFromText(form.get("customAttributes")) }, "PATCH").then((next) => { setEditContact(null); return next; }), "Contact updated"); };
  return <div className="screenGrid">
    <div className="contentGrid audienceGrid">
      {canManage && <Panel title="Add contact" subtitle="Create a permission-aware WhatsApp contact"><form className="formGrid" onSubmit={add}><Input name="name" label="Name" required /><Input name="phone" label="Phone with country code" required /><Input name="tags" label="Tags" placeholder="lead, customer" /><Input name="optInSource" label="Opt-in source" /><Input name="consentEvidence" label="Consent evidence (when allowed)" placeholder="When and how this contact opted in" /><label className="checkRow"><input name="marketingPermission" type="checkbox" /> Marketing permission recorded</label><button className="primaryAction" type="submit"><Plus size={18} /> Add contact</button></form></Panel>}
      {canManage && <Panel title="Import contacts" subtitle="CSV: name, phone, permission, tags, opt_in_source, consent_evidence"><form className="formGrid importForm" onSubmit={importRows}><label className="fileDrop"><input type="file" accept=".csv,text/csv" onChange={chooseFile} /><Upload size={22} /><strong>{fileName || "Choose CSV file"}</strong><span>{fileName ? "Ready to import" : "or paste CSV rows below"}</span></label><label>CSV rows<textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder="name,phone,permission,tags,opt_in_source,consent_evidence" /></label><div className="importMeta"><span>{csvText.trim() ? `${csvText.trim().split(/\r?\n/).length} rows ready` : "No rows loaded"}</span><button className="secondaryAction" type="submit" disabled={!csvText.trim()}><Upload size={18} /> Import</button></div></form></Panel>}
    </div>
    <SavedSegments initialSegments={state.audienceSegments || []} canManage={canManage} mutate={mutate} />
    <Panel title="Contacts" subtitle={loadingContacts ? 'Loading…' : `${contacts.length} on page · ${pagination.total ?? 0} total`}><div className="dataToolbar contactToolbar"><label className="searchBox"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search contacts" /></label><select value={permissionFilter} onChange={(event) => { setPermissionFilter(event.target.value); setPage(1); }}><option value="all">All contacts</option><option value="allowed">Marketable</option><option value="blocked">Suppressed</option></select>{canManage && <a className="secondaryAction exportAction" href="/api/contacts/export"><Download size={18} /> Export CSV</a>}</div><DataTable headers={["Name", "Phone", "Permission", "Last activity", "Actions"]}>{contacts.map((contact) => <tr key={contact.id}><td><strong>{contact.name}</strong><div className="chipRow compact">{(contact.tags || []).map((tag) => <span key={tag}>{tag}</span>)}</div></td><td>{contact.phone}</td><td><Badge kind={contact.unsubscribed ? "bad" : contact.marketingPermission ? "good" : "bad"}>{contact.unsubscribed ? "Suppressed" : contact.marketingPermission ? "Allowed" : "Blocked"}</Badge></td><td>{formatTime(contact.lastMessageAt)}</td><td className="rowActions">{canManage && <><button onClick={() => setEditContact(contact)}><Pencil size={15} /> Edit</button><button className="dangerText" onClick={() => mutate(postJson(`/api/contacts/${contact.id}`, {}, "DELETE").then(() => refreshContacts()), "Removed")}><Trash2 size={15} /> Remove</button></>}</td></tr>)}</DataTable>{!contacts.length && !loadingContacts && <EmptyState text="No contacts match this view" />}{(pagination.pages > 1 || page > 1) && <nav className="pagination" aria-label="Contacts pagination"><span>Page {pagination.page} of {pagination.pages}</span><div><button className="secondaryAction" type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button><button className="secondaryAction" type="button" disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</button></div></nav>}</Panel>
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
  const accounts = (state.whatsappOperations?.accounts || []).filter((account) => account.status === "connected");
  const [accountId, setAccountId] = useState(accounts.find((account) => account.isDefault)?.id || accounts[0]?.id || "");
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const create = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    mutate(postJson("/api/templates", {
      accountId,
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
return <div className="screenGrid"><section className="actionBand"><div><strong>Meta template library</strong><span>Approval status and components stay synchronized with your WABA.</span></div><button className="secondaryAction" type="button" onClick={sync} disabled={!selectedAccount}><RefreshCcw size={18} /> Sync from Meta</button></section><label>WhatsApp account<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Select an account</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name ? `${account.name} (${account.wabaId})` : account.wabaId}</option>)}</select></label><Panel title="Create WhatsApp template" subtitle="Marketing, utility, authentication, media headers, and action buttons"><form className="templateComposer fullTemplateComposer" onSubmit={create}><Input name="name" label="Template name" required /><label>Category<select name="category"><option value="MARKETING">Marketing</option><option value="UTILITY">Utility</option><option value="AUTHENTICATION">Authentication / OTP</option></select></label><Input name="language" label="Meta language code" defaultValue="en_US" pattern="[a-z]{2,3}(_[A-Z]{2})?" maxLength="9" required /><label>Header format<select name="headerFormat"><option value="NONE">No header</option><option value="TEXT">Text</option><option value="IMAGE">Image</option><option value="VIDEO">Video</option><option value="DOCUMENT">Document</option></select></label><Input name="headerText" label="Text header" maxLength="60" /><Input name="headerMediaHandle" label="Meta media handle" /><label className="templateBodyField">Body<textarea name="body" placeholder="Use variables like {{name}}" required /></label><Input name="footerText" label="Footer" maxLength="60" /><Input name="buttons" label="Quick replies" placeholder="Pricing, Book demo" /><details className="advancedTemplateFields"><summary>Advanced buttons and OTP settings</summary><label>Buttons<textarea name="advancedButtons" rows="4" placeholder={"QUICK_REPLY|Pricing\nURL|Visit website|https://example.com\nPHONE_NUMBER|Call us|+919000000000"} /></label><div className="formSplit"><label>OTP action<select name="otpType"><option value="COPY_CODE">Copy code</option><option value="ONE_TAP">One-tap autofill</option></select></label><Input name="otpButtonText" label="OTP button text" defaultValue="Copy code" maxLength="25" /><Input name="codeExpirationMinutes" label="Code expiry (minutes)" type="number" min="1" max="90" defaultValue="10" /></div><div className="formSplit"><Input name="otpPackageName" label="Android package name (one-tap)" autoComplete="off" /><Input name="otpSignatureHash" label="Android app signature hash (one-tap)" autoComplete="off" /><Input name="otpAutofillText" label="One-tap button text" maxLength="25" /></div></details><button className="primaryAction" type="submit"><MessageSquareText size={18} /> Submit to Meta</button></form></Panel><AdvancedTemplateComposer accountId={accountId} postJson={postJson} onCreated={()=>mutate(Promise.resolve({ok:true}),"Template submitted")}/><div className="cardGrid">{state.templates.map((template) => <article className="templateCard" key={template.id}><div className="cardHead"><div><h3>{template.name}</h3><small>{template.category} | {template.language} | {accounts.find((account) => account.wabaId === template.wabaId)?.name || template.wabaId || "Unassigned"} | {template.componentSchema?.headerFormat || "TEXT"} | content revision {template.contentRevision ?? 1}</small></div><Badge kind={template.status === "Approved" ? "good" : template.status === "Pending" ? "warn" : "bad"}>{template.status}</Badge></div>{template.headerText && <strong className="templateHeaderText">{template.headerText}</strong>}<p>{template.body}</p>{template.footerText && <small className="templateFooterText">{template.footerText}</small>}<div className="chipRow">{(template.buttons || []).map((button) => <span key={`${button.type || "button"}-${button.text}`}>{button.type && button.type !== "QUICK_REPLY" ? `${button.type}: ` : ""}{button.text}</span>)}{template.variables.map((variable) => <span key={variable}>{`{{${variable}}}`}</span>)}</div><TemplateInsights template={template} />{template.rejectionReason && <small className="errorLine">{template.rejectionReason}</small>}</article>)}</div>{!state.templates.length && <Panel title="No templates"><EmptyState text="Submit or sync a WhatsApp template to begin" /></Panel>}</div>;
}
function AutomationFlows({ state, mutate, postJson, approvedTemplates, changePage }) {
  const flows = state.automationFlows || [];
  const teamMembers = state.teamMembers || [];
  const [editingId, setEditingId] = useState("");
  const [flowMeta, setFlowMeta] = useState({ name: "", description: "", status: "draft", triggerMode: "keywords", triggerKeywords: "" });
  const [nodes, setNodes] = useState([]);
  const [selectedTemplateDetails, setSelectedTemplateDetails] = useState({});
  const [draggedNode, setDraggedNode] = useState("");
  const [formError, setFormError] = useState("");
  const [simulateText, setSimulateText] = useState("");
  const [simulateApiOutcome, setSimulateApiOutcome] = useState("success");
  const [simulateApiStatus, setSimulateApiStatus] = useState("200");
  const [simulateAdvancedOutcome, setSimulateAdvancedOutcome] = useState("success");
  const [simulateResult, setSimulateResult] = useState(null);
  const analytics = flows.reduce((totals, flow) => ({
    active: totals.active + flow.activeSessions,
    completed: totals.completed + flow.completedSessions,
    handoff: totals.handoff + flow.handoffSessions,
    pending: totals.pending + flow.pendingJobs
  }), { active: 0, completed: 0, handoff: 0, pending: 0 });

  const createNode = () => ({ id: `node_${Date.now().toString(36)}`, type: "question", body: "", inputKind: "buttons", options: [], next: "", fallback: "", captureAs: "", templateId: "", delayMinutes: 0, assignedUserId: "", allowedDestinations: [], statusBranches: [], productSections: [] });
  const reset = () => { setEditingId(""); setFlowMeta({ name: "", description: "", status: "draft", triggerMode: "keywords", triggerKeywords: "" }); setNodes([]); setFormError(""); };
  const updateMeta = (key, value) => setFlowMeta((current) => ({ ...current, [key]: value }));
  const updateNode = (nodeId, key, value) => setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, [key]: value } : node));
  const addNode = () => setNodes((current) => [...current, createNode()]);
  const removeNode = (nodeId) => setNodes((current) => current.filter((node) => node.id !== nodeId).map((node) => ({ ...node, next: node.next === nodeId ? "" : node.next, options: node.options.map((option) => ({ ...option, next: option.next === nodeId ? "" : option.next })) })));
  const addOption = (nodeId) => setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, options: [...node.options, { id: `option_${node.options.length + 1}`, label: "", description: "", match: "", next: "" }] } : node));
  const updateOption = (nodeId, index, key, value) => setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, options: node.options.map((option, optionIndex) => optionIndex === index ? { ...option, [key]: value } : option) } : node));
  const removeOption = (nodeId, index) => setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, options: node.options.filter((_, optionIndex) => optionIndex !== index) } : node));
  const reorderNode = (targetId) => {
    if (!draggedNode || draggedNode === targetId) return;
    setNodes((current) => {
      const from = current.findIndex((node) => node.id === draggedNode);
      const to = current.findIndex((node) => node.id === targetId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDraggedNode("");
  };

  const loadFlow = (flow) => {
    setEditingId(flow.id);
    setFlowMeta({ name: flow.name, description: flow.description || "", status: flow.status || "draft", triggerMode: flow.triggerMode || "keywords", triggerKeywords: (flow.triggerKeywords || []).join(", ") });
    setNodes((flow.definition?.nodes || []).map((node) => ({
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
      assignedUserId: node.assignedUserId || ""
      ,errorNext:node.errorNext||"",falseNext:node.falseNext||"",timeoutNext:node.timeoutNext||"",statusBranches:node.statusBranches||[],attribute:node.attribute||"",operator:node.operator||"equals",compareValue:node.compareValue??"",valueSource:node.valueSource||{kind:'context',key:''},connectionId:node.connectionId||"",requestFields:node.requestFields||[],responseMapping:node.responseMapping||[],orderIdSource:node.orderIdSource||{kind:'context',key:''},orderStatus:node.orderStatus||"processing",model:node.model||"",prompt:node.prompt||"",allowedDestinations:node.allowedDestinations||[],catalogId:node.catalogId||"",retailerId:node.retailerId||"",productSections:node.productSections||[]
    })));
    setFormError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
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
      errorNext:node.errorNext||"",falseNext:node.falseNext||"",timeoutNext:node.timeoutNext||"",statusBranches:node.statusBranches||[],attribute:node.attribute||"",operator:node.operator||"equals",compareValue:node.compareValue??"",valueSource:node.valueSource||{kind:'context',key:''},connectionId:node.connectionId||"",requestFields:node.requestFields||[],responseMapping:node.responseMapping||[],orderIdSource:node.orderIdSource||{kind:'context',key:''},orderStatus:node.orderStatus||"processing",model:node.model||"",prompt:node.prompt||"",allowedDestinations:node.allowedDestinations||[],catalogId:node.catalogId||"",retailerId:node.retailerId||"",productSections:node.productSections||[]
    })).filter((node) => node.id);
    return { startNodeId: cleanNodes[0]?.id || "", nodes: cleanNodes };
  };

  const submit = async (event) => {
    event.preventDefault();
    setFormError("");
    const definition = buildDefinition();
    if (!definition.nodes.length) { setFormError("Add at least one node before saving."); return; }
    if (["keywords", "regex"].includes(flowMeta.triggerMode) && !flowMeta.triggerKeywords.trim()) { setFormError("Add triggers or choose another trigger mode."); return; }
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

  const updateStatus = (flow, status) => mutate(postJson(`/api/automation/flows/${flow.id}`, { status }, "PATCH"), status === "active" ? "Flow activated" : "Flow paused");
  const archive = (flow) => mutate(postJson(`/api/automation/flows/${flow.id}`, {}, "DELETE"), "Flow archived");
  const process = () => mutate(postJson("/api/automation/process", { limit: 25 }), "Automation queue processed");

  return <div className="screenGrid automationScreen">
    <section className="automationHero">
      <div><p className="kicker">Automation studio</p><h2>Build reply flows without code</h2><span>Each company owns its own triggers, nodes, routes, follow-up templates, delays, and handoff rules.</span></div>
      <div className="automationKpis"><Metric label="Flows" value={state.pagination?.automation?.total ?? flows.length} /><Metric label="Active sessions on page" value={analytics.active} /><Metric label="Completed on page" value={analytics.completed} /><Metric label="Pending jobs on page" value={analytics.pending} /></div>
    </section>

    <section className="actionBand automationTopbar">
      <div><strong>{editingId ? "Editing flow" : "New flow"}</strong><span>Use drag handles to reorder nodes. The first node becomes the start node.</span></div>
      <div className="actionCluster"><button className="secondaryAction" type="button" onClick={addNode}><Plus size={18} /> Add node</button><button className="secondaryAction" type="button" onClick={process}><RefreshCcw size={18} /> Process queue</button>{editingId && <button className="secondaryAction" type="button" onClick={reset}>Cancel edit</button>}</div>
    </section>

    <form className="visualFlowShell" onSubmit={submit}>
      <Panel title="Flow settings" subtitle="Stored per company and checked on the server.">
        <div className="formGrid automationForm">
          <Input label="Flow name" value={flowMeta.name} onChange={(event) => updateMeta("name", event.target.value)} placeholder="Flow name" required />
          <label>Description<textarea rows="3" value={flowMeta.description} onChange={(event) => updateMeta("description", event.target.value)} placeholder="Internal purpose for this flow"></textarea></label>
          <div className="formSplit"><label>Status<select value={flowMeta.status} onChange={(event) => updateMeta("status", event.target.value)}><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option></select></label><label>Trigger mode<select value={flowMeta.triggerMode} onChange={(event) => updateMeta("triggerMode", event.target.value)}><option value="keywords">Keywords</option><option value="regex">Safe regex</option><option value="any_inbound">Any inbound message</option><option value="manual">Manual only</option></select></label></div>
          <label>{flowMeta.triggerMode === 'regex' ? 'Regex triggers' : 'Trigger keywords'}<textarea rows="3" maxLength="4000" value={flowMeta.triggerKeywords} onChange={(event) => updateMeta("triggerKeywords", event.target.value)} placeholder="Comma or line separated triggers"></textarea></label>
          {formError && <div className="formError" role="alert">{formError}</div>}
          <div className="formSplit"><label>Dry-run sample reply<input value={simulateText} onChange={(event) => setSimulateText(event.target.value)} placeholder="Text a customer might send" /></label><label>API outcome<select value={simulateApiOutcome} onChange={(event) => setSimulateApiOutcome(event.target.value)}><option value="success">Success</option><option value="timeout">Timeout</option><option value="error">Error</option></select></label></div>
          <div className="formSplit"><label>API status<input value={simulateApiStatus} onChange={(event) => setSimulateApiStatus(event.target.value)} placeholder="200 or 4xx" /><small>Used when API outcome is success</small></label><label>Advanced node outcome<select value={simulateAdvancedOutcome} onChange={(event) => setSimulateAdvancedOutcome(event.target.value)}><option value="success">Success</option><option value="error">Error</option></select></label></div>
          <button className="secondaryAction" type="button" onClick={async () => { setFormError(""); try { setSimulateResult(await postJson("/api/automation/simulate", { definition: buildDefinition(), text: simulateText, apiOutcome: simulateApiOutcome, apiStatus: simulateApiStatus, advancedOutcome: simulateAdvancedOutcome })); } catch (error) { setFormError(error.message); setSimulateResult(null); } }}>Simulate path</button>
          {simulateResult && <ol className="simulateTrail">{simulateResult.steps.map((step) => <li key={step.nodeId}><strong>{step.type}</strong> {step.body || step.detail || ""}</li>)}</ol>}
          <button className="primaryAction" type="submit"><Bot size={18} /> <span>{editingId ? "Update flow" : "Save flow"}</span></button>
        </div>
      </Panel>

      <section className="flowCanvas" aria-label="Automation nodes">
        {nodes.map((node, nodeIndex) => <article className="flowNode" key={node.id} draggable onDragStart={() => setDraggedNode(node.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => reorderNode(node.id)}>
          <header><button className="iconButton dragHandle" type="button" title="Drag node"><Bot size={16} /></button><div><strong>{node.id || `Node ${nodeIndex + 1}`}</strong><span>{nodeIndex === 0 ? "Start node" : "Step node"}</span></div><button className="iconButton dangerSoft" type="button" title="Remove node" onClick={() => removeNode(node.id)}><Trash2 size={16} /></button></header>
          <div className="nodeFields">
            <label>Node ID<input value={node.id} onChange={(event) => updateNode(node.id, "id", event.target.value)} /></label>
            <label>Type<select value={node.type} onChange={(event) => { const value = event.target.value; setNodes((current) => current.map((item) => item.id === node.id ? { ...item, type: value, ...(value === "section_list" ? { inputKind: "list" } : {}) } : item)); }}><option value="question">Question</option><option value="message">Message</option><option value="template">Template follow-up</option><option value="section_list">Section list</option><option value="single_product">Single product</option><option value="multi_product">Multi-product list</option><option value="ai_route">AI route</option><option value="handoff">Human handoff</option><option value="end">End</option><option value="attribute_condition">Contact condition</option><option value="set_contact_attribute">Set contact field</option><option value="api_request">API request</option><option value="order_lookup">Order lookup</option><option value="set_order_status">Update order status</option></select></label>
            <label>Input<select value={node.type === "section_list" ? "list" : node.inputKind} disabled={node.type === "section_list"} onChange={(event) => updateNode(node.id, "inputKind", event.target.value)}><option value="buttons">Buttons</option><option value="list">List</option><option value="text">Free text</option><option value="none">No input</option></select></label>
            {node.type === "section_list" && <div className="nodeFields"><label>List button text<input maxLength={20} value={node.buttonText || ""} onChange={(event) => updateNode(node.id, "buttonText", event.target.value)} placeholder="Choose" /></label><label>Section title<input maxLength={24} value={node.sectionTitle || ""} onChange={(event) => updateNode(node.id, "sectionTitle", event.target.value)} placeholder="Options" /></label></div>}
            <label>Next node<select value={node.next} onChange={(event) => updateNode(node.id, "next", event.target.value)}><option value="">None</option>{nodes.filter((item) => item.id !== node.id).map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>
          </div>
          <AutomationAdvancedNodeFields node={node} nodes={nodes} update={(key,value)=>updateNode(node.id,key,value)} api={api}/>
          {node.type === "template" && <div className="nodeFields"><label>Approved template<ApprovedTemplatePicker api={api} initialTemplates={approvedTemplates} value={node.templateId} onChange={value => updateNode(node.id, 'templateId', value)} onTemplate={template => setSelectedTemplateDetails(current => current[node.id]?.id === template?.id ? current : { ...current, [node.id]: template })} /></label><label>Delay minutes<input type="number" min="0" value={node.delayMinutes} onChange={(event) => updateNode(node.id, "delayMinutes", event.target.value)} /></label></div>}
          {node.type === 'template' && <><div className="nodeFields">{(selectedTemplateDetails[node.id]?.id === node.templateId ? selectedTemplateDetails[node.id] : approvedTemplates.find(template=>template.id===node.templateId))?.variables?.map(key=><label key={key}>Variable {key}<input required value={node.templateValues?.[key]||''} onChange={event=>updateNode(node.id,'templateValues',{...(node.templateValues||{}),[key]:event.target.value})}/></label>)}</div><TemplateParameterFields template={selectedTemplateDetails[node.id]?.id === node.templateId ? selectedTemplateDetails[node.id] : approvedTemplates.find(template=>template.id===node.templateId)} value={node.templateParameters||{}} onChange={value=>updateNode(node.id,'templateParameters',value)}/></>}
          {node.type === "handoff" && <label>Assign to<select value={node.assignedUserId} onChange={(event) => updateNode(node.id, "assignedUserId", event.target.value)}><option value="">Keep unassigned</option>{teamMembers.map((member) => <option key={member.id} value={member.id}>{member.name || member.email}</option>)}</select></label>}
          <label>Message<textarea rows="4" value={node.body} onChange={(event) => updateNode(node.id, "body", event.target.value)} placeholder="Message body. Use variables like {{name}} or captured values."></textarea></label>
          <div className="nodeFields"><label>Fallback<textarea rows="2" value={node.fallback} onChange={(event) => updateNode(node.id, "fallback", event.target.value)} placeholder="Shown when reply does not match"></textarea></label><label>Capture as<input value={node.captureAs} onChange={(event) => updateNode(node.id, "captureAs", event.target.value)} placeholder="Variable name" /></label></div>
          {(node.inputKind === "buttons" || node.inputKind === "list" || node.type === 'section_list') && <div className="optionEditor"><div className="optionHead"><strong>{node.type === 'section_list' ? 'Section rows' : 'Options'}</strong><button className="secondaryAction" type="button" onClick={() => addOption(node.id)} disabled={node.options.length >= (node.inputKind === 'buttons' && node.type !== 'section_list' ? 3 : 10)}><Plus size={16} /> Add option</button></div>{node.options.map((option, optionIndex) => <div className="optionRow" key={`${node.id}-${optionIndex}`}>{node.type === 'section_list'&&<input value={option.section||''} maxLength="24" onChange={(event) => updateOption(node.id, optionIndex, "section", event.target.value)} placeholder="section" />}<input value={option.id} onChange={(event) => updateOption(node.id, optionIndex, "id", event.target.value)} placeholder="id" /><input value={option.label} onChange={(event) => updateOption(node.id, optionIndex, "label", event.target.value)} placeholder="label" /><input value={option.match} onChange={(event) => updateOption(node.id, optionIndex, "match", event.target.value)} placeholder="match terms" /><select value={option.next} onChange={(event) => updateOption(node.id, optionIndex, "next", event.target.value)}><option value="">Next</option>{nodes.filter((item) => item.id !== node.id).map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select><button className="iconButton dangerSoft" type="button" onClick={() => removeOption(node.id, optionIndex)}><Trash2 size={15} /></button></div>)}</div>}
        </article>)}
        {!nodes.length && <button className="emptyFlowButton" type="button" onClick={addNode}><Plus size={22} /> Add the first automation node</button>}
      </section>
    </form>

    <AutomationConnections api={api} postJson={postJson} role={state.account.role}/>
    <div className="flowCardGrid">
      {flows.map((flow) => <article className="templateCard flowCard" key={flow.id}><div className="cardHead"><div><h3>{flow.name}</h3><p>{flow.description || "No description"}</p></div><Badge kind={flow.status === "active" ? "good" : flow.status === "paused" ? "warn" : "neutral"}>{flow.status}</Badge></div><div className="statusGrid"><Metric label="Nodes" value={flow.nodeCount} /><Metric label="Active" value={flow.activeSessions} /><Metric label="Completed" value={flow.completedSessions} /><Metric label="Rate" value={`${flow.completionRate || 0}%`} /></div><div className="chipRow">{flow.triggerKeywords.map((keyword) => <span key={keyword}>{keyword}</span>)}{!flow.triggerKeywords.length && <span>{flow.triggerMode}</span>}</div><div className="flowActions"><button className="secondaryAction" type="button" onClick={() => loadFlow(flow)}>Edit</button><button className="secondaryAction" type="button" onClick={() => updateStatus(flow, flow.status === "active" ? "paused" : "active")}>{flow.status === "active" ? "Pause" : "Activate"}</button><button className="secondaryAction dangerSoft" type="button" onClick={() => archive(flow)}><Trash2 size={16} /> Archive</button></div></article>)}
      {!flows.length && <Panel title="No automation flows"><EmptyState text="Create and activate a flow to automate replies from incoming WhatsApp messages." /></Panel>}
    </div>
  </div>;
}
function Campaigns({ state, approvedTemplates, marketableContacts, mutate, setActiveView, campaignRetarget, setCampaignRetarget }) {
  const phones = (state.whatsappOperations?.phoneNumbers || []).filter((phone) => state.whatsappOperations?.accounts?.some((account) => account.id === phone.accountId && account.status === "connected"));
  const [phoneNumberId, setPhoneNumberId] = useState(phones.find((phone) => phone.isDefault)?.phoneNumberId || phones[0]?.phoneNumberId || "");
  const selectedPhone = phones.find((phone) => phone.phoneNumberId === phoneNumberId);
  const selectedAccount = state.whatsappOperations?.accounts?.find((account) => account.id === selectedPhone?.accountId);
  const availableTemplates = approvedTemplates.filter((item) => item.wabaId === selectedAccount?.wabaId || (!item.wabaId && selectedAccount?.wabaId === state.setup.wabaId));
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
  const marketingMessagesReady = selectedAccount?.marketingMessagesStatus === 'ONBOARDED';
  const templateMatchesSender = Boolean(template && selectedAccount && (template.wabaId === selectedAccount.wabaId || (!template.wabaId && selectedAccount.wabaId === state.setup.wabaId)));
  const segment = selectedSegment || segments.find((item) => item.id === segmentId);
  const editableVariables = (template?.variables || []).filter((variable) => variable !== "name");
  const preview = template ? renderPreview(template.body, marketableContacts[0], variables) : "Select an approved template first.";
  const toggleContact = (contactId) => setSelectedContactIds((current) => current.includes(contactId) ? current.filter((id) => id !== contactId) : [...current, contactId]);
  const submit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const created = await postJson("/api/campaigns", { name: form.get("name"), phoneNumberId, templateId, deliveryMethod, parameters: templateParameters, automationFlowId, segmentId, variables, contactIds: selectedContactIds, scheduledAt: form.get("scheduledAt") ? new Date(form.get("scheduledAt")).toISOString() : "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, frequencyHours: form.get('frequencyHours'), recurringIntervalDays: form.get('recurringIntervalDays') || 0, requireApproval: form.get('requireApproval')==='on', dynamicAudience: Boolean(segmentId), retargetSourceCampaignId: campaignRetarget?.sourceCampaignId || "" });
      await mutate(postJson("/api/campaigns/process", { limit: 25 }), created.approvalStatus==='pending' ? 'Campaign awaiting owner review' : "Campaign queued");
      setCampaignRetarget?.(null);
      setActiveView("results");
    } catch (error) { mutate(Promise.reject(error)); }
  };
  const targetCount = segment ? segment.contactCount : selectedContactIds.length;
  return <><div className="campaignLayout"><Panel title="Campaign" subtitle="Send an approved template to contacts or a saved segment"><form className="formGrid" onSubmit={submit}><Input name="name" label="Campaign name" required /><label>Sending number<select value={phoneNumberId} onChange={(event) => { setPhoneNumberId(event.target.value); setTemplateId(""); setSelectedTemplate(null); setDeliveryMethod("cloud_api"); }} required><option value="">Select a number</option>{phones.map((phone) => <option key={phone.phoneNumberId} value={phone.phoneNumberId}>{phone.displayPhoneNumber || phone.verifiedName || phone.phoneNumberId}</option>)}</select></label><label>Approved template<ApprovedTemplatePicker api={api} initialTemplates={approvedTemplates.filter((item) => item.wabaId === selectedAccount?.wabaId || (!item.wabaId && selectedAccount?.wabaId === state.setup.wabaId))} wabaId={selectedAccount?.wabaId || ""} value={templateId} onChange={value => { setTemplateId(value); setVariables({}); setDeliveryMethod('cloud_api'); }} onTemplate={setSelectedTemplate} /></label><label>Delivery API<select value={deliveryMethod} onChange={(event) => setDeliveryMethod(event.target.value)}><option value="cloud_api">Cloud API</option>{template?.category === "MARKETING" && <option value="marketing_messages_api" disabled={!marketingMessagesReady}>Marketing Messages API</option>}</select>{template?.category === "MARKETING" && <small>Meta status: {selectedAccount?.marketingMessagesStatus || "UNKNOWN"}</small>}</label><label>Saved segment<SearchableOptionPicker api={api} endpoint="/api/segments?active=1" itemsKey="segments" initialOptions={segments} value={segmentId} onChange={(value, item) => { setSegmentId(value); setSelectedSegment(item); if (value) setSelectedContactIds([]); }} label="Saved segment" placeholder="Find a saved segment" noneLabel="Select contacts manually" formatOption={item => item.name + " (" + item.contactCount + ")"} /></label><label>Schedule<input name="scheduledAt" type="datetime-local" /><small>Schedule up to {state.operationsPolicy?.campaignMaxScheduleDays ?? 60} days ahead (deployment policy).</small></label><label>Marketing interval (hours)<input name="frequencyHours" type="number" min="0" max="8760" step="1" defaultValue="0" required /></label><label>Recurring broadcast (days)<input name="recurringIntervalDays" type="number" min="0" max="365" step="1" defaultValue="0" title="After a campaign completes, spawn the next one after this many days (0 = off)" /></label><label className="checkboxLabel"><input name="requireApproval" type="checkbox" />Require owner approval</label><label>Reply automation<SearchableOptionPicker api={api} endpoint="/api/automation/options" itemsKey="flows" initialOptions={activeFlows} value={automationFlowId} onChange={setAutomationFlowId} label="Reply automation" placeholder="Find an active flow" noneLabel="No follow-up flow" formatOption={item => item.name} /></label>{editableVariables.map((variable) => <label key={variable}>{variable}<input value={variables[variable] || ""} onChange={(event) => setVariables((current) => ({ ...current, [variable]: event.target.value }))} placeholder={`Value for {{${variable}}}`} /></label>)}{template && !templateMatchesSender && <small className="errorLine">This template belongs to another WhatsApp account. Select a matching number or template.</small>}<TemplateParameterFields template={template} value={templateParameters} onChange={setTemplateParameters} /><div className="recipientHeader"><label className="searchBox recipientSearch"><Search size={17} /><input value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} placeholder="Search eligible contacts" /></label><span>{segment ? `${segment.contactCount} from segment` : `${selectedContactIds.length} selected`}</span></div><div className="recipientBox">{filteredRecipients.map((contact) => <label key={contact.id}><span>{contact.name}<small>{contact.phone}</small></span><input checked={selectedContactIds.includes(contact.id)} onChange={() => toggleContact(contact.id)} type="checkbox" /></label>)}{!marketableContacts.length && <EmptyState text="No eligible contacts" />}</div><button className="primaryAction" type="submit" disabled={!templateMatchesSender || (!segmentId && !selectedContactIds.length)}><Clock3 size={18} /> Queue campaign{targetCount ? ` (${targetCount})` : ""}</button></form></Panel><Panel title="WhatsApp preview" subtitle={template ? `${template.name} | ${template.language}` : "No approved template selected"}><div className="phonePreview"><div className="waBubble">{template?.headerText && <strong>{template.headerText}</strong>}<p>{preview}</p>{template?.footerText && <small>{template.footerText}</small>}{template?.buttons?.length > 0 && <div className="waQuickReplies">{template.buttons.map((button) => <span key={button.text}>{button.text}</span>)}</div>}</div></div></Panel></div><CampaignDripManager api={api} postJson={postJson} role={state.account.role} businessId={state.account.business.id} segments={segments} approvedTemplates={approvedTemplates} /></>;
}
function WhatsAppReferralReport() {
  const [days, setDays] = useState(30);
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    setReport(null);
    api(`/api/whatsapp/referrals?days=${days}`).then((result) => {
      if (active) setReport(result);
    }).catch((cause) => {
      if (active) setError(cause.message);
    });
    return () => { active = false; };
  }, [days, refresh]);
  return <Panel title="WhatsApp entry sources" subtitle="Conversations that began from a WhatsApp ad or post">
    <div className="assetToolbar whatsappReferralToolbar">
      <label>Period<select value={days} onChange={(event) => setDays(Number(event.target.value))}>
        <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
      </select></label>
      <button className="secondaryAction" type="button" onClick={() => setRefresh((value) => value + 1)}><RefreshCcw size={16} /> Refresh</button>
    </div>
    {error && <p className="errorLine" role="alert">{error}</p>}
    {report && <DataTable headers={["Source", "Meta ID", "Conversations", "Latest referral"]}>
      {report.sources.map((source) => <tr key={`${source.sourceType}-${source.sourceId}`}>
        <td>{source.sourceType === "AD" ? "WhatsApp ad" : "WhatsApp post"}</td>
        <td>{source.sourceId}</td>
        <td><strong>{source.conversations}</strong></td>
        <td>{formatTime(source.lastReferralAt)}</td>
      </tr>)}
    </DataTable>}
    {report && !report.sources.length && <EmptyState text="No WhatsApp ad or post referrals in this period" />}
  </Panel>;
}
function Results({ state, mutate, setActiveView, setCampaignRetarget }) {
  const processQueue = () => mutate(postJson("/api/campaigns/process", { limit: 25 }), "Queue processed");
  const canManage = isWorkspaceManager(state.account.role);
  const segmentsEnabled = state.featureFlags?.segments !== false;
  const lifecycle = (campaign, action) => mutate(postJson(`/api/campaigns/${campaign.id}`, { action }, "PATCH"), `Campaign ${action}d`);
  const control = async (campaign, action, values) => { await postJson(`/api/campaigns/${campaign.id}`, { action, ...values }, 'PATCH'); await mutate(Promise.resolve({ ok: true }), 'Campaign updated'); };
  const launchRetargetCampaign = async (campaign, presetId) => {
    const seg = await postJson(`/api/campaigns/${campaign.id}/retarget`, { presetId });
    await mutate(Promise.resolve({ ok: true }), 'Retarget audience saved');
    setCampaignRetarget?.({ segmentId: seg.segmentId, sourceCampaignId: campaign.id });
    setActiveView('campaigns');
  };
  return (
    <div className="screenGrid">
      {!canManage && (
        <section className="actionBand">
          <div>
            <strong>Campaign delivery results</strong>
            <span>Read-only delivery stats. Owners and managers configure campaigns and production operations.</span>
          </div>
        </section>
      )}
      {canManage && <WorkspaceResultsManagerShell api={api} postJson={postJson} />}
      {canManage && <WhatsAppReferralReport />}
      <section className="actionBand">
        <div><strong>Campaign operations</strong><span>Delivery status updates arrive from Meta webhooks.</span></div>
        {canManage && <button className="secondaryAction" type="button" onClick={processQueue}><RefreshCcw size={18} /> Process due jobs</button>}
      </section>
      {state.campaigns.map((campaign) => (
        <Panel key={campaign.id} title={campaign.name} subtitle={campaign.scheduledAt ? `Scheduled ${formatTime(campaign.scheduledAt)} | ${campaign.timezone}` : formatTime(campaign.createdAt)}>
          <div className="resultHeader campaignResultActions">
            <Badge kind={campaign.status === "failed" || campaign.status === "cancelled" ? "bad" : ["scheduled", "processing", "paused", "queued", "draft", "pending_approval"].includes(campaign.status) ? "warn" : "good"}>{campaign.status}</Badge>
            <Badge kind="neutral">{campaign.deliveryMethod === "marketing_messages_api" ? "Marketing Messages API" : "Cloud API"}</Badge>
            <Badge kind="neutral">{campaignSourceLabel(campaign.sourceKind)}</Badge>
            {campaign.dynamicAudience && <Badge kind="neutral">Dynamic audience</Badge>}
            {campaign.recurringIntervalDays > 0 && <Badge kind="neutral">Repeats every {campaign.recurringIntervalDays}d</Badge>}
            {canManage && ["queued", "scheduled", "processing"].includes(campaign.status) && <button className="secondaryAction compactAction" onClick={() => lifecycle(campaign, "pause")}><Pause size={15} /> Pause</button>}
            {canManage && campaign.status === "paused" && <button className="secondaryAction compactAction" onClick={() => lifecycle(campaign, "resume")}><Play size={15} /> Resume</button>}
            {canManage && ["queued", "scheduled", "processing", "paused"].includes(campaign.status) && <button className="secondaryAction compactAction dangerSoft" onClick={() => lifecycle(campaign, "cancel")}><X size={15} /> Cancel</button>}
          </div>
          <CampaignControls campaign={campaign} role={state.account.role} submit={control} />
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
            {campaign.recipients.map((recipient) => {
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

function TemplateReplyForm({ approvedTemplates, activeContact, mutate }) {
  const [templateId, setTemplateId] = useState(approvedTemplates[0]?.id || "");
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [parameters, setParameters] = useState({});
  useEffect(() => { if (!templateId && approvedTemplates[0]?.id) setTemplateId(approvedTemplates[0].id); }, [approvedTemplates, templateId]);
  const template = selectedTemplate?.id === templateId ? selectedTemplate : approvedTemplates.find((item) => item.id === templateId);
  const flowButtons = template?.componentSchema?.components?.find((component) => String(component.type).toUpperCase() === 'BUTTONS')?.buttons || template?.componentSchema?.buttons || template?.buttons || [];
  const flowTemplate = flowButtons.some((button) => String(button.type).toUpperCase() === 'FLOW');
  const replyVariables = (template?.variables || []).filter((variable) => variable !== "name");
  const submit = async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const variables = Object.fromEntries(replyVariables.map((variable) => [variable, form.get(variable)])); const {flowInvite, ...sendParameters} = parameters; const path = flowTemplate ? '/api/whatsapp/flow-templates' : '/api/messages/template-reply'; const payload = {contactId: activeContact.id, templateId, variables, parameters: flowTemplate ? {...sendParameters, flowInvite: flowInvite || {requestId: crypto.randomUUID(), expiresHours: 24}} : sendParameters}; if(flowTemplate)payload.action='send'; const succeeded = await mutate(postJson(path, payload), 'Template sent'); if(flowTemplate && succeeded)setParameters({...sendParameters, flowInvite: {requestId: crypto.randomUUID(), expiresHours: flowInvite?.expiresHours || 24}}); };
  return <form className="composer templateLine" onSubmit={submit}><ApprovedTemplatePicker api={api} initialTemplates={approvedTemplates} value={templateId} onChange={value => { setTemplateId(value); setParameters({}); }} onTemplate={setSelectedTemplate} />{replyVariables.map((variable) => <input key={variable} name={variable} placeholder={`{{${variable}}}`} required />)}<TemplateParameterFields template={template} value={parameters} onChange={setParameters} /><button className="secondaryAction" disabled={!template}><Send size={17} /> Send template</button></form>;
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

function InboxView({ state, activeConversation, activeContact, approvedTemplates, openConversation, mutate, reloadInbox, inboxFilter: serverFilter = "", inboxQ: serverQ = "" }) {
  const teamMembers = state.teamMembers || [];
  const currentUserId = state.account?.user?.id || "";
  const [search, setSearch] = useState(serverQ);
  const [inboxFilter, setInboxFilter] = useState(serverFilter || "all");
  const [inboxSurface, setInboxSurface] = useState("direct");
  const [replyDrafts, setReplyDrafts] = useState({});
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState('');
  const [suggestionContext, setSuggestionContext] = useState(null);
  const [sendingConversationId, setSendingConversationId] = useState(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const suggestionRevision = useRef(0);
  const sendingReply = useRef(false);
  const activeSuggestionConversation = useRef(activeConversation?.id);
  activeSuggestionConversation.current = activeConversation?.id;
  const conversationId = activeConversation?.id;
  const replyDraft = replyDrafts[conversationId] || '';
  const latestMessageId = activeConversation?.messages.at(-1)?.id || null;
  const activeSuggestionMessage = useRef(latestMessageId);
  activeSuggestionMessage.current = latestMessageId;
  const activeSuggestion = suggestionContext?.conversationId === conversationId && suggestionContext?.messageId === latestMessageId && suggestionContext?.draft === replyDraft ? suggestionContext : null;
  const staleSuggestion = suggestionContext?.conversationId === conversationId && suggestionContext.messageId !== latestMessageId && suggestionContext.draft === replyDraft;
  useEffect(() => {
    if (!state.featureFlags?.ai_agent) { setAiAvailable(false); return; }
    let active = true;
    api('/api/ai-agent/availability').then(result => { if (active) setAiAvailable(result.enabled); }).catch(() => { if (active) setAiAvailable(false); });
    return () => { active = false; };
  }, [state.featureFlags?.ai_agent]);
  useEffect(() => { setSuggestionError(''); }, [activeConversation?.id]);
  const skipSearchReload = useRef(true);
  useEffect(() => { setSearch(serverQ); setInboxFilter(serverFilter || "all"); }, [serverFilter, serverQ]);
  useEffect(() => {
    if (!reloadInbox || skipSearchReload.current) { skipSearchReload.current = false; return undefined; }
    const handle = window.setTimeout(() => {
      reloadInbox({ inboxFilter, inboxQ: search.trim(), page: 1 });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [search, reloadInbox]);
  const filteredConversations = state.conversations;
  const assignedUser = teamMembers.find((member) => member.id === activeConversation?.assignedUserId);
  const workflowAction = (action, extra = {}) => { if (!activeConversation) return; mutate(postJson(`/api/conversations/${activeConversation.id}/workflow`, { action, ...extra }, "PATCH"), action === "note" ? "Note added" : "Conversation updated"); };
  const selectConversation = (conversation) => { suggestionRevision.current += 1; openConversation(conversation.id); if (conversation.unreadCount > 0) mutate(postJson(`/api/conversations/${conversation.id}/workflow`, { action: "mark_read" }, "PATCH")); };
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
    if (!conversationId || !activeContact || !body || sendingReply.current || staleSuggestion) return;
    const contactId = activeContact.id;
    const sentDraft = replyDraft;
    sendingReply.current = true;
    setSendingConversationId(conversationId);
    try {
      await mutate(postJson('/api/messages/reply', { contactId, body }).then(result => {
        setReplyDrafts(current => clearSentConversationDraft(current, conversationId, sentDraft));
        setSuggestionContext(current => current?.conversationId === conversationId && current.draft === sentDraft ? null : current);
        return result;
      }), 'Message sent');
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
  return <>
    {groupsEnabled && <div className="wa-inbox-modes" role="tablist" aria-label="Inbox surface">
      <button type="button" role="tab" aria-selected={inboxSurface === "direct"} className={inboxSurface === "direct" ? "active" : ""} onClick={() => setInboxSurface("direct")}>1:1 conversations</button>
      <button type="button" role="tab" aria-selected={inboxSurface === "groups"} className={inboxSurface === "groups" ? "active" : ""} onClick={() => setInboxSurface("groups")}>Groups</button>
    </div>}
    {inboxSurface === "groups" ? <WhatsAppGroups api={api} postJson={postJson} enabled={groupsEnabled} embedded /> : <><section className="inboxShell">
    <aside className="threadList"><div className="threadTools"><label className="searchBox"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or phone" /></label><select value={inboxFilter} onChange={(event) => { const value = event.target.value; setInboxFilter(value); reloadInbox?.({ inboxFilter: value, inboxQ: search.trim(), page: 1 }); }}><option value="all">All conversations</option><option value="requesting">Awaiting agent reply</option><option value="active">Active (open)</option><option value="intervened">Human intervened</option><option value="unread">Unread</option><option value="mine">Assigned to me</option><option value="unassigned">Unassigned</option><option value="human">Human takeover</option><option value="replyable">Reply window open</option><option value="closed">Closed</option></select></div>{filteredConversations.map((conversation) => { const contact = state.contacts.find((item) => item.id === conversation.contactId) || {}; const latest = conversation.messages.at(-1); return <button key={conversation.id} className={conversation.id === activeConversation?.id ? "active" : ""} onClick={() => selectConversation(conversation)}><span className="threadTitle"><strong>{contact.name || contact.phone}</strong>{conversation.unreadCount > 0 && <b>{conversation.unreadCount}</b>}</span><span>{latest?.body || "No messages"}</span><em>{formatTime(conversation.updatedAt)}</em><small>{conversation.status === "closed" ? "Closed" : conversation.automationPaused ? "Human takeover" : conversation.assignedUserId ? "Assigned" : "Unassigned"}</small></button>; })}{!filteredConversations.length && <EmptyState text="No conversations match this view" />}</aside>
    <div className="threadPane">{activeConversation && activeContact ? <>
      <header><div><strong>{activeContact.name}</strong><small>{activeContact.phone} | {assignedUser ? `Assigned to ${assignedUser.name || assignedUser.email}` : "Unassigned"}</small></div><Badge kind={activeConversation.status === "closed" ? "neutral" : activeConversation.automationPaused ? "warn" : activeConversation.canReply ? "good" : "neutral"}>{activeConversation.status === "closed" ? "Closed" : activeConversation.automationPaused ? "Human" : activeConversation.canReply ? "24h open" : "Template only"}</Badge></header>
      <div className="inboxControls"><select value={activeConversation.assignedUserId || ""} onChange={(event) => workflowAction("assign", { assignedUserId: event.target.value })}><option value="">Unassigned</option>{teamMembers.map((member) => <option key={member.id} value={member.id}>{member.name || member.email}</option>)}</select><button className="secondaryAction" type="button" onClick={() => workflowAction("takeover", { assignedUserId: activeConversation.assignedUserId || currentUserId })}>Take over</button><button className="secondaryAction" type="button" onClick={() => workflowAction("resume")} disabled={!activeConversation.automationPaused}>Resume automation</button><button className="secondaryAction" type="button" onClick={() => workflowAction(activeConversation.status === "closed" ? "reopen" : "close")}>{activeConversation.status === "closed" ? <Play size={16} /> : <CheckCheck size={16} />}{activeConversation.status === "closed" ? "Reopen" : "Close"}</button></div>
      <div className="messages">{activeConversation.messages.map((message) => <div key={message.id} className={`bubble ${message.direction}`}><MessageContent message={message} /><small>{formatTime(message.at)} | {message.status}</small></div>)}</div>
      {activeConversation.status !== "closed" && activeConversation.canReply && <div className="aiReplyComposer">
        <form className="composer" onSubmit={reply}><textarea name="body" value={replyDraft} onChange={event => editReplyDraft(event.target.value)} placeholder="Write a WhatsApp reply" required /><button className="primaryAction" disabled={sendingConversationId !== null || staleSuggestion}><Send size={18} /> {sendingConversationId === conversationId ? "Sending" : "Send"}</button></form>
        {staleSuggestion && <small className="errorLine" role="alert">A new message arrived. Review and edit this suggestion before sending.</small>}
        {aiAvailable && <button className="secondaryAction" type="button" onClick={suggestReply} disabled={suggesting}><Bot size={16} /> {suggesting ? "Preparing suggestion" : "Suggest reply"}</button>}
        {suggestionError && <small className="errorLine" role="alert">{suggestionError}</small>}
        {activeSuggestion?.sources?.length > 0 && <small>Sources: {activeSuggestion.sources.map(item => item.title).join(", ")}</small>}
      </div>}
      {activeConversation.status !== "closed" && !activeConversation.canReply && <TemplateReplyForm approvedTemplates={approvedTemplates} activeContact={activeContact} mutate={mutate} />}
      <aside className="conversationNotes"><header><div><StickyNote size={17} /><strong>Internal notes</strong></div><span>{activeConversation.notes?.length || 0}</span></header><div className="noteList">{(activeConversation.notes || []).map((item) => <article key={item.id}><p>{item.body}</p><small>{item.author} | {formatTime(item.createdAt)}</small></article>)}{!activeConversation.notes?.length && <span>No internal notes yet</span>}</div><form onSubmit={note}><input name="note" placeholder="Add a note for your team" required /><button className="iconButton" title="Add note"><Plus size={17} /></button></form></aside>
    </> : <EmptyState text="No conversations" />}</div>
    <InboxContact360 contactId={activeContact?.id || null} api={api} />
  </section>{activeConversation?.status !== "closed" && activeConversation?.canReply && activeContact && <InteractiveReplyForm activeContact={activeContact} mutate={mutate} />}</>}</>;
}
function Team({ state, mutate }) {
  return <><TeamMembers state={state} mutate={mutate}/>{['Owner','Manager'].includes(state.account?.role)&&<SupportPolicy endpoint="/api/team/support-policy" canEdit={state.account.role==='Owner'} api={api} postJson={postJson}/>} {state.featureFlags?.ai_agent && ['Owner','Manager'].includes(state.account?.role) && <AiSupportSettings api={api} postJson={postJson} uploadForm={uploadForm} role={state.account.role} />}</>;
}

function TeamMembers({ state, mutate }) {
  const members = state.teamMembers || [];
  const canManage = ["Owner", "Manager"].includes(state.account?.role);
  const [invitations, setInvitations] = useState([]);
  const [inviteUrl, setInviteUrl] = useState("");
  useEffect(() => { if (canManage) api("/api/team/invitations").then((result) => setInvitations(result.invitations || [])).catch(() => setInvitations([])); }, [canManage]);
  const invite = async (event) => { event.preventDefault(); const form = event.currentTarget; try { const result = await postJson("/api/team/invitations", Object.fromEntries(new FormData(form))); setInvitations(result.invitations || []); setInviteUrl(result.inviteUrl || ""); form.reset(); } catch (error) { mutate(Promise.reject(error)); } };
  const copyInvite = async () => { if (inviteUrl) await navigator.clipboard.writeText(inviteUrl); };
  const updateMember = (member, role) => mutate(postJson(`/api/team/members/${member.id}`, { role }, "PATCH"), "Team role updated");
  const updateAvailability = (availability) => mutate(postJson(`/api/team/members/${state.account.user.id}`, { availability }, "PATCH"), "Availability updated");
  const removeMember = (member) => mutate(api(`/api/team/members/${member.id}`, { method: "DELETE" }), "Team member removed");
  return <div className="screenGrid"><section className="teamStatus"><div><p className="kicker">Agent availability</p><h2>{state.account.user.name}</h2><span>Set your current inbox availability.</span></div><select value={members.find((member) => member.id === state.account.user.id)?.availability || "offline"} onChange={(event) => updateAvailability(event.target.value)}><option value="available">Available</option><option value="away">Away</option><option value="offline">Offline</option></select></section>{canManage && <Panel title="Invite team member" subtitle="Invite links expire automatically and can be revoked"><form className="teamInviteForm" onSubmit={invite}><Input name="email" label="Work email" type="email" required /><label>Company role<select name="role"><option value="Agent">Agent</option><option value="Manager">Manager</option></select></label><button className="primaryAction" type="submit"><UserPlus size={18} /> Create invite</button></form>{inviteUrl && <div className="inviteResult"><div><strong>Invitation link created</strong><span>{inviteUrl}</span></div><button className="secondaryAction" type="button" onClick={copyInvite}><Copy size={17} /> Copy</button></div>}<div className="pendingInvites">{invitations.map((item) => <article key={item.id}><div><strong>{item.email}</strong><span>{item.role} | expires {formatTime(item.expiresAt)}</span></div><button className="iconButton dangerSoft" title="Revoke invite" onClick={async () => { const result = await api(`/api/team/invitations/${item.id}`, { method: "DELETE" }); setInvitations(result.invitations || []); }}><Trash2 size={16} /></button></article>)}</div></Panel>}<Panel title="Company team" subtitle={`${members.length} workspace member${members.length === 1 ? "" : "s"}`}><DataTable headers={["Member", "Role", "Availability", "Actions"]}>{members.map((member) => <tr key={member.id}><td><strong>{member.name}</strong><small>{member.email}</small></td><td>{canManage && member.role !== "Owner" ? <select value={member.role} onChange={(event) => updateMember(member, event.target.value)}><option value="Agent">Agent</option><option value="Manager">Manager</option></select> : <Badge kind={member.role === "Owner" ? "good" : "neutral"}>{member.role}</Badge>}</td><td><Badge kind={member.availability === "available" ? "good" : member.availability === "away" ? "warn" : "neutral"}>{member.availability}</Badge></td><td className="rowActions">{canManage && member.role !== "Owner" && member.id !== state.account.user.id && <button className="dangerText" onClick={() => removeMember(member)}><Trash2 size={15} /> Remove</button>}</td></tr>)}</DataTable></Panel></div>;
}

function Unsubscribes({ state, suppressedContacts, mutate }) {
  const [restoreContact, setRestoreContact] = useState(null);
  const [consentSettings, setConsentSettings] = useState(null);
  const [customFields, setCustomFields] = useState([]);
  const canManage = isWorkspaceManager(state.account.role);
  const isOwner = state.account.role === "Owner";
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

function Panel({ title, subtitle, children }) { return <section className="panel"><div className="panelHead"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>{children}</section>; }
function Metric({ label, value }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
function Badge({ kind = "neutral", children }) { return <span className={`badge ${kind}`}>{children}</span>; }
function Input({ label, ...props }) { return <label>{label}<input {...props} /></label>; }
function PasswordField({ label, visible, onToggle, hint, ...props }) {
  const inputId = props.id || props.name;
  return <div className='fieldGroup'><label htmlFor={inputId}>{label}</label><span className="passwordWrap"><input {...props} id={inputId} type={visible ? "text" : "password"} minLength={PASSWORD_MIN_LENGTH} /><button type="button" onClick={onToggle} aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>{hint ? <small className="fieldHint">{hint}</small> : null}</div>;
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
function ResultMeters({ stats }) { return <div className="meterGrid"><Metric label="Total" value={stats.total} /><Metric label="Queued" value={stats.queued} /><Metric label="Sent" value={stats.sent} /><Metric label="Delivered" value={stats.delivered} /><Metric label="Read" value={stats.read} /><Metric label="Replies" value={stats.replied || 0} /><Metric label="Failed" value={stats.failed} /></div>; }
