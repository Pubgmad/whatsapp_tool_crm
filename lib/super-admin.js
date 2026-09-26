import crypto from "crypto";
import { hashPassword, normalizeEmail, parseCookies, verifyPassword } from "./auth";
import { AppError, id, json, query, toIso, transaction } from "./db";
import { listPlatformSettings, upsertPlatformSetting } from "./platform";
import { decryptSecret, encryptSecret } from './meta';
import { verifyTotp } from './account-security';
import { readOptionalJsonBodyLimited, secureCookieAttribute } from './security.js';

export const SUPER_SESSION_COOKIE_NAME = "wcrm_super_session";
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

function optionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeCode(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function parseFeatures(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return String(value || "").split(/\r?\n|,/).map(clean).filter(Boolean);
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", superSecret()).update(value).digest("base64url");
}

const recoveryHash = (value) => crypto.createHash('sha256').update(clean(value).replace(/\s+/g, '').toUpperCase()).digest('hex');
const createRecoveryCodes = () => Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').toUpperCase());

async function verifySuperAdminMfa(admin, code) {
  if (!admin?.mfa_secret_encrypted) return false;
  if (verifyTotp(decryptSecret(admin.mfa_secret_encrypted), code)) return true;
  const codeHash = recoveryHash(code);
  const recovery = Array.isArray(admin.mfa_recovery_codes) ? admin.mfa_recovery_codes : [];
  if (!recovery.includes(codeHash)) return false;
  await query('UPDATE super_admins SET mfa_recovery_codes=$1,updated_at=NOW() WHERE id=$2', [JSON.stringify(recovery.filter((item) => item !== codeHash)), admin.id]);
  return true;
}

function validSuperSignature(value, signature) {
  return [process.env.SUPER_ADMIN_SESSION_SECRET || process.env.AUTH_SECRET, process.env.SUPER_ADMIN_SESSION_SECRET_PREVIOUS].filter(Boolean).some((key) => {
    const expected = Buffer.from(crypto.createHmac('sha256', key).update(value).digest('base64url'));
    const actual = Buffer.from(signature || '');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  });
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
  try {
    const [body, signature] = String(token || "").split(".");
    if (!body || !signature) return null;
    if (!validSuperSignature(body, signature)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.role !== "SuperAdmin" || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function superSessionCookie(token) {
  return `${SUPER_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SUPER_SESSION_SECONDS}${secureCookieAttribute()}`;
}

export function clearSuperSessionCookie() {
  return `${SUPER_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
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

export async function loginSuperAdmin({ email, password, mfaCode }) {
  await ensureConfiguredSuperAdmin();
  const cleanEmail = normalizeEmail(email);
  const result = await query("SELECT id, email, password_hash, active, mfa_enabled, mfa_secret_encrypted, mfa_recovery_codes FROM super_admins WHERE email = $1 LIMIT 1", [cleanEmail]);
  const admin = result.rows[0];
  if (!admin || !admin.active || !verifyPassword(password, admin.password_hash)) {
    throw new AppError("Invalid Super Admin credentials.", 401, "SUPER_ADMIN_INVALID_CREDENTIALS");
  }
  if (admin.mfa_enabled) {
    if (!mfaCode) throw new AppError('Enter your authenticator or recovery code.', 401, 'MFA_REQUIRED');
    if (!await verifySuperAdminMfa(admin, mfaCode)) throw new AppError('The authentication code is invalid.', 401, 'MFA_INVALID');
  }
  await query("UPDATE super_admins SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1", [admin.id]);
  return { token: createSuperSessionToken({ superAdminId: admin.id }), admin: mapSuperAdmin(admin) };
}

export async function authenticateSuperAdminToken(token) {
  const session = verifySuperSessionToken(token);
  if (!session) throw new AppError("Super Admin sign in required.", 401, "SUPER_ADMIN_AUTH_REQUIRED");

  const result = await query("SELECT id, name, email, active, last_login_at, created_at FROM super_admins WHERE id = $1 LIMIT 1", [session.superAdminId]);
  const admin = result.rows[0];
  if (!admin || !admin.active) throw new AppError("Super Admin access is disabled.", 403, "SUPER_ADMIN_FORBIDDEN");
  return mapSuperAdmin(admin);
}

export async function getSuperAdminMfa(request) {
  const admin = await requireSuperAdmin(request);
  const row = (await query('SELECT mfa_enabled FROM super_admins WHERE id=$1', [admin.id])).rows[0];
  return { enabled: Boolean(row?.mfa_enabled) };
}

export async function manageSuperAdminMfa(request, body) {
  const admin = await requireSuperAdmin(request);
  const row = (await query('SELECT * FROM super_admins WHERE id=$1', [admin.id])).rows[0];
  if (body.action === 'begin') {
    if (row.mfa_enabled) throw new AppError('MFA is already enabled.', 409, 'MFA_ALREADY_ENABLED');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const bytes = crypto.randomBytes(20);
    let bits = '';
    for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
    const secret = bits.match(/.{1,5}/g).map((part) => alphabet[parseInt(part.padEnd(5, '0'), 2)]).join('');
    await query('UPDATE super_admins SET mfa_secret_encrypted=$1,updated_at=NOW() WHERE id=$2', [encryptSecret(secret), admin.id]);
    const issuer = encodeURIComponent(clean(process.env.MFA_ISSUER) || 'WhatsApp CRM');
    return { secret, otpauthUrl: `otpauth://totp/${issuer}:${encodeURIComponent(admin.email)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` };
  }
  if (body.action === 'enable') {
    if (!row.mfa_secret_encrypted || row.mfa_enabled) throw new AppError('Start MFA setup first.', 409, 'MFA_SETUP_REQUIRED');
    if (!verifyTotp(decryptSecret(row.mfa_secret_encrypted), body.code)) throw new AppError('The authentication code is invalid.', 400, 'MFA_INVALID');
    const recoveryCodes = createRecoveryCodes();
    await query('UPDATE super_admins SET mfa_enabled=TRUE,mfa_recovery_codes=$1,updated_at=NOW() WHERE id=$2', [JSON.stringify(recoveryCodes.map(recoveryHash)), admin.id]);
    return { enabled: true, recoveryCodes };
  }
  if (body.action === 'disable') {
    if (!verifyPassword(body.password, row.password_hash)) throw new AppError('Password is incorrect.', 401, 'INVALID_CREDENTIALS');
    if (!await verifySuperAdminMfa(row, body.code)) throw new AppError('The authentication code is invalid.', 401, 'MFA_INVALID');
    await query('UPDATE super_admins SET mfa_enabled=FALSE,mfa_secret_encrypted=\'\',mfa_recovery_codes=\'[]\'::jsonb,updated_at=NOW() WHERE id=$1', [admin.id]);
    return { enabled: false };
  }
  throw new AppError('Invalid MFA action.', 400, 'VALIDATION_ERROR');
}

export async function requireSuperAdmin(request) {
  const { assertCsrf, enforceRequestRateLimit } = await import('./security');
  assertCsrf(request);
  const admin = await authenticateSuperAdminToken(parseCookies(request)[SUPER_SESSION_COOKIE_NAME]);
  const { enterSystemContext } = await import('./db');
  enterSystemContext();
  await enforceRequestRateLimit(request, admin.id, 'api');
  return admin;
}

export async function getSuperAdminMe(request) {
  const admin = await requireSuperAdmin(request);
  return json({ admin });
}

export async function getSuperAdminDashboard(request) {
  await requireSuperAdmin(request);
  const [summary, subscriptionStats, planStats] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE account_status = 'active')::int AS active,
              COUNT(*) FILTER (WHERE account_status = 'suspended')::int AS suspended,
              COUNT(*) FILTER (WHERE account_status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE status = 'Connected')::int AS whatsapp_connected
       FROM businesses`
    ),
    query("SELECT COALESCE(status, 'pending') AS status, COUNT(*)::int AS count FROM business_subscriptions GROUP BY status ORDER BY status"),
    query(planListQuery())
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
    companies: [],
    generatedAt: new Date().toISOString()
  });
}

export async function getSuperAdminCompanies(request) {
  await requireSuperAdmin(request);
  const url = new URL(request.url);
  const search = clean(url.searchParams.get("search")).slice(0, 120);
  const status = clean(url.searchParams.get("status")) || "all";
  if (!["all", "active", "pending", "suspended"].includes(status)) throw new AppError("Invalid company status filter.", 400, "VALIDATION_ERROR");
  const page = Math.max(1, Math.min(100000, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1));
  const pageSize = 25;
  const filtered = `${companyListQuery()}
    WHERE ($1='' OR b.name ILIKE '%' || $1 || '%' OR owner.email ILIKE '%' || $1 || '%' OR sp.name ILIKE '%' || $1 || '%')
      AND ($2='all' OR b.account_status=$2)`;
  const result = await query(
    `SELECT page.*, COUNT(*) OVER()::int AS total_count
       FROM (${filtered}) page
      ORDER BY page.created_at DESC,page.id DESC
      LIMIT $3 OFFSET $4`,
    [search, status, pageSize, (page - 1) * pageSize]
  );
  return json({
    companies: result.rows.map(mapCompanyRow),
    pagination: { page, pageSize, total: result.rows[0]?.total_count || 0 }
  });
}

export async function getSuperAdminPlans(request) {
  await requireSuperAdmin(request);
  const result = await query(planListQuery());
  return json({ plans: result.rows.map(mapPlan) });
}

export async function createSuperAdminPlan(request) {
  const admin = await requireSuperAdmin(request);
  const body = await readOptionalJsonBodyLimited(request, 65536);
  const plan = await savePlan(body);
  await platformAudit(admin.id, "super_admin_plan_created", { planId: plan.id });
  return json({ plan }, 201);
}

export async function updateSuperAdminPlan(request, context) {
  const admin = await requireSuperAdmin(request);
  const params = await context.params;
  const body = await readOptionalJsonBodyLimited(request, 65536);
  const plan = await savePlan({ ...body, id: params.id });
  await platformAudit(admin.id, "super_admin_plan_updated", { planId: plan.id });
  return json({ plan });
}

export async function deleteSuperAdminPlan(request, context) {
  const admin = await requireSuperAdmin(request);
  const params = await context.params;
  const result = await query(`${planListQuery("WHERE sp.id = $1")}`, [params.id]);
  const plan = result.rows[0];
  if (!plan) throw new AppError("Subscription plan not found.", 404, "PLAN_NOT_FOUND");

  if (Number(plan.subscribers || 0) > 0) {
    await query("UPDATE subscription_plans SET is_active = FALSE, visible = FALSE, updated_at = NOW() WHERE id = $1", [params.id]);
  } else {
    await query("DELETE FROM subscription_plans WHERE id = $1", [params.id]);
  }
  await platformAudit(admin.id, "super_admin_plan_deleted", { planId: params.id, softDeleted: Number(plan.subscribers || 0) > 0 });
  return getSuperAdminPlans(request);
}

export async function getSuperAdminSettings(request) {
  await requireSuperAdmin(request);
  return json({ settings: await listPlatformSettings() });
}

export async function saveSuperAdminSetting(request) {
  const admin = await requireSuperAdmin(request);
  const body = await readOptionalJsonBodyLimited(request, 262144);
  const setting = await upsertPlatformSetting(body);
  await platformAudit(admin.id, "super_admin_platform_setting_saved", { key: setting.key });
  return json({ setting });
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
  const body = await readOptionalJsonBodyLimited(request, 16384);
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

async function savePlan(body) {
  const code = normalizeCode(body.code);
  const name = clean(body.name);
  if (!code || !name) throw new AppError("Plan code and name are required.", 400, "VALIDATION_ERROR");
  const currency = clean(body.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new AppError("Choose a three-letter ISO currency code.", 400, "PLAN_CURRENCY_REQUIRED");
  const monthlyPrice = Number(body.monthlyPriceCents ?? body.monthly_price_cents ?? body.priceCents ?? body.price_cents);
  const yearlyPrice = Number(body.yearlyPriceCents ?? body.yearly_price_cents ?? 0);
  const trialDays = Number(body.trialDays ?? body.trial_days ?? 0);
  if (![monthlyPrice, yearlyPrice, trialDays].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new AppError("Prices and trial days must be non-negative whole numbers.", 400, "PLAN_VALUES_INVALID");
  }
  const limits = [
    body.contactLimit ?? body.contact_limit,
    body.campaignLimit ?? body.campaign_limit,
    body.userLimit ?? body.user_limit,
    body.automationFlowLimit ?? body.automation_flow_limit,
    body.monthlyMessageLimit ?? body.monthly_message_limit,
    body.whatsappConversationLimit ?? body.whatsapp_conversation_limit
  ].map(optionalNumber);
  if (limits.some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0))) {
    throw new AppError("Plan limits must be non-negative whole numbers or blank for unlimited.", 400, "PLAN_LIMIT_INVALID");
  }

  const values = [
    body.id || id("plan"),
    code,
    name,
    clean(body.description),
    clean(body.billingInterval || body.billing_interval || "monthly"),
    monthlyPrice,
    monthlyPrice,
    yearlyPrice,
    currency,
    trialDays,
    ...limits,
    JSON.stringify(parseFeatures(body.features)),
    numberOrZero(body.displayOrder ?? body.display_order),
    body.visible === false ? false : true,
    body.isActive === false || body.is_active === false ? false : true
  ];

  const result = await query(
    `INSERT INTO subscription_plans (id, code, name, description, billing_interval, price_cents, monthly_price_cents, yearly_price_cents, currency, trial_days, contact_limit, campaign_limit, user_limit, automation_flow_limit, monthly_message_limit, whatsapp_conversation_limit, features, display_order, visible, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     ON CONFLICT (id) DO UPDATE
     SET name = EXCLUDED.name,
         description = EXCLUDED.description,
         billing_interval = EXCLUDED.billing_interval,
         price_cents = EXCLUDED.price_cents,
         monthly_price_cents = EXCLUDED.monthly_price_cents,
         yearly_price_cents = EXCLUDED.yearly_price_cents,
         currency = EXCLUDED.currency,
         trial_days = EXCLUDED.trial_days,
         contact_limit = EXCLUDED.contact_limit,
         campaign_limit = EXCLUDED.campaign_limit,
         user_limit = EXCLUDED.user_limit,
         automation_flow_limit = EXCLUDED.automation_flow_limit,
         monthly_message_limit = EXCLUDED.monthly_message_limit,
         whatsapp_conversation_limit = EXCLUDED.whatsapp_conversation_limit,
         features = EXCLUDED.features,
         display_order = EXCLUDED.display_order,
         visible = EXCLUDED.visible,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()
     RETURNING *`,
    values
  );
  return mapPlan({ ...result.rows[0], subscribers: 0 });
}

async function platformAudit(superAdminId, action, metadata = {}) {
  await query(
    "INSERT INTO platform_audit_logs (id, super_admin_id, action, metadata) VALUES ($1, $2, $3, $4)",
    [id("pa"), superAdminId, action, JSON.stringify(metadata)]
  );
}
function planListQuery(whereClause = "") {
  return `SELECT sp.*, COUNT(bs.id)::int AS subscribers
          FROM subscription_plans sp
          LEFT JOIN business_subscriptions bs ON bs.plan_id = sp.id
          ${whereClause}
          GROUP BY sp.id
          ORDER BY sp.display_order ASC, sp.monthly_price_cents ASC, sp.name ASC`;
}

function companyListQuery() {
  return `SELECT b.id, b.name, b.slug, b.status AS whatsapp_status, b.account_status,
                 b.whatsapp_number, b.waba_id, b.phone_number_id, b.created_at, b.updated_at,
                 owner.email AS owner_email,
                 COALESCE(bs.status, 'pending') AS subscription_status,
                 COALESCE(bs.payment_status, 'none') AS payment_status,
                 bs.starts_at, bs.trial_ends_at, bs.current_period_end, bs.renews_at,
                 sp.code AS plan_code, sp.name AS plan_name, sp.billing_interval, sp.price_cents,
                 sp.monthly_price_cents, sp.yearly_price_cents, sp.currency,
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
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description || "",
    interval: row.billing_interval || "monthly",
    priceCents: row.price_cents || row.monthly_price_cents || 0,
    monthlyPriceCents: row.monthly_price_cents || row.price_cents || 0,
    yearlyPriceCents: row.yearly_price_cents || 0,
    currency: row.currency || "",
    trialDays: Number(row.trial_days || 0),
    limits: {
      contacts: optionalNumber(row.contact_limit),
      campaigns: optionalNumber(row.campaign_limit),
      users: optionalNumber(row.user_limit),
      automationFlows: optionalNumber(row.automation_flow_limit),
      messages: optionalNumber(row.monthly_message_limit),
      whatsappConversations: optionalNumber(row.whatsapp_conversation_limit)
    },
    features: Array.isArray(row.features) ? row.features : [],
    displayOrder: Number(row.display_order || 0),
    visible: Boolean(row.visible),
    isActive: Boolean(row.is_active),
    subscribers: Number(row.subscribers || 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
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
    priceCents: row.monthly_price_cents || row.price_cents || 0,
    yearlyPriceCents: row.yearly_price_cents || 0,
    currency: row.currency || "",
    subscriptionStartAt: toIso(row.starts_at),
    trialEndsAt: toIso(row.trial_ends_at),
    renewalAt: toIso(row.renews_at || row.current_period_end),
    userCount: row.user_count,
    contactCount: row.contact_count,
    campaignCount: row.campaign_count,
    lastActivityAt: toIso(row.last_at)
  };
}
