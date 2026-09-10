"use client";

import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BadgeCheck, Ban, BarChart3, Bot, ChevronRight, CircleAlert, Download, FileText, Image, Inbox, LayoutDashboard,
  Eye, EyeOff, Loader2, LogOut, Menu, MessageSquareText, PhoneCall, Plus, RefreshCcw, Send, Settings2,
  ShieldCheck, Sparkles, Trash2, Upload, UsersRound, X, Search, Clock3, Activity, CheckCheck, Copy, Link2, Pause, Play, Pencil, Save, StickyNote, Unplug, UserPlus, WalletCards,
  Smartphone, Workflow, RadioTower, Building2, KeyRound
} from "lucide-react";

const navItems = [
  { id: "overview", label: "Command", icon: LayoutDashboard },
  { id: "setup", label: "Meta Setup", icon: Settings2 },
  { id: "contacts", label: "Audience", icon: UsersRound },
  { id: "team", label: "Team", icon: UserPlus },
  { id: "billing", label: "Billing", icon: WalletCards },
  { id: "templates", label: "Templates", icon: MessageSquareText },
  { id: "automation", label: "Automation", icon: Bot },
  { id: "campaigns", label: "Campaigns", icon: Send },
  { id: "results", label: "Results", icon: BarChart3 },
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "unsubscribes", label: "Suppression", icon: Ban }
];

const workspaceRoutes = {
  overview: "/app/dashboard",
  setup: "/app/settings/whatsapp",
  contacts: "/app/contacts",
  team: "/app/team",
  billing: "/app/settings/billing",
  templates: "/app/templates",
  automation: "/app/automations",
  campaigns: "/app/campaigns",
  results: "/app/analytics",
  inbox: "/app/inbox",
  unsubscribes: "/app/suppression"
};

function workspaceLocation(pathname) {
  if (pathname?.startsWith("/app/inbox/")) {
    return { view: "inbox", conversationId: decodeURIComponent(pathname.slice("/app/inbox/".length)) || null };
  }
  const entry = Object.entries(workspaceRoutes).find(([, route]) => route === pathname);
  return { view: entry?.[0] || "overview", conversationId: null };
}

const api = async (path, options = {}) => {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Action failed");
    error.code = payload.code;
    throw error;
  }
  return payload;
};

const postJson = (path, body, method = "POST") => api(path, { method, body: JSON.stringify(body) });
const formatTime = (iso) => iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never";
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

function stateUrl(view, { page = 1, messagePage = 1, conversationId = "" } = {}) {
  const params = new URLSearchParams({ page: String(page), messagePage: String(messagePage) });
  if (conversationId) params.set("conversationId", conversationId);
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

export default function WorkspaceApp({ initialView = "overview", initialConversationId = null, authMode = "", children = null }) {
  const router = useRouter();
  const pathname = usePathname();
  const initialLocation = authMode ? { view: initialView, conversationId: initialConversationId } : workspaceLocation(pathname);
  const [state, setState] = useState(null);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState("");
  const [activeView, setActiveView] = useState(initialLocation.view);
  const [activeConversationId, setActiveConversationId] = useState(initialLocation.conversationId);
  const [notice, setNotice] = useState("");
  const [platform, setPlatform] = useState(fallbackPlatform);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [pages, setPages] = useState({});

  const approvedTemplates = useMemo(() => state?.templates.filter((template) => template.status === "Approved") || [], [state]);
  const marketableContacts = useMemo(() => state?.contacts.filter((contact) => contact.marketingPermission && !contact.unsubscribed) || [], [state]);
  const suppressedContacts = useMemo(() => state?.contacts.filter((contact) => contact.unsubscribed || !contact.marketingPermission) || [], [state]);

  useEffect(() => { bootstrap(); }, []);
  useEffect(() => {
    if (authMode) return;
    const location = workspaceLocation(pathname);
    setActiveView(location.view);
    setActiveConversationId(location.conversationId);
  }, [authMode, pathname]);
  useEffect(() => {
    if (!account || authMode) return;
    const location = workspaceLocation(pathname);
    if (location.view === "inbox") setPages((current) => ({ ...current, messages: 1 }));
    loadScope(location, true, location.view === "inbox" ? { messagePage: 1 } : {});
  }, [account, authMode, pathname]);
  useEffect(() => {
    if (loading || configError) return;
    if (authMode && account) router.replace("/app/dashboard");
    if (!authMode && !account) router.replace("/login");
  }, [account, authMode, configError, loading, router]);
  useEffect(() => {
    if (!account) return undefined;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try { await loadScope(workspaceLocation(window.location.pathname), false); }
      catch (error) { if (error.code === "AUTH_REQUIRED") setAccount(null); }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [account, pages, pathname]);

  const notify = (message) => { if (!message) return; setNotice(message); setTimeout(() => setNotice(""), 2600); };

  const bootstrap = async () => {
    try {
      setLoading(true);
      const publicConfig = await api("/api/platform").catch(() => ({ platform: fallbackPlatform }));
      setPlatform({ ...fallbackPlatform, ...(publicConfig.platform || {}) });
      const me = await api("/api/me");
      setAccount(me);
      const location = authMode ? { view: "overview", conversationId: "" } : workspaceLocation(pathname);
      const nextState = await api(stateUrl(location.view, { conversationId: location.conversationId || "" }));
      setState(mergeWorkspaceState(null, nextState));
      setPlatform({ ...fallbackPlatform, ...(nextState.platform || publicConfig.platform || {}) });
      setConfigError("");
    } catch (error) {
      setState(null);
      setAccount(null);
      if (["DB_NOT_CONFIGURED", "AUTH_NOT_CONFIGURED"].includes(error.code)) setConfigError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const loadScope = async (location = workspaceLocation(pathname), updatePlatform = true, overrides = {}) => {
    const page = overrides.page || pages[location.view] || 1;
    const messagePage = overrides.messagePage || pages.messages || 1;
    const nextState = await api(stateUrl(location.view, { page, messagePage, conversationId: location.conversationId || "" }));
    setState((current) => mergeWorkspaceState(current, nextState));
    if (updatePlatform && nextState.platform) setPlatform((current) => ({ ...current, ...nextState.platform }));
    return nextState;
  };

  const refresh = async () => {
    try { await loadScope(); }
    catch (error) { notify(error.message); if (error.code === "AUTH_REQUIRED") setAccount(null); }
  };

  const mutate = async (promise, message) => {
    try { await promise; await loadScope(); notify(message); }
    catch (error) { notify(error.message); }
  };

  const changePage = async (key, page) => {
    const nextPage = Math.max(1, page);
    const location = workspaceLocation(pathname);
    const overrides = key === "messages" ? { messagePage: nextPage } : { page: nextPage };
    setPages((current) => ({ ...current, [key]: nextPage, ...(key === "messages" ? {} : { [location.view]: nextPage }) }));
    try { await loadScope(location, false, overrides); }
    catch (error) { notify(error.message); }
  };

  const logout = async () => {
    await postJson("/api/auth/logout", {});
    setAccount(null);
    setState(null);
    router.replace("/login");
  };

  const navigate = (view) => {
    const route = workspaceRoutes[view];
    if (!route) return;
    setActiveView(view);
    setMobileNavOpen(false);
    router.push(route);
  };

  const openConversation = (conversationId) => {
    setActiveConversationId(conversationId);
    setPages((current) => ({ ...current, messages: 1 }));
    setMobileNavOpen(false);
    router.push(`/app/inbox/${encodeURIComponent(conversationId)}`);
  };

  if (loading) return <main className="loading"><Sparkles size={32} /><p>Loading workspace</p></main>;
  if (configError) return <SystemSetup message={configError} platform={platform} />;
  if (!account && authMode) return <AuthScreen onDone={bootstrap} platform={platform} initialMode={authMode} onModeChange={(mode) => router.push(mode === "signup" ? "/signup" : "/login")} />;
  if (!account) return <main className="loading"><Loader2 className="spin" size={30} /><p>Opening sign in</p></main>;
  if (authMode) return <main className="loading"><Loader2 className="spin" size={30} /><p>Opening workspace</p></main>;
  if (!state) return <main className="loading"><Sparkles size={32} /><p>Preparing workspace</p></main>;

  const activeConversation = activeConversationId
    ? state.conversations.find((conversation) => conversation.id === activeConversationId) || null
    : state.conversations[0];
  const activeContact = activeConversation ? state.contacts.find((contact) => contact.id === activeConversation.contactId) : null;
  const latestCampaign = state.campaigns[0];
  const platformConfig = { ...platform, ...(state.platform || {}) };
  const screenProps = { state, mutate, changePage, setActiveView: navigate, approvedTemplates, marketableContacts, suppressedContacts, latestCampaign, activeConversation, activeContact, openConversation, platform: platformConfig };

  return (
    <main className="shell">
      <aside className={`sideRail ${mobileNavOpen ? "open" : ""}`}>
        <div className="brandBlock"><div className="brandIcon"><PhoneCall size={22} /></div><div><strong>{platformConfig.brand_name}</strong><span>{account.business.name}</span></div><button className="mobileCloseButton" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={20} /></button></div>
        <nav className="navList" aria-label="Product sections">
          {navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>; })}
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
        <Screens activeView={activeView} {...screenProps} />
        {children}
      </section>
    </main>
  );
}

function AuthScreen({ onDone, platform, initialMode = "signin", onModeChange }) {
  const [mode, setMode] = useState(initialMode);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const isSignup = mode === "signup";
  useEffect(() => { setMode(initialMode); }, [initialMode]);

  const switchMode = () => {
    if (pending) return;
    setError("");
    setShowPassword(false);
    setShowConfirm(false);
    const nextMode = isSignup ? "signin" : "signup";
    setMode(nextMode);
    onModeChange?.(nextMode);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const rawForm = Object.fromEntries(new FormData(event.currentTarget));
    const form = { ...rawForm, email: rawForm.workspaceEmail, password: rawForm.workspacePassword };

    if (isSignup && form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (String(form.password || "").length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    delete form.confirmPassword;
    delete form.workspaceEmail;
    delete form.workspacePassword;
    setPending(true);
    try {
      await postJson(isSignup ? "/api/auth/register" : "/api/auth/login", form);
      await onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return <main className="authShell"><section className="authPanel authPanelPro"><div className="brandBlock dark authBrand"><div className="brandIcon"><PhoneCall size={22} /></div><div><strong>{platform.brand_name}</strong><span>{platform.product_tagline}</span></div></div><div className="authHeader"><p className="kicker">Secure workspace</p><h1>{isSignup ? platform.signup_heading : platform.signin_heading}</h1><p>{isSignup ? platform.signup_copy : platform.signin_copy}</p></div><form className="formGrid authForm" onSubmit={submit}>{isSignup && <><Input name="name" label="Your name" autoComplete="name" required /><Input name="businessName" label="Business name" autoComplete="organization" required /></>}<Input name="workspaceEmail" label="Email" type="email" autoComplete="off" data-lpignore="true" data-form-type="other" required /><PasswordField name="workspacePassword" label="Password" visible={showPassword} onToggle={() => setShowPassword((value) => !value)} autoComplete="new-password" data-lpignore="true" data-form-type="other" required />{isSignup && <PasswordField name="confirmPassword" label="Confirm password" visible={showConfirm} onToggle={() => setShowConfirm((value) => !value)} autoComplete="new-password" required />}{error && <div className="formError" role="alert">{error}</div>}<button className="primaryAction authSubmit" type="submit" disabled={pending}>{pending ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />} <span>{pending ? "Please wait" : isSignup ? "Create account" : "Sign in"}</span></button></form><div className="authSwitch"><span>{isSignup ? "Already have a workspace?" : "New workspace?"}</span><button className="textButton" type="button" onClick={switchMode}>{isSignup ? "Sign in" : "Create account"}</button></div></section></main>;
}
function SystemSetup({ message, platform }) {
  return <main className="authShell"><section className="authPanel"><div className="brandBlock dark"><div className="brandIcon"><Settings2 size={22} /></div><div><strong>{platform.brand_name}</strong><span>Production database setup</span></div></div><h1>Connect PostgreSQL</h1><p className="setupCopy">{message}</p><div className="envBox"><code>DATABASE_URL</code><code>AUTH_SECRET</code><code>ENCRYPTION_KEY</code></div></section></main>;
}

function Screens({ activeView, ...props }) {
  const screens = { overview: <Overview {...props} />, setup: <Setup {...props} />, contacts: <Contacts {...props} />, team: <Team {...props} />, billing: <Billing {...props} />, templates: <Templates {...props} />, automation: <AutomationFlows {...props} />, campaigns: <Campaigns {...props} />, results: <Results {...props} />, inbox: <InboxView {...props} />, unsubscribes: <Unsubscribes {...props} /> };
  const pageKey = { contacts: "contacts", templates: "templates", campaigns: "campaigns", results: "results", inbox: "inbox", unsubscribes: "unsubscribes" }[activeView];
  return <>
    {screens[activeView]}
    {activeView === "inbox" && <Pagination label="Message history" meta={props.state.pagination?.messages} onChange={(page) => props.changePage("messages", page)} />}
    {pageKey && <Pagination label={activeView === "inbox" ? "Conversations" : "Records"} meta={props.state.pagination?.[pageKey]} onChange={(page) => props.changePage(pageKey, page)} />}
  </>;
}

function pageTitle(view) {
  return { overview: "Command center", setup: "Business connection", contacts: "Audience", team: "Team workspace", billing: "Subscription and billing", templates: "Template library", automation: "Automation flows", campaigns: "Campaign builder", results: "Campaign results", inbox: "Inbox", unsubscribes: "Suppression list" }[view];
}

function Billing({ state }) {
  const subscription = state.subscription || {};
  const plan = subscription.plan || {};
  const usage = subscription.usage || {};
  const limits = subscription.limits || {};
  const money = (cents) => new Intl.NumberFormat(undefined, { style: "currency", currency: plan.currency || "INR", maximumFractionDigits: 0 }).format((Number(cents) || 0) / 100);
  const usageValue = (key) => limits[key] == null ? `${usage[key] || 0} / Unlimited` : `${usage[key] || 0} / ${limits[key]}`;
  return <div className="screenGrid">
    <section className="heroPanel"><div><span className="softLabel">{subscription.status || "pending"}</span><h2>{plan.name || "Unassigned"}</h2><p>{plan.description || "Subscription details are managed by the platform owner."}</p></div><div className="heroMetrics"><Metric label="Monthly" value={money(plan.monthlyPriceCents)} /><Metric label="Yearly" value={money(plan.yearlyPriceCents)} /><Metric label="Period ends" value={subscription.periodEnd ? formatTime(subscription.periodEnd) : "Not set"} /></div></section>
    <Panel title="Current usage" subtitle="Live usage against the limits configured for this plan"><div className="meterGrid usageGrid"><Metric label="Contacts" value={usageValue("contacts")} /><Metric label="Campaigns" value={usageValue("campaigns")} /><Metric label="Messages" value={usageValue("messages")} /><Metric label="Users" value={usageValue("users")} /><Metric label="Automations" value={usageValue("automationFlows")} /><Metric label="Conversation limit" value={limits.whatsappConversations == null ? "Unlimited" : limits.whatsappConversations} /></div></Panel>
    <Panel title="Included features" subtitle={plan.name || "Current plan"}><div className="readinessList">{(plan.features || []).map((feature) => <div className="ready" key={feature}><span>{feature}</span><Badge kind="good">Included</Badge></div>)}{!(plan.features || []).length && <EmptyState text="No plan features have been configured" />}</div></Panel>
  </div>;
}

function Overview({ state, approvedTemplates, marketableContacts, latestCampaign, setActiveView, platform }) {
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
    <section className="actionBand"><button className="primaryAction" onClick={() => setActiveView("campaigns")}><Send size={18} /> {platform.primary_cta_label} <ChevronRight size={18} /></button><button className="secondaryAction" onClick={() => setActiveView("contacts")}><UsersRound size={18} /> Add audience</button><button className="secondaryAction" onClick={() => setActiveView("inbox")}><Inbox size={18} /> Open inbox</button></section>
    <div className="overviewGrid"><Panel title="Delivery pulse" subtitle="All WhatsApp campaign recipients"><div className="statusGrid"><Metric label="Delivered" value={delivered} /><Metric label="Read" value={read} /><Metric label="Failed" value={failed} /><Metric label="Open chats" value={openConversations} /></div></Panel><Panel title="Workspace readiness" subtitle="Complete these before scaling sends"><div className="readinessList">{setupItems.map((item) => <div key={item.label} className={item.ready ? "ready" : ""}><span>{item.label}</span><Badge kind={item.ready ? "good" : "warn"}>{item.ready ? "Ready" : "Action needed"}</Badge></div>)}</div></Panel></div>
    <Panel title="Subscription usage" subtitle={state.subscription?.plan?.name || "No plan assigned"}><div className="meterGrid usageGrid"><Metric label="Contacts" value={limits.contacts == null ? usage.contacts || 0 : (usage.contacts || 0) + " / " + limits.contacts} /><Metric label="Campaigns" value={limits.campaigns == null ? usage.campaigns || 0 : (usage.campaigns || 0) + " / " + limits.campaigns} /><Metric label="Messages" value={limits.messages == null ? usage.messages || 0 : (usage.messages || 0) + " / " + limits.messages} /><Metric label="Flows" value={limits.automationFlows == null ? usage.automationFlows || 0 : (usage.automationFlows || 0) + " / " + limits.automationFlows} /></div></Panel>
    <Panel title="Latest campaign" subtitle={currentCampaign ? formatTime(currentCampaign.createdAt) : "No campaigns"}>{currentCampaign ? <ResultMeters stats={currentCampaign.stats} /> : <EmptyState text="No campaign results yet" />}</Panel>
  </div>;
}

function Setup({ state, mutate }) {
  const signupData = useRef({});
  const [connecting, setConnecting] = useState(false);
  const [signupError, setSignupError] = useState("");
  const [section, setSection] = useState("connection");
  const operations = state.whatsappOperations || { accounts: [], phoneNumbers: [], nativeFlows: [], capabilities: [], analytics: [] };
  const activeAccount = operations.accounts.find((item) => item.isDefault) || operations.accounts[0];
  const activePhone = operations.phoneNumbers.find((item) => item.isDefault) || operations.phoneNumbers[0];
  useEffect(() => {
    const listener = (event) => {
      if (!/^https:\/\/([a-z0-9-]+\.)*facebook\.com$/i.test(event.origin)) return;
      let payload = event.data;
      if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { return; } }
      if (payload?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (payload.event === "FINISH") {
        signupData.current = payload.data || {};
        setSignupError("");
        return;
      }
      if (payload.event === "CANCEL" || payload.event === "ERROR") {
        const detail = payload.data?.error_message || payload.data?.message || payload.data?.current_step || "Meta did not complete the WhatsApp connection.";
        signupData.current = { error: String(detail) };
        setSignupError(String(detail));
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  const connectMeta = async () => {
    setConnecting(true);
    setSignupError("");
    signupData.current = {};
    try {
      const config = await api("/api/meta/embedded-signup/config");
      const FB = await loadFacebookSdk(config.appId, config.graphVersion);
      FB.login((response) => {
        const code = response?.authResponse?.code;
        if (!code) { setConnecting(false); mutate(Promise.reject(new Error(signupData.current.error || "Meta sign-up was cancelled or did not return authorization."))); return; }
        mutate(postJson("/api/meta/embedded-signup/complete", { code, wabaId: signupData.current.waba_id, phoneNumberId: signupData.current.phone_number_id }).finally(() => setConnecting(false)), "WhatsApp Business connected");
      }, { config_id: config.configId, auth_type: "rerequest", response_type: "code", override_default_response_type: true, extras: { setup: {} } });
    } catch (error) { setConnecting(false); mutate(Promise.reject(error)); }
  };
  const checkConnection = () => mutate(postJson("/api/meta/connection/check", {}), "Meta connection verified");
  const disconnect = () => mutate(postJson("/api/meta/connection/disconnect", {}), "WhatsApp Business disconnected");
  const runOperation = (body, message) => mutate(postJson("/api/whatsapp/operations", body), message);
  const submitManual = (event) => { event.preventDefault(); mutate(postJson("/api/setup", Object.fromEntries(new FormData(event.currentTarget)), "PUT"), "Manual setup saved"); };
  const metadata = state.setup.connectionMetadata || {};
  return <div className="screenGrid metaSetupScreen">
    <section className="metaConnectHero"><div><p className="kicker">Official Meta onboarding</p><h2>{state.setup.status === "Connected" ? "WhatsApp Business is connected" : "Connect your WhatsApp Business account"}</h2><span>Authorize your company-owned WABA and phone number through Meta Embedded Signup.</span></div><button className="primaryAction metaConnectButton" type="button" onClick={connectMeta} disabled={connecting || !state.meta.embeddedSignupAvailable}>{connecting ? <Loader2 className="spin" size={18} /> : <Link2 size={18} />}{connecting ? "Opening Meta" : state.setup.status === "Connected" ? "Reconnect with Meta" : "Connect with Meta"}</button></section>
    {!state.meta.embeddedSignupAvailable && <div className="formError">The platform owner must configure META_APP_ID, META_APP_SECRET and META_EMBEDDED_SIGNUP_CONFIG_ID on the server.</div>}
    {signupError && <div className="formError" role="alert">{signupError}</div>}
    <nav className="operationsTabs" aria-label="WhatsApp settings">
      {[
        ["connection", Activity, "Connection"], ["numbers", Smartphone, "Numbers"], ["profile", Building2, "Profile"],
        ["flows", Workflow, "WhatsApp Flows"], ["analytics", BarChart3, "Meta analytics"], ["capabilities", RadioTower, "Capabilities"]
      ].map(([id, Icon, label]) => <button key={id} type="button" className={section === id ? "active" : ""} onClick={() => setSection(id)}><Icon size={16} /><span>{label}</span></button>)}
    </nav>
    {section === "connection" && <>
      <div className="contentGrid twoColumns"><Panel title="Connection health" subtitle="Live values verified against this company workspace"><div className="connectionSummary"><div><span>Connection</span><Badge kind={state.setup.status === "Connected" ? "good" : "warn"}>{state.setup.status}</Badge></div><div><span>Onboarding</span><strong>{state.setup.onboardingMethod === "embedded_signup" ? "Embedded Signup" : "Manual"}</strong></div><div><span>Webhook subscription</span><Badge kind={state.setup.webhookSubscribed ? "good" : "warn"}>{state.setup.webhookSubscribed ? "Subscribed" : "Not verified"}</Badge></div><div><span>Business number</span><strong>{state.setup.whatsappNumber || "Not connected"}</strong></div><div><span>WABA ID</span><strong>{state.setup.wabaId || "Not connected"}</strong></div><div><span>Phone Number ID</span><strong>{state.setup.phoneNumberId || "Not connected"}</strong></div><div><span>Verified name</span><strong>{metadata.verifiedName || activePhone?.verifiedName || "Unavailable"}</strong></div><div><span>Quality rating</span><strong>{metadata.qualityRating || activePhone?.qualityRating || "Unavailable"}</strong></div><div><span>Token health</span><Badge kind={activeAccount?.token.status === "healthy" ? "good" : "warn"}>{activeAccount?.token.status || "Unknown"}</Badge></div><div><span>Token expiry</span><strong>{activeAccount?.token.expiresAt ? formatTime(activeAccount.token.expiresAt) : "Reconnect when Meta requests"}</strong></div></div><div className="connectionActions"><button className="secondaryAction" type="button" onClick={checkConnection} disabled={state.setup.status !== "Connected"}><Activity size={17} /> Verify</button><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "sync", accountId: activeAccount?.id }, "WhatsApp assets synchronized")} disabled={!activeAccount}><RefreshCcw size={17} /> Sync assets</button><button className="secondaryAction dangerSoft" type="button" onClick={disconnect} disabled={state.setup.status !== "Connected"}><Unplug size={17} /> Disconnect</button></div></Panel><Panel title="Webhook endpoint" subtitle="Subscribe this HTTPS callback to WhatsApp webhook fields"><div className="webhookCard"><code>{state.setup.webhookUrl || state.meta.webhookUrl || "Configure APP_URL on the server"}</code><div><span>Signature verification</span><Badge kind="good">Server-side</Badge></div><div><span>Incoming messages</span><Badge kind="good">Enabled</Badge></div><div><span>Delivery status</span><Badge kind="good">Enabled</Badge></div><div><span>Template updates</span><Badge kind="good">Enabled</Badge></div></div></Panel></div>
      <details className="manualSetup"><summary>Manual credentials fallback</summary><Panel title="Manual Meta credentials" subtitle="Embedded Signup is recommended for customer workspaces"><form className="formGrid" onSubmit={submitManual}><Input name="businessName" label="Business name" defaultValue={state.setup.businessName} /><Input name="whatsappNumber" label="WhatsApp number" defaultValue={state.setup.whatsappNumber} /><Input name="wabaId" label="WABA ID" defaultValue={state.setup.wabaId} /><Input name="phoneNumberId" label="Phone Number ID" defaultValue={state.setup.phoneNumberId} /><Input name="webhookUrl" label="Webhook URL" defaultValue={state.setup.webhookUrl} /><Input name="accessToken" label="Access token" defaultValue={state.setup.accessToken} placeholder="Paste token" /><button className="primaryAction" type="submit"><BadgeCheck size={18} /> Save manual setup</button></form></Panel></details>
    </>}
    {section === "numbers" && <Panel title="WhatsApp phone numbers" subtitle="Every number remains isolated to this company; the default number is used by campaigns and inbox replies">
      <div className="assetToolbar"><span>{operations.phoneNumbers.length} connected number{operations.phoneNumbers.length === 1 ? "" : "s"}</span><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "sync", accountId: activeAccount?.id }, "Phone numbers synchronized")} disabled={!activeAccount}><RefreshCcw size={17} /> Sync from Meta</button></div>
      <div className="phoneAssetGrid">{operations.phoneNumbers.map((phone) => <article className={`phoneAsset ${phone.isDefault ? "selected" : ""}`} key={phone.id}><header><div className="assetIcon"><Smartphone size={20} /></div><div><strong>{phone.verifiedName || phone.displayPhoneNumber}</strong><span>{phone.displayPhoneNumber || phone.phoneNumberId}</span></div><Badge kind={phone.qualityRating === "GREEN" ? "good" : phone.qualityRating === "RED" ? "bad" : "warn"}>{phone.qualityRating}</Badge></header><dl><div><dt>Status</dt><dd>{phone.status}</dd></div><div><dt>Messaging tier</dt><dd>{phone.messagingLimitTier}</dd></div><div><dt>Platform</dt><dd>{phone.platformType}</dd></div><div><dt>Registration</dt><dd>{phone.registrationState}</dd></div></dl><div className="assetActions"><button className="secondaryAction" type="button" disabled={phone.isDefault} onClick={() => runOperation({ action: "select_phone", phoneId: phone.id }, "Default WhatsApp number changed")}>{phone.isDefault ? <BadgeCheck size={16} /> : <CheckCheck size={16} />}{phone.isDefault ? "Default number" : "Use this number"}</button><form onSubmit={(event) => { event.preventDefault(); const pin = new FormData(event.currentTarget).get("pin"); runOperation({ action: "register_phone", phoneId: phone.id, pin }, "Phone number registered"); event.currentTarget.reset(); }}><input name="pin" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" placeholder="6-digit PIN" aria-label="Two-step verification PIN" required /><button className="secondaryAction" title="Register number"><KeyRound size={16} /> Register</button></form></div></article>)}</div>
      {activePhone && <details className="numberVerification"><summary>Verify or migrate the selected number</summary><div><form onSubmit={(event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); runOperation({ action: "request_code", phoneId: activePhone.id, ...values }, "Verification code requested"); }}><label>Delivery method<select name="method"><option value="SMS">SMS</option><option value="VOICE">Voice call</option></select></label><Input name="language" label="Language" defaultValue="en_US" /><button className="secondaryAction"><PhoneCall size={16} /> Request code</button></form><form onSubmit={(event) => { event.preventDefault(); const code = new FormData(event.currentTarget).get("code"); runOperation({ action: "verify_code", phoneId: activePhone.id, code }, "Phone number verified"); event.currentTarget.reset(); }}><Input name="code" label="Verification code" inputMode="numeric" required /><button className="secondaryAction"><BadgeCheck size={16} /> Verify code</button></form></div></details>}
      {!operations.phoneNumbers.length && <EmptyState text="Connect Meta, then sync phone numbers" />}
    </Panel>}
    {section === "profile" && <Panel title="WhatsApp business profile" subtitle={activePhone ? `Profile for ${activePhone.displayPhoneNumber}` : "Connect a phone number first"}>
      {activePhone ? <form className="formGrid profileForm" key={activePhone.id} onSubmit={(event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); runOperation({ action: "update_profile", phoneId: activePhone.id, profile: values }, "Business profile updated"); }}><Input name="about" label="About" defaultValue={activePhone.profile.about || ""} maxLength="139" /><Input name="email" label="Public email" type="email" defaultValue={activePhone.profile.email || ""} /><Input name="address" label="Address" defaultValue={activePhone.profile.address || ""} /><label>Business category<select name="vertical" defaultValue={activePhone.profile.vertical || "OTHER"}><option value="OTHER">Other</option><option value="RETAIL">Retail</option><option value="PROF_SERVICES">Professional services</option><option value="EDU">Education</option><option value="HEALTH">Health</option><option value="TRAVEL">Travel</option><option value="RESTAURANT">Restaurant</option></select></label><label className="wideField">Description<textarea name="description" rows="4" maxLength="512" defaultValue={activePhone.profile.description || ""} /></label><label className="wideField">Websites<textarea name="websites" rows="2" defaultValue={(activePhone.profile.websites || []).join("\n")} placeholder="One URL per line" /></label><div className="formActions wideField"><button className="primaryAction" type="submit"><Save size={17} /> Save profile</button><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "sync_profile", phoneId: activePhone.id }, "Business profile synchronized")}><RefreshCcw size={17} /> Reload from Meta</button></div></form> : <EmptyState text="No active WhatsApp number" />}
    </Panel>}
    {section === "flows" && <div className="contentGrid twoColumns"><Panel title="Create native WhatsApp Flow" subtitle="Meta-hosted forms for booking, lead capture, and structured onboarding"><form className="formGrid" onSubmit={(event) => { event.preventDefault(); runOperation({ action: "create_flow", ...Object.fromEntries(new FormData(event.currentTarget)), accountId: activeAccount?.id }, "WhatsApp Flow created"); event.currentTarget.reset(); }}><Input name="name" label="Flow name" required /><label>Category<select name="category"><option value="LEAD_GENERATION">Lead generation</option><option value="APPOINTMENT_BOOKING">Appointment booking</option><option value="SIGN_UP">Sign up</option><option value="CONTACT_US">Contact us</option><option value="OTHER">Other</option></select></label><Input name="endpointUri" label="Data endpoint (optional)" type="url" /><button className="primaryAction" disabled={!activeAccount}><Plus size={17} /> Create in Meta</button></form></Panel><Panel title="Meta Flow library" subtitle="Published Flows are immutable; clone in Meta before changing a published Flow"><div className="flowAssetList">{operations.nativeFlows.map((flow) => <article key={flow.id}><header><div><strong>{flow.name}</strong><span>{flow.category} | {flow.metaFlowId || "Local"}</span></div><Badge kind={flow.status === "published" ? "good" : flow.validationErrors.length ? "bad" : "warn"}>{flow.status}</Badge></header><details><summary>Flow JSON</summary><form onSubmit={(event) => { event.preventDefault(); runOperation({ action: "upload_flow", flowId: flow.id, flowJson: new FormData(event.currentTarget).get("flowJson") }, "Flow definition uploaded"); }}><textarea name="flowJson" rows="8" defaultValue={JSON.stringify(flow.flowJson || {}, null, 2)} required /><button className="secondaryAction"><Upload size={16} /> Validate and upload</button></form></details><div className="assetActions"><button className="secondaryAction" type="button" disabled={flow.status === "published"} onClick={() => runOperation({ action: "publish_flow", flowId: flow.id }, "WhatsApp Flow published")}><Play size={16} /> Publish</button></div>{flow.validationErrors.map((error, index) => <small className="errorLine" key={index}>{error.error || error.message || JSON.stringify(error)}</small>)}</article>)}</div><button className="secondaryAction" type="button" onClick={() => runOperation({ action: "sync_flows", accountId: activeAccount?.id }, "WhatsApp Flows synchronized")} disabled={!activeAccount}><RefreshCcw size={17} /> Sync from Meta</button>{!operations.nativeFlows.length && <EmptyState text="No native WhatsApp Flows yet" />}</Panel></div>}
    {section === "analytics" && <Panel title="Meta WhatsApp analytics" subtitle="Account-level messaging and conversation analytics are stored as dated snapshots"><div className="assetToolbar"><span>{operations.analytics.length} recent snapshot{operations.analytics.length === 1 ? "" : "s"}</span><button className="primaryAction" type="button" onClick={() => runOperation({ action: "sync_analytics", accountId: activeAccount?.id }, "Meta analytics synchronized")} disabled={!activeAccount}><RefreshCcw size={17} /> Sync last 30 days</button></div><div className="analyticsSnapshotGrid">{operations.analytics.map((snapshot) => <article key={snapshot.id}><BarChart3 size={19} /><div><strong>{snapshot.metricType.toUpperCase()}</strong><span>{formatTime(snapshot.periodStart)} to {formatTime(snapshot.periodEnd)}</span><small>Collected {formatTime(snapshot.collectedAt)}</small></div></article>)}</div>{!operations.analytics.length && <EmptyState text="Sync Meta analytics to create the first snapshot" />}</Panel>}
    {section === "capabilities" && <Panel title="WhatsApp capability readiness" subtitle="Availability is based on connected assets and Meta eligibility; unavailable products are never simulated"><div className="capabilityGrid">{operations.capabilities.map((capability) => <article key={capability.key}><div className="capabilityIcon"><RadioTower size={18} /></div><div><strong>{capability.name}</strong><span>{capability.detail || capability.prerequisite}</span></div><Badge kind={capability.status === "available" ? "good" : capability.status === "setup" ? "warn" : "neutral"}>{capability.status === "available" ? "Available" : capability.status === "setup" ? "Setup needed" : "Meta access"}</Badge></article>)}</div></Panel>}
  </div>;
}
function Contacts({ state, mutate }) {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [search, setSearch] = useState("");
  const [permissionFilter, setPermissionFilter] = useState("all");
  const [editContact, setEditContact] = useState(null);
  const segments = state.audienceSegments || [];
  const filteredContacts = state.contacts.filter((contact) => {
    const haystack = [contact.name, contact.phone, contact.optInSource, ...(contact.tags || [])].join(" ").toLowerCase();
    const permitted = contact.marketingPermission && !contact.unsubscribed;
    return (!search || haystack.includes(search.toLowerCase())) && (permissionFilter === "all" || (permissionFilter === "allowed" ? permitted : !permitted));
  });
  const add = (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); mutate(postJson("/api/contacts", { name: form.get("name"), phone: form.get("phone"), tags: form.get("tags"), optInSource: form.get("optInSource"), marketingPermission: form.get("marketingPermission") === "on" }), "Contact saved"); event.currentTarget.reset(); };
  const importRows = (event) => { event.preventDefault(); if (!csvText.trim()) return; mutate(postJson("/api/contacts/import", { csv: csvText }).then((next) => { setCsvText(""); setFileName(""); return next; }), "Contacts imported"); };
  const chooseFile = async (event) => { const file = event.target.files?.[0]; if (!file) return; setFileName(file.name); setCsvText(await file.text()); event.target.value = ""; };
  const saveSegment = (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); mutate(postJson("/api/segments", { name: form.get("name"), description: form.get("description"), rules: { permission: form.get("permission"), tagMode: form.get("tagMode"), tags: form.get("tags"), sources: form.get("sources"), lastActiveDays: form.get("lastActiveDays"), createdWithinDays: form.get("createdWithinDays") } }), "Segment saved"); event.currentTarget.reset(); };
  const saveContact = (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const allowed = form.get("marketingPermission") === "allowed"; mutate(postJson(`/api/contacts/${editContact.id}`, { name: form.get("name"), phone: form.get("phone"), tags: form.get("tags"), optInSource: form.get("optInSource"), marketingPermission: allowed, unsubscribed: !allowed, customAttributes: attributesFromText(form.get("customAttributes")) }, "PATCH").then((next) => { setEditContact(null); return next; }), "Contact updated"); };
  return <div className="screenGrid">
    <div className="contentGrid audienceGrid">
      <Panel title="Add contact" subtitle="Create a permission-aware WhatsApp contact"><form className="formGrid" onSubmit={add}><Input name="name" label="Name" required /><Input name="phone" label="Phone with country code" required /><Input name="tags" label="Tags" placeholder="lead, customer" /><Input name="optInSource" label="Opt-in source" /><label className="checkRow"><input name="marketingPermission" type="checkbox" /> Marketing permission recorded</label><button className="primaryAction" type="submit"><Plus size={18} /> Add contact</button></form></Panel>
      <Panel title="Import contacts" subtitle="CSV columns: name, phone, permission, tags"><form className="formGrid importForm" onSubmit={importRows}><label className="fileDrop"><input type="file" accept=".csv,text/csv" onChange={chooseFile} /><Upload size={22} /><strong>{fileName || "Choose CSV file"}</strong><span>{fileName ? "Ready to import" : "or paste CSV rows below"}</span></label><label>CSV rows<textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder="name,phone,permission,tags" /></label><div className="importMeta"><span>{csvText.trim() ? `${csvText.trim().split(/\r?\n/).length} rows ready` : "No rows loaded"}</span><button className="secondaryAction" type="submit" disabled={!csvText.trim()}><Upload size={18} /> Import</button></div></form></Panel>
    </div>
    <Panel title="Saved segments" subtitle="Reusable audiences recalculated from current contact data"><form className="segmentComposer" onSubmit={saveSegment}><Input name="name" label="Segment name" required /><Input name="description" label="Description" /><label>Permission<select name="permission" defaultValue="marketable"><option value="marketable">Marketable only</option><option value="blocked">Suppressed only</option><option value="all">All contacts</option></select></label><label>Tag match<select name="tagMode"><option value="any">Any tag</option><option value="all">All tags</option></select></label><Input name="tags" label="Tags" /><Input name="sources" label="Sources" /><Input name="lastActiveDays" label="Active within days" type="number" min="1" /><Input name="createdWithinDays" label="Created within days" type="number" min="1" /><button className="primaryAction" type="submit"><Save size={18} /> Save segment</button></form><div className="segmentList">{segments.map((segment) => <article key={segment.id}><div><strong>{segment.name}</strong><span>{segment.description || "Dynamic audience"}</span></div><Badge kind={segment.isActive ? "good" : "neutral"}>{segment.contactCount} contacts</Badge><button className="iconButton dangerSoft" type="button" title="Delete segment" onClick={() => mutate(reloadAfter(api(`/api/segments/${segment.id}`, { method: "DELETE" })), "Segment removed")}><Trash2 size={16} /></button></article>)}{!segments.length && <EmptyState text="No saved segments yet" />}</div></Panel>
    <Panel title="Contacts" subtitle={`${filteredContacts.length} shown of ${state.contacts.length}`}><div className="dataToolbar contactToolbar"><label className="searchBox"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contacts" /></label><select value={permissionFilter} onChange={(event) => setPermissionFilter(event.target.value)}><option value="all">All contacts</option><option value="allowed">Marketable</option><option value="blocked">Suppressed</option></select><a className="secondaryAction exportAction" href="/api/contacts/export"><Download size={18} /> Export CSV</a></div><DataTable headers={["Name", "Phone", "Permission", "Last activity", "Actions"]}>{filteredContacts.map((contact) => <tr key={contact.id}><td><strong>{contact.name}</strong><div className="chipRow compact">{(contact.tags || []).map((tag) => <span key={tag}>{tag}</span>)}</div></td><td>{contact.phone}</td><td><Badge kind={contact.unsubscribed ? "bad" : contact.marketingPermission ? "good" : "bad"}>{contact.unsubscribed ? "Suppressed" : contact.marketingPermission ? "Allowed" : "Blocked"}</Badge></td><td>{formatTime(contact.lastMessageAt)}</td><td className="rowActions"><button onClick={() => setEditContact(contact)}><Pencil size={15} /> Edit</button><button className="dangerText" onClick={() => mutate(postJson(`/api/contacts/${contact.id}`, {}, "DELETE"), "Removed")}><Trash2 size={15} /> Remove</button></td></tr>)}</DataTable>{!filteredContacts.length && <EmptyState text="No contacts match this view" />}</Panel>
    {editContact && <div className="modalBackdrop" role="presentation" onMouseDown={() => setEditContact(null)}><section className="editModal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="kicker">Contact profile</p><h2>Edit contact</h2></div><button className="iconButton" type="button" onClick={() => setEditContact(null)} aria-label="Close"><X size={18} /></button></header><form className="formGrid" onSubmit={saveContact}><Input name="name" label="Name" defaultValue={editContact.name} required /><Input name="phone" label="Phone" defaultValue={editContact.phone} required /><Input name="tags" label="Tags" defaultValue={(editContact.tags || []).join(", ")} /><Input name="optInSource" label="Opt-in source" defaultValue={editContact.optInSource || ""} /><label>Marketing permission<select name="marketingPermission" defaultValue={editContact.marketingPermission && !editContact.unsubscribed ? "allowed" : "blocked"}><option value="allowed">Allowed</option><option value="blocked">Suppressed</option></select></label><label>Custom fields<textarea name="customAttributes" defaultValue={attributesToText(editContact.customAttributes)} placeholder={"company=Example\ninterest=Pricing"} /></label><button className="primaryAction" type="submit"><Save size={18} /> Save changes</button></form></section></div>}
  </div>;
}
function Templates({ state, mutate }) {
  const create = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    mutate(postJson("/api/templates", {
      name: values.get("name"), category: values.get("category"), language: values.get("language"),
      headerFormat: values.get("headerFormat"), headerText: values.get("headerText"), headerMediaHandle: values.get("headerMediaHandle"),
      body: values.get("body"), footerText: values.get("footerText"), buttons: values.get("buttons"),
      advancedButtons: values.get("advancedButtons"), otpType: values.get("otpType"),
      otpButtonText: values.get("otpButtonText"), codeExpirationMinutes: values.get("codeExpirationMinutes"),
      submitToMeta: true
    }).then((next) => { form.reset(); return next; }), "Template submitted");
  };
  const sync = () => mutate(postJson("/api/templates/sync", {}), "Templates synced");
  return <div className="screenGrid"><section className="actionBand"><div><strong>Meta template library</strong><span>Approval status and components stay synchronized with your WABA.</span></div><button className="secondaryAction" type="button" onClick={sync}><RefreshCcw size={18} /> Sync from Meta</button></section><Panel title="Create WhatsApp template" subtitle="Marketing, utility, authentication, media headers, and action buttons"><form className="templateComposer fullTemplateComposer" onSubmit={create}><Input name="name" label="Template name" required /><label>Category<select name="category"><option value="MARKETING">Marketing</option><option value="UTILITY">Utility</option><option value="AUTHENTICATION">Authentication / OTP</option></select></label><label>Language<select name="language"><option value="en_US">English (US)</option><option value="en">English</option><option value="en_GB">English (UK)</option><option value="hi">Hindi</option></select></label><label>Header format<select name="headerFormat"><option value="NONE">No header</option><option value="TEXT">Text</option><option value="IMAGE">Image</option><option value="VIDEO">Video</option><option value="DOCUMENT">Document</option></select></label><Input name="headerText" label="Text header" maxLength="60" /><Input name="headerMediaHandle" label="Meta media handle" /><label className="templateBodyField">Body<textarea name="body" placeholder="Use variables like {{name}}" required /></label><Input name="footerText" label="Footer" maxLength="60" /><Input name="buttons" label="Quick replies" placeholder="Pricing, Book demo" /><details className="advancedTemplateFields"><summary>Advanced buttons and OTP settings</summary><label>Buttons<textarea name="advancedButtons" rows="4" placeholder={"QUICK_REPLY|Pricing\nURL|Visit website|https://example.com\nPHONE_NUMBER|Call us|+919000000000"} /></label><div className="formSplit"><label>OTP action<select name="otpType"><option value="COPY_CODE">Copy code</option><option value="ONE_TAP">One-tap autofill</option><option value="ZERO_TAP">Zero-tap autofill</option></select></label><Input name="otpButtonText" label="OTP button text" defaultValue="Copy code" maxLength="25" /><Input name="codeExpirationMinutes" label="Code expiry (minutes)" type="number" min="1" max="90" defaultValue="10" /></div></details><button className="primaryAction" type="submit"><MessageSquareText size={18} /> Submit to Meta</button></form></Panel><div className="cardGrid">{state.templates.map((template) => <article className="templateCard" key={template.id}><div className="cardHead"><div><h3>{template.name}</h3><small>{template.category} | {template.language} | {template.componentSchema?.headerFormat || "TEXT"}</small></div><Badge kind={template.status === "Approved" ? "good" : template.status === "Pending" ? "warn" : "bad"}>{template.status}</Badge></div>{template.headerText && <strong className="templateHeaderText">{template.headerText}</strong>}<p>{template.body}</p>{template.footerText && <small className="templateFooterText">{template.footerText}</small>}<div className="chipRow">{(template.buttons || []).map((button) => <span key={`${button.type || "button"}-${button.text}`}>{button.type && button.type !== "QUICK_REPLY" ? `${button.type}: ` : ""}{button.text}</span>)}{template.variables.map((variable) => <span key={variable}>{`{{${variable}}}`}</span>)}</div>{template.rejectionReason && <small className="errorLine">{template.rejectionReason}</small>}</article>)}</div>{!state.templates.length && <Panel title="No templates"><EmptyState text="Submit or sync a WhatsApp template to begin" /></Panel>}</div>;
}
function AutomationFlows({ state, mutate, approvedTemplates }) {
  const flows = state.automationFlows || [];
  const teamMembers = state.teamMembers || [];
  const [editingId, setEditingId] = useState("");
  const [flowMeta, setFlowMeta] = useState({ name: "", description: "", status: "draft", triggerMode: "keywords", triggerKeywords: "" });
  const [nodes, setNodes] = useState([]);
  const [draggedNode, setDraggedNode] = useState("");
  const [formError, setFormError] = useState("");
  const analytics = flows.reduce((totals, flow) => ({
    active: totals.active + flow.activeSessions,
    completed: totals.completed + flow.completedSessions,
    handoff: totals.handoff + flow.handoffSessions,
    pending: totals.pending + flow.pendingJobs
  }), { active: 0, completed: 0, handoff: 0, pending: 0 });

  const createNode = () => ({ id: `node_${Date.now().toString(36)}`, type: "question", body: "", inputKind: "buttons", options: [], next: "", fallback: "", captureAs: "", templateId: "", delayMinutes: 0, assignedUserId: "" });
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
      delayMinutes: node.delayMinutes || 0,
      assignedUserId: node.assignedUserId || ""
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
        match: String(option.match || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
        next: option.next
      })).filter((option) => option.id && option.label),
      next: node.next,
      fallback: node.fallback.trim(),
      captureAs: node.captureAs.trim(),
      buttonText: String(node.buttonText || "").trim(),
      sectionTitle: String(node.sectionTitle || "").trim(),
      templateId: node.templateId,
      delayMinutes: Math.max(0, Number(node.delayMinutes) || 0),
      assignedUserId: node.assignedUserId
    })).filter((node) => node.id);
    return { startNodeId: cleanNodes[0]?.id || "", nodes: cleanNodes };
  };

  const submit = (event) => {
    event.preventDefault();
    setFormError("");
    const definition = buildDefinition();
    if (!definition.nodes.length) { setFormError("Add at least one node before saving."); return; }
    if (flowMeta.triggerMode === "keywords" && !flowMeta.triggerKeywords.trim()) { setFormError("Add trigger keywords or choose another trigger mode."); return; }
    mutate(postJson("/api/automation/flows", {
      id: editingId,
      name: flowMeta.name,
      description: flowMeta.description,
      status: flowMeta.status,
      triggerMode: flowMeta.triggerMode,
      triggerKeywords: flowMeta.triggerKeywords.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
      definition
    }).then((next) => { reset(); return next; }), editingId ? "Automation flow updated" : "Automation flow saved");
  };

  const updateStatus = (flow, status) => mutate(postJson(`/api/automation/flows/${flow.id}`, { status }, "PATCH"), status === "active" ? "Flow activated" : "Flow paused");
  const archive = (flow) => mutate(postJson(`/api/automation/flows/${flow.id}`, {}, "DELETE"), "Flow archived");
  const process = () => mutate(postJson("/api/automation/process", { limit: 25 }), "Automation queue processed");

  return <div className="screenGrid automationScreen">
    <section className="automationHero">
      <div><p className="kicker">Automation studio</p><h2>Build reply flows without code</h2><span>Each company owns its own triggers, nodes, routes, follow-up templates, delays, and handoff rules.</span></div>
      <div className="automationKpis"><Metric label="Flows" value={flows.length} /><Metric label="Active sessions" value={analytics.active} /><Metric label="Completed" value={analytics.completed} /><Metric label="Pending jobs" value={analytics.pending} /></div>
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
          <div className="formSplit"><label>Status<select value={flowMeta.status} onChange={(event) => updateMeta("status", event.target.value)}><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option></select></label><label>Trigger mode<select value={flowMeta.triggerMode} onChange={(event) => updateMeta("triggerMode", event.target.value)}><option value="keywords">Keywords</option><option value="any_inbound">Any inbound message</option><option value="manual">Manual only</option></select></label></div>
          <label>Trigger keywords<textarea rows="3" value={flowMeta.triggerKeywords} onChange={(event) => updateMeta("triggerKeywords", event.target.value)} placeholder="Comma or line separated trigger words"></textarea></label>
          {formError && <div className="formError" role="alert">{formError}</div>}
          <button className="primaryAction" type="submit"><Bot size={18} /> <span>{editingId ? "Update flow" : "Save flow"}</span></button>
        </div>
      </Panel>

      <section className="flowCanvas" aria-label="Automation nodes">
        {nodes.map((node, nodeIndex) => <article className="flowNode" key={node.id} draggable onDragStart={() => setDraggedNode(node.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => reorderNode(node.id)}>
          <header><button className="iconButton dragHandle" type="button" title="Drag node"><Bot size={16} /></button><div><strong>{node.id || `Node ${nodeIndex + 1}`}</strong><span>{nodeIndex === 0 ? "Start node" : "Step node"}</span></div><button className="iconButton dangerSoft" type="button" title="Remove node" onClick={() => removeNode(node.id)}><Trash2 size={16} /></button></header>
          <div className="nodeFields">
            <label>Node ID<input value={node.id} onChange={(event) => updateNode(node.id, "id", event.target.value)} /></label>
            <label>Type<select value={node.type} onChange={(event) => updateNode(node.id, "type", event.target.value)}><option value="question">Question</option><option value="message">Message</option><option value="template">Template follow-up</option><option value="handoff">Human handoff</option><option value="end">End</option></select></label>
            <label>Input<select value={node.inputKind} onChange={(event) => updateNode(node.id, "inputKind", event.target.value)}><option value="buttons">Buttons</option><option value="list">List</option><option value="text">Free text</option><option value="none">No input</option></select></label>
            <label>Next node<select value={node.next} onChange={(event) => updateNode(node.id, "next", event.target.value)}><option value="">None</option>{nodes.filter((item) => item.id !== node.id).map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>
          </div>
          {node.type === "template" && <div className="nodeFields"><label>Approved template<select value={node.templateId} onChange={(event) => updateNode(node.id, "templateId", event.target.value)}><option value="">Select template</option>{approvedTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><label>Delay minutes<input type="number" min="0" value={node.delayMinutes} onChange={(event) => updateNode(node.id, "delayMinutes", event.target.value)} /></label></div>}
          {node.type === "handoff" && <label>Assign to<select value={node.assignedUserId} onChange={(event) => updateNode(node.id, "assignedUserId", event.target.value)}><option value="">Keep unassigned</option>{teamMembers.map((member) => <option key={member.id} value={member.id}>{member.name || member.email}</option>)}</select></label>}
          <label>Message<textarea rows="4" value={node.body} onChange={(event) => updateNode(node.id, "body", event.target.value)} placeholder="Message body. Use variables like {{name}} or captured values."></textarea></label>
          <div className="nodeFields"><label>Fallback<textarea rows="2" value={node.fallback} onChange={(event) => updateNode(node.id, "fallback", event.target.value)} placeholder="Shown when reply does not match"></textarea></label><label>Capture as<input value={node.captureAs} onChange={(event) => updateNode(node.id, "captureAs", event.target.value)} placeholder="Variable name" /></label></div>
          {(node.inputKind === "buttons" || node.inputKind === "list") && <div className="optionEditor"><div className="optionHead"><strong>Options</strong><button className="secondaryAction" type="button" onClick={() => addOption(node.id)}><Plus size={16} /> Add option</button></div>{node.options.map((option, optionIndex) => <div className="optionRow" key={`${node.id}-${optionIndex}`}><input value={option.id} onChange={(event) => updateOption(node.id, optionIndex, "id", event.target.value)} placeholder="id" /><input value={option.label} onChange={(event) => updateOption(node.id, optionIndex, "label", event.target.value)} placeholder="label" /><input value={option.match} onChange={(event) => updateOption(node.id, optionIndex, "match", event.target.value)} placeholder="match terms" /><select value={option.next} onChange={(event) => updateOption(node.id, optionIndex, "next", event.target.value)}><option value="">Next</option>{nodes.filter((item) => item.id !== node.id).map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select><button className="iconButton dangerSoft" type="button" onClick={() => removeOption(node.id, optionIndex)}><Trash2 size={15} /></button></div>)}</div>}
        </article>)}
        {!nodes.length && <button className="emptyFlowButton" type="button" onClick={addNode}><Plus size={22} /> Add the first automation node</button>}
      </section>
    </form>

    <div className="flowCardGrid">
      {flows.map((flow) => <article className="templateCard flowCard" key={flow.id}><div className="cardHead"><div><h3>{flow.name}</h3><p>{flow.description || "No description"}</p></div><Badge kind={flow.status === "active" ? "good" : flow.status === "paused" ? "warn" : "neutral"}>{flow.status}</Badge></div><div className="statusGrid"><Metric label="Nodes" value={flow.nodeCount} /><Metric label="Active" value={flow.activeSessions} /><Metric label="Completed" value={flow.completedSessions} /><Metric label="Rate" value={`${flow.completionRate || 0}%`} /></div><div className="chipRow">{flow.triggerKeywords.map((keyword) => <span key={keyword}>{keyword}</span>)}{!flow.triggerKeywords.length && <span>{flow.triggerMode}</span>}</div><div className="flowActions"><button className="secondaryAction" type="button" onClick={() => loadFlow(flow)}>Edit</button><button className="secondaryAction" type="button" onClick={() => updateStatus(flow, flow.status === "active" ? "paused" : "active")}>{flow.status === "active" ? "Pause" : "Activate"}</button><button className="secondaryAction dangerSoft" type="button" onClick={() => archive(flow)}><Trash2 size={16} /> Archive</button></div></article>)}
      {!flows.length && <Panel title="No automation flows"><EmptyState text="Create and activate a flow to automate replies from incoming WhatsApp messages." /></Panel>}
    </div>
  </div>;
}
function Campaigns({ state, approvedTemplates, marketableContacts, mutate, setActiveView }) {
  const activeFlows = (state.automationFlows || []).filter((flow) => flow.status === "active");
  const segments = (state.audienceSegments || []).filter((segment) => segment.isActive);
  const [templateId, setTemplateId] = useState(approvedTemplates[0]?.id || "");
  const [automationFlowId, setAutomationFlowId] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [variables, setVariables] = useState({});
  const [recipientSearch, setRecipientSearch] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const filteredRecipients = marketableContacts.filter((contact) => [contact.name, contact.phone, ...(contact.tags || [])].join(" ").toLowerCase().includes(recipientSearch.toLowerCase()));
  useEffect(() => { if (!templateId && approvedTemplates[0]?.id) setTemplateId(approvedTemplates[0].id); if (templateId && !approvedTemplates.some((item) => item.id === templateId)) setTemplateId(approvedTemplates[0]?.id || ""); }, [approvedTemplates, templateId]);
  const template = approvedTemplates.find((item) => item.id === templateId) || approvedTemplates[0];
  const segment = segments.find((item) => item.id === segmentId);
  const editableVariables = (template?.variables || []).filter((variable) => variable !== "name");
  const preview = template ? renderPreview(template.body, marketableContacts[0], variables) : "Select an approved template first.";
  const toggleContact = (contactId) => setSelectedContactIds((current) => current.includes(contactId) ? current.filter((id) => id !== contactId) : [...current, contactId]);
  const submit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await postJson("/api/campaigns", { name: form.get("name"), templateId, automationFlowId, segmentId, variables, contactIds: selectedContactIds, scheduledAt: form.get("scheduledAt") ? new Date(form.get("scheduledAt")).toISOString() : "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      await mutate(postJson("/api/campaigns/process", { limit: 25 }), "Campaign queued");
      setActiveView("results");
    } catch (error) { mutate(Promise.reject(error)); }
  };
  const targetCount = segment ? segment.contactCount : selectedContactIds.length;
  return <div className="campaignLayout"><Panel title="Campaign" subtitle="Send an approved template to contacts or a saved segment"><form className="formGrid" onSubmit={submit}><Input name="name" label="Campaign name" required /><label>Approved template<select value={template?.id || ""} onChange={(event) => { setTemplateId(event.target.value); setVariables({}); }} disabled={!approvedTemplates.length}><option value="">{approvedTemplates.length ? "Choose template" : "No approved templates available"}</option>{approvedTemplates.map((item) => <option value={item.id} key={item.id}>{item.name} ({item.language})</option>)}</select></label><label>Saved segment<select value={segmentId} onChange={(event) => { setSegmentId(event.target.value); if (event.target.value) setSelectedContactIds([]); }}><option value="">Select contacts manually</option>{segments.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.contactCount})</option>)}</select></label><label>Schedule<input name="scheduledAt" type="datetime-local" /></label><label>Reply automation<select value={automationFlowId} onChange={(event) => setAutomationFlowId(event.target.value)}><option value="">No follow-up flow</option>{activeFlows.map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}</select></label>{editableVariables.map((variable) => <label key={variable}>{variable}<input value={variables[variable] || ""} onChange={(event) => setVariables((current) => ({ ...current, [variable]: event.target.value }))} placeholder={`Value for {{${variable}}}`} /></label>)}<div className="recipientHeader"><label className="searchBox recipientSearch"><Search size={17} /><input value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} placeholder="Search eligible contacts" /></label><span>{segment ? `${segment.contactCount} from segment` : `${selectedContactIds.length} selected`}</span></div><div className="recipientBox">{filteredRecipients.map((contact) => <label key={contact.id}><span>{contact.name}<small>{contact.phone}</small></span><input checked={selectedContactIds.includes(contact.id)} onChange={() => toggleContact(contact.id)} type="checkbox" /></label>)}{!marketableContacts.length && <EmptyState text="No eligible contacts" />}</div><button className="primaryAction" type="submit" disabled={!template || (!segmentId && !selectedContactIds.length)}><Clock3 size={18} /> Queue campaign{targetCount ? ` (${targetCount})` : ""}</button></form></Panel><Panel title="WhatsApp preview" subtitle={template ? `${template.name} | ${template.language}` : "No approved template selected"}><div className="phonePreview"><div className="waBubble">{template?.headerText && <strong>{template.headerText}</strong>}<p>{preview}</p>{template?.footerText && <small>{template.footerText}</small>}{template?.buttons?.length > 0 && <div className="waQuickReplies">{template.buttons.map((button) => <span key={button.text}>{button.text}</span>)}</div>}</div></div></Panel></div>;
}
function Results({ state, mutate }) {
  const processQueue = () => mutate(postJson("/api/campaigns/process", { limit: 25 }), "Queue processed");
  const lifecycle = (campaign, action) => mutate(postJson(`/api/campaigns/${campaign.id}`, { action }, "PATCH"), `Campaign ${action}d`);
  return <div className="screenGrid"><section className="actionBand"><div><strong>Campaign operations</strong><span>Delivery status updates arrive from Meta webhooks.</span></div><button className="secondaryAction" type="button" onClick={processQueue}><RefreshCcw size={18} /> Process due jobs</button></section>{state.campaigns.map((campaign) => <Panel key={campaign.id} title={campaign.name} subtitle={campaign.scheduledAt ? `Scheduled ${formatTime(campaign.scheduledAt)} | ${campaign.timezone}` : formatTime(campaign.createdAt)}><div className="resultHeader campaignResultActions"><Badge kind={campaign.status === "failed" || campaign.status === "cancelled" ? "bad" : ["scheduled", "processing", "paused", "queued"].includes(campaign.status) ? "warn" : "good"}>{campaign.status}</Badge>{["queued", "scheduled", "processing"].includes(campaign.status) && <button className="secondaryAction compactAction" onClick={() => lifecycle(campaign, "pause")}><Pause size={15} /> Pause</button>}{campaign.status === "paused" && <button className="secondaryAction compactAction" onClick={() => lifecycle(campaign, "resume")}><Play size={15} /> Resume</button>}{["queued", "scheduled", "processing", "paused"].includes(campaign.status) && <button className="secondaryAction compactAction dangerSoft" onClick={() => lifecycle(campaign, "cancel")}><X size={15} /> Cancel</button>}</div><ResultMeters stats={campaign.stats} /><DataTable headers={["Customer", "Status", "Message"]}>{campaign.recipients.map((recipient) => { const contact = state.contacts.find((item) => item.id === recipient.contactId) || {}; return <tr key={recipient.id || recipient.metaMessageId}><td><strong>{contact.name || "Unknown"}</strong></td><td><Badge kind={recipient.status === "failed" ? "bad" : recipient.status === "queued" ? "warn" : "good"}>{recipient.status}</Badge></td><td><span>{recipient.message}</span>{recipient.errorMessage && <small className="errorLine">{recipient.errorMessage}</small>}</td></tr>; })}</DataTable></Panel>)}{!state.campaigns.length && <Panel title="No results"><EmptyState text="No campaigns yet" /></Panel>}</div>;
}
function MessageContent({ message }) {
  const mediaUrl = `/api/media/${message.id}`;
  if (message.messageType === "image" || message.messageType === "sticker") return <><a className="mediaPreview" href={mediaUrl} target="_blank" rel="noreferrer"><Image size={16} /><img src={mediaUrl} alt={message.caption || "WhatsApp attachment"} loading="lazy" /></a>{message.caption && <p>{message.caption}</p>}</>;
  if (message.messageType === "video") return <><video className="messageMedia" controls preload="metadata" src={mediaUrl} /><p>{message.caption}</p></>;
  if (message.messageType === "audio") return <audio className="messageAudio" controls preload="metadata" src={mediaUrl} />;
  if (message.messageType === "document") return <a className="mediaDownload" href={mediaUrl} target="_blank" rel="noreferrer"><FileText size={17} /><span>{message.metadata?.filename || message.caption || "Open document"}</span></a>;
  return <p>{message.body}</p>;
}

function TemplateReplyForm({ approvedTemplates, activeContact, mutate }) {
  const [templateId, setTemplateId] = useState(approvedTemplates[0]?.id || "");
  useEffect(() => { if (!approvedTemplates.some((item) => item.id === templateId)) setTemplateId(approvedTemplates[0]?.id || ""); }, [approvedTemplates, templateId]);
  const template = approvedTemplates.find((item) => item.id === templateId);
  const replyVariables = (template?.variables || []).filter((variable) => variable !== "name");
  const submit = (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const variables = Object.fromEntries(replyVariables.map((variable) => [variable, form.get(variable)])); mutate(postJson("/api/messages/template-reply", { contactId: activeContact.id, templateId, variables }), "Template sent"); };
  return <form className="composer templateLine" onSubmit={submit}><select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{approvedTemplates.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.language})</option>)}</select>{replyVariables.map((variable) => <input key={variable} name={variable} placeholder={`{{${variable}}}`} required />)}<button className="secondaryAction" disabled={!template}><Send size={17} /> Send template</button></form>;
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

function InboxView({ state, activeConversation, activeContact, approvedTemplates, openConversation, mutate }) {
  const teamMembers = state.teamMembers || [];
  const currentUserId = state.account?.user?.id || "";
  const [search, setSearch] = useState("");
  const [inboxFilter, setInboxFilter] = useState("all");
  const filteredConversations = state.conversations.filter((conversation) => {
    const contact = state.contacts.find((item) => item.id === conversation.contactId) || {};
    const latest = conversation.messages.at(-1);
    const matchesSearch = !search || [contact.name, contact.phone, latest?.body].join(" ").toLowerCase().includes(search.toLowerCase());
    const filters = {
      all: true,
      unread: conversation.unreadCount > 0,
      mine: conversation.assignedUserId === currentUserId,
      unassigned: !conversation.assignedUserId,
      human: conversation.automationPaused,
      closed: conversation.status === "closed",
      replyable: conversation.canReply && conversation.status !== "closed"
    };
    return matchesSearch && filters[inboxFilter];
  });
  const assignedUser = teamMembers.find((member) => member.id === activeConversation?.assignedUserId);
  const workflowAction = (action, extra = {}) => { if (!activeConversation) return; mutate(postJson(`/api/conversations/${activeConversation.id}/workflow`, { action, ...extra }, "PATCH"), action === "note" ? "Note added" : "Conversation updated"); };
  const selectConversation = (conversation) => { openConversation(conversation.id); if (conversation.unreadCount > 0) mutate(postJson(`/api/conversations/${conversation.id}/workflow`, { action: "mark_read" }, "PATCH")); };
  const reply = (event) => { event.preventDefault(); const form = event.currentTarget; const body = new FormData(form).get("body"); if (!activeContact || !body?.trim()) return; mutate(postJson("/api/messages/reply", { contactId: activeContact.id, body }), "Message sent"); form.reset(); };
  const note = (event) => { event.preventDefault(); const form = event.currentTarget; const value = new FormData(form).get("note"); if (!value?.trim()) return; workflowAction("note", { note: value }); form.reset(); };
  return <><section className="inboxShell">
    <aside className="threadList"><div className="threadTools"><label className="searchBox"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" /></label><select value={inboxFilter} onChange={(event) => setInboxFilter(event.target.value)}><option value="all">All conversations</option><option value="unread">Unread</option><option value="mine">Assigned to me</option><option value="unassigned">Unassigned</option><option value="human">Human takeover</option><option value="replyable">Reply window open</option><option value="closed">Closed</option></select></div>{filteredConversations.map((conversation) => { const contact = state.contacts.find((item) => item.id === conversation.contactId) || {}; const latest = conversation.messages.at(-1); return <button key={conversation.id} className={conversation.id === activeConversation?.id ? "active" : ""} onClick={() => selectConversation(conversation)}><span className="threadTitle"><strong>{contact.name || contact.phone}</strong>{conversation.unreadCount > 0 && <b>{conversation.unreadCount}</b>}</span><span>{latest?.body || "No messages"}</span><em>{formatTime(conversation.updatedAt)}</em><small>{conversation.status === "closed" ? "Closed" : conversation.automationPaused ? "Human takeover" : conversation.assignedUserId ? "Assigned" : "Unassigned"}</small></button>; })}{!filteredConversations.length && <EmptyState text="No conversations match this view" />}</aside>
    <div className="threadPane">{activeConversation && activeContact ? <><header><div><strong>{activeContact.name}</strong><small>{activeContact.phone} | {assignedUser ? `Assigned to ${assignedUser.name || assignedUser.email}` : "Unassigned"}</small></div><Badge kind={activeConversation.status === "closed" ? "neutral" : activeConversation.automationPaused ? "warn" : activeConversation.canReply ? "good" : "neutral"}>{activeConversation.status === "closed" ? "Closed" : activeConversation.automationPaused ? "Human" : activeConversation.canReply ? "24h open" : "Template only"}</Badge></header><div className="inboxControls"><select value={activeConversation.assignedUserId || ""} onChange={(event) => workflowAction("assign", { assignedUserId: event.target.value })}><option value="">Unassigned</option>{teamMembers.map((member) => <option key={member.id} value={member.id}>{member.name || member.email}</option>)}</select><button className="secondaryAction" type="button" onClick={() => workflowAction("takeover", { assignedUserId: activeConversation.assignedUserId || currentUserId })}>Take over</button><button className="secondaryAction" type="button" onClick={() => workflowAction("resume")} disabled={!activeConversation.automationPaused}>Resume automation</button><button className="secondaryAction" type="button" onClick={() => workflowAction(activeConversation.status === "closed" ? "reopen" : "close")}>{activeConversation.status === "closed" ? <Play size={16} /> : <CheckCheck size={16} />}{activeConversation.status === "closed" ? "Reopen" : "Close"}</button></div><div className="messages">{activeConversation.messages.map((message) => <div key={message.id} className={`bubble ${message.direction}`}><MessageContent message={message} /><small>{formatTime(message.at)} | {message.status}</small></div>)}</div>{activeConversation.status !== "closed" && activeConversation.canReply && <form className="composer" onSubmit={reply}><textarea name="body" placeholder="Write a WhatsApp reply" required /><button className="primaryAction"><Send size={18} /> Send</button></form>}{activeConversation.status !== "closed" && !activeConversation.canReply && <TemplateReplyForm approvedTemplates={approvedTemplates} activeContact={activeContact} mutate={mutate} />}<aside className="conversationNotes"><header><div><StickyNote size={17} /><strong>Internal notes</strong></div><span>{activeConversation.notes?.length || 0}</span></header><div className="noteList">{(activeConversation.notes || []).map((item) => <article key={item.id}><p>{item.body}</p><small>{item.author} | {formatTime(item.createdAt)}</small></article>)}{!activeConversation.notes?.length && <span>No internal notes yet</span>}</div><form onSubmit={note}><input name="note" placeholder="Add a note for your team" required /><button className="iconButton" title="Add note"><Plus size={17} /></button></form></aside></> : <EmptyState text="No conversations" />}</div>
  </section>{activeConversation?.status !== "closed" && activeConversation?.canReply && activeContact && <InteractiveReplyForm activeContact={activeContact} mutate={mutate} />}</>;
}
function Team({ state, mutate }) {
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

function Unsubscribes({ suppressedContacts, mutate }) {
  return <Panel title="Suppression"><DataTable headers={["Name", "Phone", "Reason", "Action"]}>{suppressedContacts.map((contact) => <tr key={contact.id}><td><strong>{contact.name}</strong></td><td>{contact.phone}</td><td>{contact.unsubscribed ? "Unsubscribed" : "No permission"}</td><td><button onClick={() => mutate(postJson(`/api/contacts/${contact.id}`, { marketingPermission: true, unsubscribed: false }, "PATCH"), "Restored")}>Restore</button></td></tr>)}</DataTable>{!suppressedContacts.length && <EmptyState text="No suppressed contacts" />}</Panel>;
}

function Panel({ title, subtitle, children }) { return <section className="panel"><div className="panelHead"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>{children}</section>; }
function Metric({ label, value }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
function Badge({ kind = "neutral", children }) { return <span className={`badge ${kind}`}>{children}</span>; }
function Input({ label, ...props }) { return <label>{label}<input {...props} /></label>; }
function PasswordField({ label, visible, onToggle, ...props }) { return <label>{label}<span className="passwordWrap"><input {...props} type={visible ? "text" : "password"} minLength="8" /><button type="button" onClick={onToggle} aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>; }
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
