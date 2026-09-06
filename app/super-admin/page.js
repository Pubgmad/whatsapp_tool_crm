"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity, BadgeCheck, Ban, Building2, Eye, EyeOff, FileText, Loader2, LockKeyhole,
  LogOut, Pencil, Plus, RefreshCcw, Save, Search, ShieldCheck, SlidersHorizontal,
  Trash2, WalletCards, Wifi, WifiOff, X
} from "lucide-react";

const emptyPlan = {
  id: "",
  code: "",
  name: "",
  description: "",
  currency: "INR",
  monthlyPrice: "",
  yearlyPrice: "",
  trialDays: "0",
  contactLimit: "",
  campaignLimit: "",
  userLimit: "",
  automationFlowLimit: "",
  monthlyMessageLimit: "",
  whatsappConversationLimit: "",
  features: "",
  displayOrder: "0",
  visible: true,
  isActive: true
};

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
const formatDate = (iso) => iso ? new Date(iso).toLocaleDateString([], { dateStyle: "medium" }) : "Not set";
const formatTime = (iso) => iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never";
const money = (cents, currency) => new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format((Number(cents) || 0) / 100);
const rupees = (cents) => cents ? String(Number(cents) / 100) : "";
const cents = (value) => Math.round((Number(value) || 0) * 100);
const optionalNumber = (value) => value === "" || value === null || value === undefined ? null : Number(value);

export default function SuperAdminPage() {
  const [admin, setAdmin] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [plans, setPlans] = useState([]);
  const [settings, setSettings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => { bootstrap(); }, []);

  const notify = (message) => { setNotice(message); window.setTimeout(() => setNotice(""), 2600); };

  const loadPlatformData = async () => {
    const [nextDashboard, planPayload, settingPayload] = await Promise.all([
      api("/api/super-admin/dashboard"),
      api("/api/super-admin/plans"),
      api("/api/super-admin/settings")
    ]);
    setDashboard(nextDashboard);
    setPlans(planPayload.plans || []);
    setSettings(settingPayload.settings || []);
  };

  const bootstrap = async () => {
    try {
      setLoading(true);
      const me = await api("/api/super-admin/me");
      setAdmin(me.admin);
      await loadPlatformData();
    } catch {
      setAdmin(null);
      setDashboard(null);
      setPlans([]);
      setSettings([]);
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    try {
      await loadPlatformData();
      if (selected?.company?.id) setSelected(await api(`/api/super-admin/companies/${selected.company.id}`));
      notify("Dashboard refreshed");
    } catch (error) {
      notify(error.message);
    }
  };

  const logout = async () => {
    await postJson("/api/super-admin/logout", {});
    setAdmin(null);
    setDashboard(null);
    setSelected(null);
    setPlans([]);
    setSettings([]);
  };

  const openCompany = async (company) => {
    try { setSelected(await api(`/api/super-admin/companies/${company.id}`)); }
    catch (error) { notify(error.message); }
  };

  const updateCompany = async (companyId, action) => {
    try {
      const detail = await postJson(`/api/super-admin/companies/${companyId}/status`, { action }, "PATCH");
      setSelected(detail);
      await loadPlatformData();
      notify(action === "activate" ? "Company activated" : "Company suspended");
    } catch (error) {
      notify(error.message);
    }
  };

  const savePlan = async (payload, planId = "") => {
    try {
      await postJson(planId ? `/api/super-admin/plans/${planId}` : "/api/super-admin/plans", payload, planId ? "PUT" : "POST");
      await loadPlatformData();
      notify(planId ? "Plan updated" : "Plan created");
    } catch (error) {
      notify(error.message);
      throw error;
    }
  };

  const deletePlan = async (plan) => {
    try {
      await api(`/api/super-admin/plans/${plan.id}`, { method: "DELETE" });
      await loadPlatformData();
      notify(plan.subscribers > 0 ? "Plan hidden and deactivated" : "Plan deleted");
    } catch (error) {
      notify(error.message);
    }
  };

  const saveSetting = async (setting) => {
    try {
      await postJson("/api/super-admin/settings", setting);
      setSettings((await api("/api/super-admin/settings")).settings || []);
      notify("Platform content saved");
    } catch (error) {
      notify(error.message);
      throw error;
    }
  };

  const companies = useMemo(() => {
    const rows = dashboard?.companies || [];
    return rows.filter((company) => {
      const matchesText = [company.name, company.email, company.planName, company.subscriptionStatus].join(" ").toLowerCase().includes(query.toLowerCase());
      const matchesStatus = statusFilter === "all" || company.accountStatus === statusFilter;
      return matchesText && matchesStatus;
    });
  }, [dashboard, query, statusFilter]);

  if (loading) return <main className="superLoading"><ShieldCheck size={30} /><span>Checking platform access</span></main>;
  if (!admin) return <SuperAdminLogin onDone={bootstrap} />;
  if (!dashboard) return <main className="superLoading"><Loader2 className="spin" size={30} /><span>Loading platform data</span></main>;

  return <main className="superShell">
    <aside className="superRail">
      <div className="superBrand"><span><ShieldCheck size={22} /></span><div><strong>Mathstrat</strong><small>Super Admin</small></div></div>
      <nav className="superNav" aria-label="Super Admin sections">
        <a href="#overview"><Activity size={17} />Overview</a>
        <a href="#plans"><WalletCards size={17} />Plans</a>
        <a href="#content"><FileText size={17} />Content</a>
        <a href="#companies"><Building2 size={17} />Companies</a>
      </nav>
      <div className="superAdminCard"><small>Signed in as</small><strong>{admin.email}</strong><button type="button" onClick={logout}><LogOut size={16} />Sign out</button></div>
    </aside>

    <section className="superWorkspace">
      <header className="superHero" id="overview">
        <div>
          <p className="kicker">Super Admin</p>
          <h1>Platform command center</h1>
          <p>Control companies, subscriptions, plans, public business content, WhatsApp readiness, and platform status from one owner-only workspace.</p>
        </div>
        <button className="iconButton" type="button" onClick={refresh} title="Refresh"><RefreshCcw size={18} /></button>
      </header>

      {notice && <div className="toast">{notice}</div>}

      <section className="superMetrics" aria-label="Platform metrics">
        <Metric icon={Building2} label="Companies" value={dashboard.summary.totalCompanies} note={`${dashboard.summary.activeCompanies} active`} />
        <Metric icon={BadgeCheck} label="Active" value={dashboard.summary.activeCompanies} note={`${dashboard.summary.pendingCompanies} pending`} />
        <Metric icon={Ban} label="Suspended" value={dashboard.summary.suspendedCompanies} note="Blocked platform access" />
        <Metric icon={Wifi} label="WhatsApp ready" value={dashboard.summary.whatsappConnected} note="Connected workspaces" />
      </section>

      <section className="superGrid" id="plans">
        <Panel title="Subscription mix" subtitle="Live counts by billing state">
          <div className="statusStack">{dashboard.subscriptionStats.map((item) => <div key={item.status}><span>{item.status}</span><strong>{item.count}</strong></div>)}{!dashboard.subscriptionStats.length && <Empty text="No subscription records yet" />}</div>
        </Panel>
        <Panel title="Plan catalogue" subtitle="Super Admin controlled pricing, features, limits, visibility, and activation">
          <div className="planGrid">{plans.map((plan) => <PlanCard key={plan.id} plan={plan} onDelete={deletePlan} />)}{!plans.length && <Empty text="No plans configured yet" />}</div>
        </Panel>
      </section>

      <PlanManager plans={plans} onSave={savePlan} />
      <ContentManager settings={settings} onSave={saveSetting} />

      <Panel title="Companies" subtitle="Tenant-level monitoring and controls" id="companies">
        <div className="companyToolbar">
          <label className="searchBox"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, email, plan" /></label>
          <label className="filterBox"><SlidersHorizontal size={17} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option></select></label>
        </div>
        <div className="companyList">{companies.map((company) => <CompanyRow key={company.id} company={company} onOpen={() => openCompany(company)} />)}{!companies.length && <Empty text="No companies match this view" />}</div>
      </Panel>
    </section>

    {selected && <CompanyDrawer detail={selected} onClose={() => setSelected(null)} onAction={updateCompany} />}
  </main>;
}

function SuperAdminLogin({ onDone }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const rawForm = Object.fromEntries(new FormData(event.currentTarget));
      await postJson("/api/super-admin/login", { email: rawForm.platformOwnerEmail, password: rawForm.platformOwnerSecret });
      await onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return <main className="superAuthShell"><section className="superAuthPanel"><div className="superBrand dark"><span><LockKeyhole size={22} /></span><div><strong>Mathstrat</strong><small>Super Admin</small></div></div><div><p className="kicker">Platform owner access</p><h1>Sign in</h1><p>Use the secure admin credentials configured on the server.</p></div><form className="formGrid" onSubmit={submit}><label>Email<input name="platformOwnerEmail" type="email" autoComplete="off" data-lpignore="true" data-form-type="other" required /></label><label>Password<span className="passwordWrap"><input name="platformOwnerSecret" type={showPassword ? "text" : "password"} autoComplete="new-password" data-lpignore="true" data-form-type="other" minLength="8" required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>{error && <div className="formError" role="alert">{error}</div>}<button className="primaryAction" type="submit" disabled={pending}>{pending ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}<span>{pending ? "Checking" : "Sign in"}</span></button></form></section></main>;
}

function PlanManager({ plans, onSave }) {
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(emptyPlan);
  const editing = plans.find((plan) => plan.id === editingId);

  const edit = (plan) => {
    setEditingId(plan.id);
    setForm(planToForm(plan));
  };

  const reset = () => {
    setEditingId("");
    setForm(emptyPlan);
  };

  const submit = async (event) => {
    event.preventDefault();
    const payload = formToPlanPayload(form);
    await onSave(payload, editing?.id || "");
    reset();
  };

  return <Panel title={editing ? "Edit subscription plan" : "Create subscription plan"} subtitle="Changes are stored in PostgreSQL and reflected wherever plans are read." id="plan-editor">
    <form className="planEditor" onSubmit={submit}>
      <div className="formSplit"><Input label="Plan code" value={form.code} onChange={(event) => setFormValue(setForm, "code", event.target.value)} placeholder="professional" required /><Input label="Plan name" value={form.name} onChange={(event) => setFormValue(setForm, "name", event.target.value)} placeholder="Plan name" required /></div>
      <label>Description<textarea rows="3" value={form.description} onChange={(event) => setFormValue(setForm, "description", event.target.value)} placeholder="Short customer-facing plan description"></textarea></label>
      <div className="formQuad"><Input label="Currency" value={form.currency} onChange={(event) => setFormValue(setForm, "currency", event.target.value.toUpperCase())} /><Input label="Monthly price" type="number" min="0" step="0.01" value={form.monthlyPrice} onChange={(event) => setFormValue(setForm, "monthlyPrice", event.target.value)} /><Input label="Yearly price" type="number" min="0" step="0.01" value={form.yearlyPrice} onChange={(event) => setFormValue(setForm, "yearlyPrice", event.target.value)} /><Input label="Trial days" type="number" min="0" value={form.trialDays} onChange={(event) => setFormValue(setForm, "trialDays", event.target.value)} /></div>
      <div className="formQuad"><Input label="Contacts" type="number" min="0" value={form.contactLimit} onChange={(event) => setFormValue(setForm, "contactLimit", event.target.value)} /><Input label="Campaigns/month" type="number" min="0" value={form.campaignLimit} onChange={(event) => setFormValue(setForm, "campaignLimit", event.target.value)} /><Input label="Users" type="number" min="0" value={form.userLimit} onChange={(event) => setFormValue(setForm, "userLimit", event.target.value)} /><Input label="Automation flows" type="number" min="0" value={form.automationFlowLimit} onChange={(event) => setFormValue(setForm, "automationFlowLimit", event.target.value)} /></div>
      <div className="formSplit"><Input label="Messages/month" type="number" min="0" value={form.monthlyMessageLimit} onChange={(event) => setFormValue(setForm, "monthlyMessageLimit", event.target.value)} /><Input label="WhatsApp conversations" type="number" min="0" value={form.whatsappConversationLimit} onChange={(event) => setFormValue(setForm, "whatsappConversationLimit", event.target.value)} /></div>
      <label>Features<textarea rows="5" value={form.features} onChange={(event) => setFormValue(setForm, "features", event.target.value)} placeholder="One feature per line"></textarea></label>
      <div className="formQuad"><Input label="Display order" type="number" value={form.displayOrder} onChange={(event) => setFormValue(setForm, "displayOrder", event.target.value)} /><label className="checkRow"><input type="checkbox" checked={form.visible} onChange={(event) => setFormValue(setForm, "visible", event.target.checked)} /> Visible</label><label className="checkRow"><input type="checkbox" checked={form.isActive} onChange={(event) => setFormValue(setForm, "isActive", event.target.checked)} /> Active</label><div className="formActions"><button className="primaryAction" type="submit"><Save size={17} /> {editing ? "Update plan" : "Create plan"}</button>{editing && <button className="secondaryAction" type="button" onClick={reset}>Cancel</button>}</div></div>
    </form>
    <div className="editablePlanList">{plans.map((plan) => <button type="button" key={plan.id} onClick={() => edit(plan)} className={editingId === plan.id ? "active" : ""}><Pencil size={16} /><span>{plan.name}</span><small>{money(plan.monthlyPriceCents, plan.currency)} monthly</small></button>)}</div>
  </Panel>;
}

function ContentManager({ settings, onSave }) {
  const groups = useMemo(() => settings.reduce((acc, setting) => ({ ...acc, [setting.category]: [...(acc[setting.category] || []), setting] }), {}), [settings]);
  return <Panel title="Platform content" subtitle="Public business copy and labels controlled by Super Admin" id="content">
    <div className="settingsGrid">
      {Object.entries(groups).map(([category, rows]) => <section className="settingGroup" key={category}><h3>{category.replace(/_/g, " ")}</h3>{rows.map((setting) => <SettingForm setting={setting} key={setting.key} onSave={onSave} />)}</section>)}
      {!settings.length && <Empty text="No platform settings found. Run the database initializer." />}
    </div>
  </Panel>;
}

function SettingForm({ setting, onSave }) {
  const [value, setValue] = useState(setting.value ?? "");
  const [pending, setPending] = useState(false);
  const isLong = setting.valueType === "rich_text" || setting.valueType === "json";
  const submit = async (event) => {
    event.preventDefault();
    setPending(true);
    try {
      await onSave({ ...setting, value });
    } finally {
      setPending(false);
    }
  };
  return <form className="settingRow" onSubmit={submit}>
    <label>{setting.label}{isLong ? <textarea rows="3" value={typeof value === "string" ? value : JSON.stringify(value, null, 2)} onChange={(event) => setValue(event.target.value)} /> : <input value={typeof value === "string" || typeof value === "number" ? value : JSON.stringify(value)} onChange={(event) => setValue(event.target.value)} />}</label>
    <button className="secondaryAction" type="submit" disabled={pending}><Save size={15} /> Save</button>
  </form>;
}

function PlanCard({ plan, onDelete }) {
  return <article className="planTile">
    <header><div><strong>{plan.name}</strong><small>{plan.code}</small></div><Badge kind={plan.isActive ? "active" : "suspended"}>{plan.isActive ? "active" : "inactive"}</Badge></header>
    <p>{plan.description || "No description"}</p>
    <div className="planPrices"><span>{money(plan.monthlyPriceCents, plan.currency)} monthly</span><span>{plan.yearlyPriceCents ? `${money(plan.yearlyPriceCents, plan.currency)} yearly` : "No yearly price"}</span></div>
    <div className="chipRow">{plan.features.slice(0, 4).map((feature) => <span key={feature}>{feature}</span>)}{!plan.features.length && <span>No features listed</span>}</div>
    <div className="planMeta"><small>{plan.subscribers} subscribers</small><small>{plan.visible ? "Visible" : "Hidden"}</small></div>
    <button className="secondaryAction dangerSoft" type="button" onClick={() => onDelete(plan)}><Trash2 size={16} /> Delete</button>
  </article>;
}

function setFormValue(setForm, key, value) {
  setForm((current) => ({ ...current, [key]: value }));
}

function planToForm(plan) {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description || "",
    currency: plan.currency || "INR",
    monthlyPrice: rupees(plan.monthlyPriceCents),
    yearlyPrice: rupees(plan.yearlyPriceCents),
    trialDays: String(plan.trialDays || 0),
    contactLimit: plan.limits.contacts ?? "",
    campaignLimit: plan.limits.campaigns ?? "",
    userLimit: plan.limits.users ?? "",
    automationFlowLimit: plan.limits.automationFlows ?? "",
    monthlyMessageLimit: plan.limits.messages ?? "",
    whatsappConversationLimit: plan.limits.whatsappConversations ?? "",
    features: (plan.features || []).join("\n"),
    displayOrder: String(plan.displayOrder || 0),
    visible: plan.visible,
    isActive: plan.isActive
  };
}

function formToPlanPayload(form) {
  return {
    code: form.code,
    name: form.name,
    description: form.description,
    currency: form.currency,
    monthlyPriceCents: cents(form.monthlyPrice),
    yearlyPriceCents: cents(form.yearlyPrice),
    trialDays: optionalNumber(form.trialDays) || 0,
    contactLimit: optionalNumber(form.contactLimit),
    campaignLimit: optionalNumber(form.campaignLimit),
    userLimit: optionalNumber(form.userLimit),
    automationFlowLimit: optionalNumber(form.automationFlowLimit),
    monthlyMessageLimit: optionalNumber(form.monthlyMessageLimit),
    whatsappConversationLimit: optionalNumber(form.whatsappConversationLimit),
    features: form.features.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    displayOrder: optionalNumber(form.displayOrder) || 0,
    visible: form.visible,
    isActive: form.isActive
  };
}

function Metric({ icon: Icon, label, value, note }) {
  return <article className="superMetric"><Icon size={20} /><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function Panel({ title, subtitle, children, id }) {
  return <section className="superPanel" id={id}><div className="panelHead"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>{children}</section>;
}

function CompanyRow({ company, onOpen }) {
  return <button className="companyRow" type="button" onClick={onOpen}>
    <div className="companyMain"><span className="companyAvatar">{company.name.slice(0, 1).toUpperCase()}</span><div><strong>{company.name}</strong><small>{company.email || "No owner email"}</small></div></div>
    <Badge kind={company.accountStatus}>{company.accountStatus}</Badge>
    <div><strong>{company.planName}</strong><small>{company.subscriptionStatus}</small></div>
    <div><strong>{company.userCount}</strong><small>users</small></div>
    <div><strong>{company.contactCount}</strong><small>contacts</small></div>
    <div>{company.whatsappStatus === "Connected" ? <Wifi size={18} /> : <WifiOff size={18} />}<small>{company.whatsappStatus}</small></div>
    <div><strong>{formatTime(company.lastActivityAt)}</strong><small>last activity</small></div>
  </button>;
}

function CompanyDrawer({ detail, onClose, onAction }) {
  const company = detail.company;
  return <aside className="companyDrawer" aria-label="Company details">
    <div className="drawerPanel"><header><div><p className="kicker">Company</p><h2>{company.name}</h2><small>{company.email || "No owner email"}</small></div><button className="iconButton" type="button" onClick={onClose} title="Close"><X size={18} /></button></header>
      <div className="drawerActions"><button className="secondaryAction" type="button" onClick={() => onAction(company.id, "activate")}><BadgeCheck size={17} />Activate</button><button className="secondaryAction dangerSoft" type="button" onClick={() => onAction(company.id, "suspend")}><Ban size={17} />Suspend</button></div>
      <section className="detailGrid"><Info label="Account" value={company.accountStatus} /><Info label="Subscription" value={company.subscriptionStatus} /><Info label="Plan" value={company.planName} /><Info label="Payment" value={company.paymentStatus} /><Info label="Registered" value={formatDate(company.registeredAt)} /><Info label="Renewal" value={formatDate(company.renewalAt)} /><Info label="Trial ends" value={formatDate(company.trialEndsAt)} /><Info label="WhatsApp" value={company.whatsappStatus} /><Info label="Business number" value={company.whatsappNumber || "Not connected"} /><Info label="Users" value={company.userCount} /><Info label="Contacts" value={company.contactCount} /><Info label="Campaigns" value={company.campaignCount} /></section>
      <section><h3>Company users</h3><div className="miniList">{detail.users.map((user) => <div key={user.id}><strong>{user.name}</strong><span>{user.email}</span><small>{user.role}</small></div>)}</div></section>
      <section><h3>Recent platform activity</h3><div className="miniList">{detail.recentActivity.map((item, index) => <div key={`${item.type}-${index}`}><strong>{item.type}</strong><span>{formatTime(item.at)}</span></div>)}{!detail.recentActivity.length && <Empty text="No activity recorded" />}</div></section>
    </div>
  </aside>;
}

function Info({ label, value }) {
  return <div className="infoTile"><span>{label}</span><strong>{value}</strong></div>;
}

function Badge({ kind, children }) {
  const className = kind === "active" ? "good" : kind === "suspended" ? "bad" : kind === "inactive" ? "bad" : "warn";
  return <span className={`badge ${className}`}>{children}</span>;
}

function Input({ label, ...props }) {
  return <label>{label}<input {...props} /></label>;
}

function Empty({ text }) {
  return <div className="emptyState"><Activity size={18} /><span>{text}</span></div>;
}