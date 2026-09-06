"use client";

import { Children, cloneElement, isValidElement, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck, Ban, BarChart3, Bot, ChevronRight, CircleAlert, Inbox, LayoutDashboard,
  Eye, EyeOff, Loader2, LogOut, MessageSquareText, PhoneCall, Plus, RefreshCcw, Send, Settings2,
  ShieldCheck, Sparkles, Trash2, Upload, UsersRound
} from "lucide-react";

const navItems = [
  { id: "overview", label: "Command", icon: LayoutDashboard },
  { id: "setup", label: "Meta Setup", icon: Settings2 },
  { id: "contacts", label: "Audience", icon: UsersRound },
  { id: "templates", label: "Templates", icon: MessageSquareText },
  { id: "automation", label: "Automation", icon: Bot },
  { id: "campaigns", label: "Campaigns", icon: Send },
  { id: "results", label: "Results", icon: BarChart3 },
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "unsubscribes", label: "Suppression", icon: Ban }
];

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

function renderPreview(body, contact, values) {
  return String(body || "").replace(/{{\s*([\w.-]+)\s*}}/g, (_, key) => {
    if (key === "name") return contact?.name || "{{name}}";
    return values[key] || `{{${key}}}`;
  });
}

export default function Home() {
  const [state, setState] = useState(null);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState("");
  const [activeView, setActiveView] = useState("overview");
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [notice, setNotice] = useState("");

  const approvedTemplates = useMemo(() => state?.templates.filter((template) => template.status === "Approved") || [], [state]);
  const marketableContacts = useMemo(() => state?.contacts.filter((contact) => contact.marketingPermission && !contact.unsubscribed) || [], [state]);
  const suppressedContacts = useMemo(() => state?.contacts.filter((contact) => contact.unsubscribed || !contact.marketingPermission) || [], [state]);

  useEffect(() => { bootstrap(); }, []);

  const notify = (message) => { if (!message) return; setNotice(message); setTimeout(() => setNotice(""), 2600); };

  const bootstrap = async () => {
    try {
      setLoading(true);
      const me = await api("/api/me");
      setAccount(me);
      setState(await api("/api/state"));
      setConfigError("");
    } catch (error) {
      setState(null);
      setAccount(null);
      if (["DB_NOT_CONFIGURED", "AUTH_NOT_CONFIGURED"].includes(error.code)) setConfigError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    try { setState(await api("/api/state")); }
    catch (error) { notify(error.message); if (error.code === "AUTH_REQUIRED") setAccount(null); }
  };

  const mutate = async (promise, message) => {
    try { setState(await promise); notify(message); }
    catch (error) { notify(error.message); }
  };

  const logout = async () => {
    await postJson("/api/auth/logout", {});
    setAccount(null);
    setState(null);
  };

  if (loading) return <main className="loading"><Sparkles size={32} /><p>Loading workspace</p></main>;
  if (configError) return <SystemSetup message={configError} />;
  if (!account) return <AuthScreen onDone={bootstrap} />;
  if (!state) return <main className="loading"><Sparkles size={32} /><p>Preparing workspace</p></main>;

  const activeConversation = state.conversations.find((conversation) => conversation.id === activeConversationId) || state.conversations[0];
  const activeContact = activeConversation ? state.contacts.find((contact) => contact.id === activeConversation.contactId) : null;
  const latestCampaign = state.campaigns[0];
  const screenProps = { state, mutate, setActiveView, approvedTemplates, marketableContacts, suppressedContacts, latestCampaign, activeConversation, activeContact, setActiveConversationId };

  return (
    <main className="shell">
      <aside className="sideRail">
        <div className="brandBlock"><div className="brandIcon"><PhoneCall size={22} /></div><div><strong>Growth Desk</strong><span>{account.business.name}</span></div></div>
        <nav className="navList" aria-label="Product sections">
          {navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => setActiveView(item.id)}><Icon size={18} /><span>{item.label}</span></button>; })}
        </nav>
        <div className="railNote"><ShieldCheck size={18} /><span>{account.user.email}</span></div>
      </aside>
      <section className="workspace">
        <header className="heroBar">
          <div><p className="kicker">{navItems.find((item) => item.id === activeView)?.label}</p><h1>{pageTitle(activeView)}</h1></div>
          <div className="topActions"><button className="iconButton" title="Refresh" onClick={refresh}><RefreshCcw size={18} /></button><button className="iconButton" title="Sign out" onClick={logout}><LogOut size={18} /></button><span className={`statusPill ${state.setup.status === "Connected" ? "good" : "warn"}`}>{state.setup.status}</span></div>
        </header>
        {notice && <div className="toast">{notice}</div>}
        <Screens activeView={activeView} {...screenProps} />
      </section>
    </main>
  );
}

function AuthScreen({ onDone }) {
  const [mode, setMode] = useState("signin");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const isSignup = mode === "signup";

  const switchMode = () => {
    if (pending) return;
    setError("");
    setShowPassword(false);
    setShowConfirm(false);
    setMode(isSignup ? "signin" : "signup");
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

  return <main className="authShell"><section className="authPanel authPanelPro"><div className="brandBlock dark authBrand"><div className="brandIcon"><PhoneCall size={22} /></div><div><strong>Growth Desk</strong><span>WhatsApp Business CRM</span></div></div><div className="authHeader"><p className="kicker">Secure workspace</p><h1>{isSignup ? "Create workspace" : "Sign in"}</h1><p>{isSignup ? "Start with your business account and connect Meta after login." : "Continue to your WhatsApp campaign workspace."}</p></div><form className="formGrid authForm" onSubmit={submit}>{isSignup && <><Input name="name" label="Your name" autoComplete="name" required /><Input name="businessName" label="Business name" autoComplete="organization" required /></>}<Input name="workspaceEmail" label="Email" type="email" autoComplete="off" data-lpignore="true" data-form-type="other" required /><PasswordField name="workspacePassword" label="Password" visible={showPassword} onToggle={() => setShowPassword((value) => !value)} autoComplete="new-password" data-lpignore="true" data-form-type="other" required />{isSignup && <PasswordField name="confirmPassword" label="Confirm password" visible={showConfirm} onToggle={() => setShowConfirm((value) => !value)} autoComplete="new-password" required />}{error && <div className="formError" role="alert">{error}</div>}<button className="primaryAction authSubmit" type="submit" disabled={pending}>{pending ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />} <span>{pending ? "Please wait" : isSignup ? "Create account" : "Sign in"}</span></button></form><div className="authSwitch"><span>{isSignup ? "Already have a workspace?" : "New workspace?"}</span><button className="textButton" type="button" onClick={switchMode}>{isSignup ? "Sign in" : "Create account"}</button></div></section></main>;
}
function SystemSetup({ message }) {
  return <main className="authShell"><section className="authPanel"><div className="brandBlock dark"><div className="brandIcon"><Settings2 size={22} /></div><div><strong>Configuration required</strong><span>Production database setup</span></div></div><h1>Connect PostgreSQL</h1><p className="setupCopy">{message}</p><div className="envBox"><code>DATABASE_URL</code><code>AUTH_SECRET</code><code>ENCRYPTION_KEY</code></div></section></main>;
}

function Screens({ activeView, ...props }) {
  const screens = { overview: <Overview {...props} />, setup: <Setup {...props} />, contacts: <Contacts {...props} />, templates: <Templates {...props} />, automation: <AutomationFlows {...props} />, campaigns: <Campaigns {...props} />, results: <Results {...props} />, inbox: <InboxView {...props} />, unsubscribes: <Unsubscribes {...props} /> };
  return screens[activeView];
}

function pageTitle(view) {
  return { overview: "Command center", setup: "Business connection", contacts: "Audience", templates: "Template library", automation: "Automation flows", campaigns: "Campaign builder", results: "Campaign results", inbox: "Inbox", unsubscribes: "Suppression list" }[view];
}

function Overview({ state, approvedTemplates, marketableContacts, latestCampaign, setActiveView }) {
  return <div className="screenGrid"><section className="heroPanel"><div><span className="softLabel">{state.setup.mode}</span><h2>{state.setup.businessName || "Workspace"}</h2><p>Manage opted-in WhatsApp contacts, approved templates, campaign delivery, customer replies, and unsubscribe safety from one business workspace.</p></div><div className="heroMetrics"><Metric label="Marketable" value={marketableContacts.length} /><Metric label="Approved" value={approvedTemplates.length} /><Metric label="Campaigns" value={state.campaigns.length} /></div></section><section className="actionBand"><button className="primaryAction" onClick={() => setActiveView("campaigns")}><Send size={18} /> New campaign <ChevronRight size={18} /></button><button className="secondaryAction" onClick={() => setActiveView("contacts")}><UsersRound size={18} /> Add audience</button><button className="secondaryAction" onClick={() => setActiveView("inbox")}><Inbox size={18} /> Inbox</button></section><Panel title="Latest campaign" subtitle={latestCampaign ? formatTime(latestCampaign.createdAt) : "No campaigns"}>{latestCampaign ? <ResultMeters stats={latestCampaign.stats} /> : <EmptyState text="No campaign results yet" />}</Panel></div>;
}

function Setup({ state, mutate }) {
  const submit = (event) => { event.preventDefault(); mutate(postJson("/api/setup", Object.fromEntries(new FormData(event.currentTarget)), "PUT"), "Setup saved"); };
  return <div className="contentGrid twoColumns"><Panel title="Meta credentials" subtitle="Save the business number details used by WhatsApp Cloud API"><form className="formGrid" onSubmit={submit}><Input name="businessName" label="Business name" defaultValue={state.setup.businessName} /><Input name="whatsappNumber" label="WhatsApp number" defaultValue={state.setup.whatsappNumber} /><Input name="wabaId" label="WABA ID" defaultValue={state.setup.wabaId} /><Input name="phoneNumberId" label="Phone Number ID" defaultValue={state.setup.phoneNumberId} /><Input name="webhookUrl" label="Webhook URL" defaultValue={state.setup.webhookUrl} /><Input name="accessToken" label="Access token" defaultValue={state.setup.accessToken} placeholder="Paste token" /><button className="primaryAction" type="submit"><BadgeCheck size={18} /> Save</button></form></Panel><Panel title="Connection status"><div className="statusGrid"><Metric label="Mode" value={state.setup.mode} /><Metric label="WABA" value={state.setup.wabaId ? "Set" : "Missing"} /><Metric label="Phone ID" value={state.setup.phoneNumberId ? "Set" : "Missing"} /><Metric label="Token" value={state.setup.accessToken ? "Saved" : "Missing"} /></div></Panel></div>;
}

function Contacts({ state, mutate }) {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const add = (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); mutate(postJson("/api/contacts", { name: form.get("name"), phone: form.get("phone"), marketingPermission: form.get("marketingPermission") === "on" }), "Contact saved"); event.currentTarget.reset(); };
  const importRows = (event) => { event.preventDefault(); if (!csvText.trim()) return; mutate(postJson("/api/contacts/import", { csv: csvText }).then((next) => { setCsvText(""); setFileName(""); return next; }), "Contacts imported"); };
  const chooseFile = async (event) => { const file = event.target.files?.[0]; if (!file) return; setFileName(file.name); setCsvText(await file.text()); event.target.value = ""; };
  return <div className="screenGrid"><div className="contentGrid audienceGrid"><Panel title="Add contact" subtitle="Create one opted-in customer record"><form className="formGrid" onSubmit={add}><Input name="name" label="Name" placeholder="Customer name" required /><Input name="phone" label="Phone" placeholder="Phone with country code" required /><label className="checkRow"><input name="marketingPermission" type="checkbox" /> Marketing permission</label><button className="primaryAction" type="submit"><Plus size={18} /> Add contact</button></form></Panel><Panel title="Import contacts" subtitle="Upload or paste CSV columns: name, phone, permission"><form className="formGrid importForm" onSubmit={importRows}><label className="fileDrop"><input type="file" accept=".csv,text/csv" onChange={chooseFile} /><Upload size={22} /><strong>{fileName || "Choose CSV file"}</strong><span>{fileName ? "File loaded into the import box" : "You can also paste rows below"}</span></label><label>CSV rows<textarea name="csv" value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder={"name,phone,permission"}></textarea></label><div className="importMeta"><span>{csvText.trim() ? `${csvText.trim().split(/\r?\n/).length} row${csvText.trim().split(/\r?\n/).length === 1 ? "" : "s"} ready` : "No rows loaded"}</span><button className="secondaryAction" type="submit" disabled={!csvText.trim()}><Upload size={18} /> Import contacts</button></div></form></Panel></div><Panel title="Contacts" subtitle={`${state.contacts.length} total`}><DataTable headers={["Name", "Phone", "Permission", "Last message", "Actions"]}>{state.contacts.map((contact) => <tr key={contact.id}><td><strong>{contact.name}</strong></td><td>{contact.phone}</td><td><Badge kind={contact.unsubscribed ? "bad" : contact.marketingPermission ? "good" : "bad"}>{contact.unsubscribed ? "Suppressed" : contact.marketingPermission ? "Allowed" : "Blocked"}</Badge></td><td>{formatTime(contact.lastMessageAt)}</td><td className="rowActions"><button onClick={() => mutate(postJson(`/api/contacts/${contact.id}`, { marketingPermission: !contact.marketingPermission, unsubscribed: contact.marketingPermission }, "PATCH"), "Updated")}>{contact.marketingPermission ? "Suppress" : "Allow"}</button><button className="dangerText" onClick={() => mutate(postJson(`/api/contacts/${contact.id}`, {}, "DELETE"), "Removed")}>Remove</button></td></tr>)}</DataTable></Panel></div>;
}

function Templates({ state, mutate }) {
  const create = (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); mutate(postJson("/api/templates", { name: form.get("name"), body: form.get("body"), submitToMeta: true }), "Template submitted"); event.currentTarget.reset(); };
  const sync = () => mutate(postJson("/api/templates/sync", {}), "Templates synced");
  return <div className="screenGrid"><section className="actionBand"><button className="secondaryAction" type="button" onClick={sync}><RefreshCcw size={18} /> Sync from Meta</button></section><Panel title="Create template"><form className="templateComposer" onSubmit={create}><Input name="name" label="Name" placeholder="Template name" /><label>Body<textarea name="body" placeholder="Use variables like {{name}} where needed"></textarea></label><button className="primaryAction" type="submit"><MessageSquareText size={18} /> Submit</button></form></Panel><div className="cardGrid">{state.templates.map((template) => <article className="templateCard" key={template.id}><div className="cardHead"><h3>{template.name}</h3><Badge kind={template.status === "Approved" ? "good" : template.status === "Pending" ? "warn" : "bad"}>{template.status}</Badge></div><p>{template.body}</p><div className="chipRow">{template.variables.map((variable) => <span key={variable}>{`{{${variable}}}`}</span>)}</div></article>)}</div></div>;
}

function AutomationFlows({ state, mutate }) {
  const flows = state.automationFlows || [];
  const blankDefinition = JSON.stringify({ startNodeId: "", nodes: [] }, null, 2);
  const [editingId, setEditingId] = useState("");
  const [definition, setDefinition] = useState(blankDefinition);
  const [keywords, setKeywords] = useState("");
  const [formError, setFormError] = useState("");
  const editingFlow = flows.find((flow) => flow.id === editingId);

  const loadFlow = (flow) => {
    setEditingId(flow.id);
    setKeywords((flow.triggerKeywords || []).join(", "));
    setDefinition(JSON.stringify(flow.definition || { startNodeId: "", nodes: [] }, null, 2));
    setFormError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const reset = () => {
    setEditingId("");
    setKeywords("");
    setDefinition(blankDefinition);
    setFormError("");
  };

  const submit = (event) => {
    event.preventDefault();
    setFormError("");
    let parsed;
    try {
      parsed = JSON.parse(definition);
    } catch {
      setFormError("Flow definition must be valid JSON.");
      return;
    }
    const form = new FormData(event.currentTarget);
    mutate(postJson("/api/automation/flows", {
      id: editingId,
      name: form.get("name"),
      description: form.get("description"),
      status: form.get("status"),
      triggerMode: form.get("triggerMode"),
      triggerKeywords: keywords.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
      definition: parsed
    }).then(() => api("/api/state")).then((next) => {
      reset();
      return next;
    }), editingId ? "Automation flow updated" : "Automation flow saved");
  };

  const updateStatus = (flow, status) => mutate(
    postJson(`/api/automation/flows/${flow.id}`, { status }, "PATCH").then(() => api("/api/state")),
    status === "active" ? "Flow activated" : "Flow paused"
  );
  const archive = (flow) => mutate(postJson(`/api/automation/flows/${flow.id}`, {}, "DELETE").then(() => api("/api/state")), "Flow archived");
  const process = () => mutate(postJson("/api/automation/process", { limit: 25 }).then(() => api("/api/state")), "Automation queue processed");

  return <div className="screenGrid automationScreen">
    <section className="actionBand automationTopbar">
      <div>
        <strong>Conversation automation</strong>
        <span>Build tenant-specific reply flows that run from WhatsApp webhooks.</span>
      </div>
      <div className="actionCluster">
        <button className="secondaryAction" type="button" onClick={process}><RefreshCcw size={18} /> Process queue</button>
        {editingId && <button className="secondaryAction" type="button" onClick={reset}>Cancel edit</button>}
      </div>
    </section>

    <div className="automationGrid">
      <Panel title={editingId ? "Edit automation flow" : "Create automation flow"} subtitle="Every trigger, step, message, and route is stored per company.">
        <form key={editingId || "new-flow"} className="formGrid automationForm" onSubmit={submit}>
          <Input name="name" label="Flow name" placeholder="Flow name" defaultValue={editingFlow?.name || ""} required />
          <label>Description<textarea name="description" rows="3" placeholder="Internal purpose for this flow" defaultValue={editingFlow?.description || ""}></textarea></label>
          <div className="formSplit">
            <label>Status<select name="status" defaultValue={editingFlow?.status || "draft"}><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option></select></label>
            <label>Trigger mode<select name="triggerMode" defaultValue={editingFlow?.triggerMode || "keywords"}><option value="keywords">Keywords</option><option value="any_inbound">Any inbound message</option><option value="manual">Manual only</option></select></label>
          </div>
          <label>Trigger keywords<textarea rows="3" value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="Comma or line separated trigger words"></textarea></label>
          <label>Flow definition JSON<textarea className="codeTextarea" rows="16" value={definition} onChange={(event) => setDefinition(event.target.value)} spellCheck="false" placeholder="Define startNodeId and nodes as JSON"></textarea></label>
          {formError && <div className="formError" role="alert">{formError}</div>}
          <button className="primaryAction" type="submit"><Bot size={18} /> <span>{editingId ? "Update flow" : "Save flow"}</span></button>
        </form>
      </Panel>

      <Panel title="Runtime rules" subtitle="The engine chooses the next message from saved flow data.">
        <div className="flowRules">
          <div><strong>Triggers</strong><span>Keyword flows start from matching customer messages. Any-inbound flows start when no active session exists.</span></div>
          <div><strong>Routing</strong><span>Buttons, list rows, typed numbers, labels, and configured match terms can move the customer to the next node.</span></div>
          <div><strong>Capture</strong><span>Text replies can be saved into the session context and reused as variables later in the flow.</span></div>
          <div><strong>Takeover</strong><span>A handoff node stops automation so a human can continue in the inbox.</span></div>
        </div>
      </Panel>
    </div>

    <div className="flowCardGrid">
      {flows.map((flow) => <article className="templateCard flowCard" key={flow.id}>
        <div className="cardHead">
          <div><h3>{flow.name}</h3><p>{flow.description || "No description"}</p></div>
          <Badge kind={flow.status === "active" ? "good" : flow.status === "paused" ? "warn" : "neutral"}>{flow.status}</Badge>
        </div>
        <div className="statusGrid">
          <Metric label="Nodes" value={flow.nodeCount} />
          <Metric label="Active" value={flow.activeSessions} />
          <Metric label="Completed" value={flow.completedSessions} />
          <Metric label="Handoff" value={flow.handoffSessions} />
        </div>
        <div className="chipRow">{flow.triggerKeywords.map((keyword) => <span key={keyword}>{keyword}</span>)}{!flow.triggerKeywords.length && <span>{flow.triggerMode}</span>}</div>
        <div className="flowActions">
          <button className="secondaryAction" type="button" onClick={() => loadFlow(flow)}>Edit</button>
          <button className="secondaryAction" type="button" onClick={() => updateStatus(flow, flow.status === "active" ? "paused" : "active")}>{flow.status === "active" ? "Pause" : "Activate"}</button>
          <button className="secondaryAction dangerSoft" type="button" onClick={() => archive(flow)}><Trash2 size={16} /> Archive</button>
        </div>
      </article>)}
      {!flows.length && <Panel title="No automation flows"><EmptyState text="Create and activate a flow to automate replies from incoming WhatsApp messages." /></Panel>}
    </div>
  </div>;
}
function Campaigns({ approvedTemplates, marketableContacts, mutate, setActiveView }) {
  const [templateId, setTemplateId] = useState(approvedTemplates[0]?.id || "");
  const [variables, setVariables] = useState({});
  useEffect(() => {
    if (!templateId && approvedTemplates[0]?.id) setTemplateId(approvedTemplates[0].id);
    if (templateId && !approvedTemplates.some((item) => item.id === templateId)) setTemplateId(approvedTemplates[0]?.id || "");
  }, [approvedTemplates, templateId]);
  const template = approvedTemplates.find((item) => item.id === templateId) || approvedTemplates[0];
  const previewContact = marketableContacts[0] || null;
  const editableVariables = (template?.variables || []).filter((variable) => variable !== "name");
  const preview = template ? renderPreview(template.body, previewContact, variables) : "Select an approved template first.";
  const setVariable = (key, value) => setVariables((current) => ({ ...current, [key]: value }));
  const submit = async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { await postJson("/api/campaigns", { name: form.get("name"), templateId: form.get("templateId"), variables, contactIds: form.getAll("contactIds") }); const next = await postJson("/api/campaigns/process", { limit: 25 }); await mutate(Promise.resolve(next), "Campaign queued and processed"); setActiveView("results"); } catch (error) { mutate(Promise.reject(error)); } };
  return <div className="campaignLayout"><Panel title="Campaign"><form className="formGrid" onSubmit={submit}><Input name="name" label="Name" placeholder="Campaign name" /><label>Template<select name="templateId" value={template?.id || ""} onChange={(event) => { setTemplateId(event.target.value); setVariables({}); }} disabled={!approvedTemplates.length}><option value="">{approvedTemplates.length ? "Choose template" : "No approved templates available"}</option>{approvedTemplates.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{!approvedTemplates.length && <EmptyState text="Create a template and wait for Meta approval before sending campaigns" />}{editableVariables.map((variable) => <label key={variable}>{variable}<input value={variables[variable] || ""} onChange={(event) => setVariable(variable, event.target.value)} placeholder={`Value for {{${variable}}}`} /></label>)}<div className="recipientBox">{marketableContacts.map((contact) => <label key={contact.id}><span>{contact.name}<small>{contact.phone}</small></span><input name="contactIds" value={contact.id} type="checkbox" /></label>)}{!marketableContacts.length && <EmptyState text="No eligible contacts" />}</div><button className="primaryAction" type="submit" disabled={!approvedTemplates.length || !marketableContacts.length}><Send size={18} /> Send</button></form></Panel><Panel title="Preview"><div className="phonePreview"><div className="waBubble">{preview}</div></div></Panel></div>;
}

function Results({ state, mutate }) {
  const processQueue = () => mutate(postJson("/api/campaigns/process", { limit: 25 }), "Queue processed");
  return <div className="screenGrid"><section className="actionBand"><button className="secondaryAction" type="button" onClick={processQueue}><RefreshCcw size={18} /> Process queue</button></section>{state.campaigns.map((campaign) => <Panel key={campaign.id} title={campaign.name} subtitle={formatTime(campaign.createdAt)}><ResultMeters stats={campaign.stats} /><DataTable headers={["Customer", "Status", "Message"]}>{campaign.recipients.map((recipient) => { const contact = state.contacts.find((item) => item.id === recipient.contactId) || {}; return <tr key={recipient.id || recipient.metaMessageId}><td><strong>{contact.name || "Unknown"}</strong></td><td><Badge kind={recipient.status === "failed" ? "bad" : recipient.status === "queued" ? "warn" : "good"}>{recipient.status}</Badge></td><td><span>{recipient.message}</span>{recipient.errorMessage && <small className="errorLine">{recipient.errorMessage}</small>}</td></tr>; })}</DataTable></Panel>)}{!state.campaigns.length && <Panel title="No results"><EmptyState text="No campaigns yet" /></Panel>}</div>;
}

function InboxView({ state, activeConversation, activeContact, approvedTemplates, setActiveConversationId, mutate }) {
  const reply = (event) => { event.preventDefault(); const body = new FormData(event.currentTarget).get("body"); if (!activeContact) return; mutate(postJson("/api/messages/reply", { contactId: activeContact.id, body }), "Sent"); event.currentTarget.reset(); };
  const templateReply = (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const template = approvedTemplates.find((item) => item.id === form.get("templateId")); const variables = Object.fromEntries((template?.variables || []).filter((variable) => variable !== "name").map((variable) => [variable, form.get(variable)])); if (!activeContact) return; mutate(postJson("/api/messages/template-reply", { contactId: activeContact.id, templateId: form.get("templateId"), variables }), "Sent"); };
  const templateForReply = approvedTemplates[0];
  const replyVariables = (templateForReply?.variables || []).filter((variable) => variable !== "name");
  return <section className="inboxShell"><aside className="threadList">{state.conversations.map((conversation) => { const contact = state.contacts.find((item) => item.id === conversation.contactId) || {}; const latest = conversation.messages.at(-1); return <button key={conversation.id} className={conversation.id === activeConversation?.id ? "active" : ""} onClick={() => setActiveConversationId(conversation.id)}><strong>{contact.name}</strong><span>{latest?.body}</span></button>; })}</aside><div className="threadPane">{activeConversation && activeContact ? <><header><strong>{activeContact.name}</strong><Badge kind={activeConversation.canReply ? "good" : "warn"}>{activeConversation.canReply ? "Open" : "Template"}</Badge></header><div className="messages">{activeConversation.messages.map((message) => <div key={message.id} className={`bubble ${message.direction}`}><p>{message.body}</p><small>{formatTime(message.at)}</small></div>)}</div><form className="composer" onSubmit={reply}><textarea name="body" disabled={!activeConversation.canReply} placeholder={activeConversation.canReply ? "Message" : "Template required"}></textarea><button className="primaryAction" disabled={!activeConversation.canReply}><Send size={18} /> Send</button></form>{!activeConversation.canReply && <form className="composer templateLine" onSubmit={templateReply}><select name="templateId">{approvedTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>{replyVariables.map((variable) => <input key={variable} name={variable} placeholder={`{{${variable}}}`} />)}<button className="secondaryAction" disabled={!approvedTemplates.length}>Send</button></form>}</> : <EmptyState text="No conversations" />}</div></section>;
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
function DataTable({ headers, children }) {
  const rows = Children.map(children, (row) => {
    if (!isValidElement(row)) return row;
    const cells = Children.map(row.props.children, (cell, index) => isValidElement(cell) ? cloneElement(cell, { "data-label": headers[index] || "" }) : cell);
    return cloneElement(row, {}, cells);
  });
  return <div className="tableWrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>;
}
function ResultMeters({ stats }) { return <div className="meterGrid"><Metric label="Total" value={stats.total} /><Metric label="Queued" value={stats.queued} /><Metric label="Sent" value={stats.sent} /><Metric label="Delivered" value={stats.delivered} /><Metric label="Read" value={stats.read} /><Metric label="Failed" value={stats.failed} /></div>; }
