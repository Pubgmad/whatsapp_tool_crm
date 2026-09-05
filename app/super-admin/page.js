"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity, BadgeCheck, Ban, Building2, Eye,
  EyeOff, Loader2, LockKeyhole, LogOut, RefreshCcw, Search, ShieldCheck,
  SlidersHorizontal, WalletCards, Wifi, WifiOff, X
} from "lucide-react";

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

export default function SuperAdminPage() {
  const [admin, setAdmin] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => { bootstrap(); }, []);

  const notify = (message) => { setNotice(message); window.setTimeout(() => setNotice(""), 2600); };

  const bootstrap = async () => {
    try {
      setLoading(true);
      const me = await api("/api/super-admin/me");
      setAdmin(me.admin);
      setDashboard(await api("/api/super-admin/dashboard"));
    } catch {
      setAdmin(null);
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    try {
      setDashboard(await api("/api/super-admin/dashboard"));
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
  };

  const openCompany = async (company) => {
    try { setSelected(await api(`/api/super-admin/companies/${company.id}`)); }
    catch (error) { notify(error.message); }
  };

  const updateCompany = async (companyId, action) => {
    try {
      const detail = await postJson(`/api/super-admin/companies/${companyId}/status`, { action }, "PATCH");
      setSelected(detail);
      setDashboard(await api("/api/super-admin/dashboard"));
      notify(action === "activate" ? "Company activated" : "Company suspended");
    } catch (error) {
      notify(error.message);
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
      <div className="superBrand"><span><ShieldCheck size={22} /></span><div><strong>Mathstrat</strong><small>SaaS Control</small></div></div>
      <nav className="superNav" aria-label="Super Admin sections">
        <a href="#overview"><Activity size={17} />Overview</a>
        <a href="#companies"><Building2 size={17} />Companies</a>
        <a href="#plans"><WalletCards size={17} />Plans</a>
      </nav>
      <div className="superAdminCard"><small>Signed in as</small><strong>{admin.email}</strong><button type="button" onClick={logout}><LogOut size={16} />Sign out</button></div>
    </aside>

    <section className="superWorkspace">
      <header className="superHero" id="overview">
        <div>
          <p className="kicker">Super Admin</p>
          <h1>Platform command center</h1>
          <p>Monitor registered companies, subscriptions, WhatsApp readiness, usage volume, and account status without exposing customer conversations.</p>
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
        <Panel title="Plans" subtitle="Data-driven plan catalogue">
          <div className="planGrid">{dashboard.planStats.map((plan) => <article key={plan.code}><strong>{plan.name}</strong><span>{money(plan.priceCents, plan.currency)} / {plan.interval}</span><small>{plan.subscribers} subscriber{plan.subscribers === 1 ? "" : "s"}</small></article>)}</div>
        </Panel>
      </section>

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
      await postJson("/api/super-admin/login", Object.fromEntries(new FormData(event.currentTarget)));
      await onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return <main className="superAuthShell"><section className="superAuthPanel"><div className="superBrand dark"><span><LockKeyhole size={22} /></span><div><strong>Mathstrat</strong><small>Super Admin</small></div></div><div><p className="kicker">Platform owner access</p><h1>Sign in</h1><p>Use the secure admin credentials configured on the server.</p></div><form className="formGrid" onSubmit={submit}><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Password<span className="passwordWrap"><input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" minLength="8" required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>{error && <div className="formError" role="alert">{error}</div>}<button className="primaryAction" type="submit" disabled={pending}>{pending ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}<span>{pending ? "Checking" : "Sign in"}</span></button></form></section></main>;
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
  const className = kind === "active" ? "good" : kind === "suspended" ? "bad" : "warn";
  return <span className={`badge ${className}`}>{children}</span>;
}

function Empty({ text }) {
  return <div className="emptyState"><Activity size={18} /><span>{text}</span></div>;
}
