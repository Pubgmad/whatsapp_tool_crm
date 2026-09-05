import crypto from "crypto";
import { hashPassword, normalizeEmail, parseCookies, verifyPassword } from "./auth";
import { AppError, id, json, query, toIso, transaction } from "./db";

const SUPER_COOKIE_NAME = "wcrm_super_session";
const SUPER_SESSION_SECONDS = 60 * 60 * 8;

function superSecret() {
  const value = process.env.SUPER_ADMIN_SESSION_SECRET || process.env.AUTH_SECRET;
  if (!value || value.startsWith("replace-with")) {
    throw new AppError("Super Admin session secret is not configured.", 503, "SUPER_ADMIN_SECRET_NOT_CONFIGURED");
  }
  return value;
}

function clean(value) {
  return String(value || "").trim();
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", superSecret()).update(value).digest("base64url");
}

function createSuperSessionToken(payload) {
  const body = base64url(JSON.stringify({
    superAdminId: payload.superAdminId,
    role: "SuperAdmin",
    exp: Math.floor(Date.now() / 1000) + SUPER_SESSION_SECONDS
  }));
  return `${body}.${sign(body)}`;
}

function verifySuperSessionToken(token) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature || sign(body) !== signature) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (payload.role !== "SuperAdmin" || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function superSessionCookie(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SUPER_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SUPER_SESSION_SECONDS}${secure}`;
}

export function clearSuperSessionCookie() {
  return `${SUPER_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function ensureConfiguredSuperAdmin() {
  const email = normalizeEmail(process.env.SUPER_ADMIN_EMAIL);
  const password = String(process.env.SUPER_ADMIN_PASSWORD || "");
  if (!email || !password) return;
  if (password.length < 8) throw new AppError("SUPER_ADMIN_PASSWORD must be at least 8 characters.", 503, "SUPER_ADMIN_NOT_CONFIGURED");

  const existing = await query("SELECT id FROM super_admins WHERE email = $1", [email]);
  if (existing.rows[0]) return;

  await query(
    "INSERT INTO super_admins (id, email, password_hash, active) VALUES ($1, $2, $3, TRUE)",
    [id("sa"), email, hashPassword(password)]
  );
}

export async function loginSuperAdmin({ email, password }) {
  await ensureConfiguredSuperAdmin();
  const cleanEmail = normalizeEmail(email);
  const result = await query("SELECT id, email, password_hash, active FROM super_admins WHERE email = $1 LIMIT 1", [cleanEmail]);
  const admin = result.rows[0];
  if (!admin || !admin.active || !verifyPassword(password, admin.password_hash)) {
    throw new AppError("Invalid Super Admin credentials.", 401, "SUPER_ADMIN_INVALID_CREDENTIALS");
  }
  await query("UPDATE super_admins SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1", [admin.id]);
  return { token: createSuperSessionToken({ superAdminId: admin.id }), admin: mapSuperAdmin(admin) };
}

export async function requireSuperAdmin(request) {
  const token = parseCookies(request)[SUPER_COOKIE_NAME];
  const session = verifySuperSessionToken(token);
  if (!session) throw new AppError("Super Admin sign in required.", 401, "SUPER_ADMIN_AUTH_REQUIRED");

  const result = await query("SELECT id, name, email, active, last_login_at, created_at FROM super_admins WHERE id = $1 LIMIT 1", [session.superAdminId]);
  const admin = result.rows[0];
  if (!admin || !admin.active) throw new AppError("Super Admin access is disabled.", 403, "SUPER_ADMIN_FORBIDDEN");
  return mapSuperAdmin(admin);
}

export async function getSuperAdminMe(request) {
  const admin = await requireSuperAdmin(request);
  return json({ admin });
}

export async function getSuperAdminDashboard(request) {
  await requireSuperAdmin(request);
  const [summary, subscriptionStats, planStats, companies] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE account_status = 'active')::int AS active,
              COUNT(*) FILTER (WHERE account_status = 'suspended')::int AS suspended,
              COUNT(*) FILTER (WHERE account_status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE status = 'Connected')::int AS whatsapp_connected
       FROM businesses`
    ),
    query("SELECT COALESCE(status, 'pending') AS status, COUNT(*)::int AS count FROM business_subscriptions GROUP BY status ORDER BY status"),
    query(
      `SELECT sp.code, sp.name, sp.billing_interval, sp.price_cents, sp.currency, COUNT(bs.id)::int AS subscribers
       FROM subscription_plans sp
       LEFT JOIN business_subscriptions bs ON bs.plan_id = sp.id
       GROUP BY sp.id
       ORDER BY sp.price_cents ASC`
    ),
    query(companyListQuery())
  ]);

  return json({
    summary: {
      totalCompanies: summary.rows[0]?.total || 0,
      activeCompanies: summary.rows[0]?.active || 0,
      suspendedCompanies: summary.rows[0]?.suspended || 0,
      pendingCompanies: summary.rows[0]?.pending || 0,
      whatsappConnected: summary.rows[0]?.whatsapp_connected || 0
    },
    subscriptionStats: subscriptionStats.rows.map((row) => ({ status: row.status, count: row.count })),
    planStats: planStats.rows.map(mapPlan),
    companies: companies.rows.map(mapCompanyRow),
    generatedAt: new Date().toISOString()
  });
}

export async function getSuperAdminCompany(request, context) {
  await requireSuperAdmin(request);
  const params = await context.params;
  const result = await query(`${companyListQuery()} WHERE b.id = $1`, [params.id]);
  const company = result.rows[0];
  if (!company) throw new AppError("Company not found.", 404, "COMPANY_NOT_FOUND");

  const [users, events, billing] = await Promise.all([
    query(
      `SELECT u.id, u.name, u.email, m.role, m.created_at
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.business_id = $1
       ORDER BY m.created_at ASC`,
      [params.id]
    ),
    query("SELECT type, at FROM events WHERE business_id = $1 ORDER BY at DESC LIMIT 12", [params.id]),
    query("SELECT event_type, amount_cents, currency, provider, at FROM billing_events WHERE business_id = $1 ORDER BY at DESC LIMIT 12", [params.id])
  ]);

  return json({
    company: mapCompanyRow(company),
    users: users.rows.map((row) => ({ id: row.id, name: row.name, email: row.email, role: row.role, joinedAt: toIso(row.created_at) })),
    recentActivity: events.rows.map((row) => ({ type: row.type, at: toIso(row.at) })),
    billingEvents: billing.rows.map((row) => ({ type: row.event_type, amountCents: row.amount_cents, currency: row.currency, provider: row.provider, at: toIso(row.at) }))
  });
}

export async function updateCompanyStatus(request, context) {
  const admin = await requireSuperAdmin(request);
  const params = await context.params;
  const body = await request.json().catch(() => ({}));
  const action = clean(body.action).toLowerCase();
  const nextStatus = action === "activate" ? "active" : action === "suspend" ? "suspended" : action === "mark_pending" ? "pending" : "";
  if (!nextStatus) throw new AppError("Use activate, suspend, or mark_pending.", 400, "VALIDATION_ERROR");

  await transaction(async (client) => {
    const updated = await client.query("UPDATE businesses SET account_status = $1, updated_at = NOW() WHERE id = $2 RETURNING id", [nextStatus, params.id]);
    if (!updated.rows[0]) throw new AppError("Company not found.", 404, "COMPANY_NOT_FOUND");
    await client.query(
      "INSERT INTO audit_logs (id, business_id, action, metadata) VALUES ($1, $2, $3, $4)",
      [id("a"), params.id, "super_admin_company_status_updated", JSON.stringify({ nextStatus, superAdminId: admin.id })]
    );
  });

  return getSuperAdminCompany(request, context);
}

function companyListQuery() {
  return `SELECT b.id, b.name, b.slug, b.status AS whatsapp_status, b.account_status,
                 b.whatsapp_number, b.waba_id, b.phone_number_id, b.created_at, b.updated_at,
                 owner.email AS owner_email,
                 COALESCE(bs.status, 'pending') AS subscription_status,
                 COALESCE(bs.payment_status, 'none') AS payment_status,
                 bs.starts_at, bs.trial_ends_at, bs.current_period_end, bs.renews_at,
                 sp.code AS plan_code, sp.name AS plan_name, sp.billing_interval, sp.price_cents, sp.currency,
                 COALESCE(user_counts.total, 0)::int AS user_count,
                 COALESCE(contact_counts.total, 0)::int AS contact_count,
                 COALESCE(campaign_counts.total, 0)::int AS campaign_count,
                 latest_activity.last_at
          FROM businesses b
          LEFT JOIN LATERAL (
            SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.business_id = b.id
            ORDER BY CASE WHEN m.role = 'Owner' THEN 0 ELSE 1 END, m.created_at ASC
            LIMIT 1
          ) owner ON TRUE
          LEFT JOIN business_subscriptions bs ON bs.business_id = b.id
          LEFT JOIN subscription_plans sp ON sp.id = bs.plan_id
          LEFT JOIN LATERAL (SELECT COUNT(*) AS total FROM memberships m WHERE m.business_id = b.id) user_counts ON TRUE
          LEFT JOIN LATERAL (SELECT COUNT(*) AS total FROM contacts c WHERE c.business_id = b.id) contact_counts ON TRUE
          LEFT JOIN LATERAL (SELECT COUNT(*) AS total FROM campaigns k WHERE k.business_id = b.id) campaign_counts ON TRUE
          LEFT JOIN LATERAL (
            SELECT MAX(last_seen) AS last_at
            FROM (
              SELECT MAX(at) AS last_seen FROM audit_logs a WHERE a.business_id = b.id
              UNION ALL
              SELECT MAX(at) AS last_seen FROM events e WHERE e.business_id = b.id
            ) activity
          ) latest_activity ON TRUE`;
}

function mapSuperAdmin(row) {
  return {
    id: row.id,
    name: row.name || "Super Admin",
    email: row.email,
    lastLoginAt: toIso(row.last_login_at),
    createdAt: toIso(row.created_at)
  };
}

function mapPlan(row) {
  return {
    code: row.code,
    name: row.name,
    interval: row.billing_interval,
    priceCents: row.price_cents,
    currency: row.currency,
    subscribers: row.subscribers
  };
}

function mapCompanyRow(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    email: row.owner_email || "",
    registeredAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    accountStatus: row.account_status,
    whatsappStatus: row.whatsapp_status,
    whatsappNumber: row.whatsapp_number || "",
    hasWabaId: Boolean(row.waba_id),
    hasPhoneNumberId: Boolean(row.phone_number_id),
    subscriptionStatus: row.subscription_status,
    paymentStatus: row.payment_status,
    planCode: row.plan_code || "",
    planName: row.plan_name || "Unassigned",
    billingInterval: row.billing_interval || "monthly",
    priceCents: row.price_cents || 0,
    currency: row.currency || "INR",
    subscriptionStartAt: toIso(row.starts_at),
    trialEndsAt: toIso(row.trial_ends_at),
    renewalAt: toIso(row.renews_at || row.current_period_end),
    userCount: row.user_count,
    contactCount: row.contact_count,
    campaignCount: row.campaign_count,
    lastActivityAt: toIso(row.last_at)
  };
}
