import crypto from "crypto";
import { AppError, id, query, transaction } from "./db";

export const SESSION_COOKIE_NAME = "wcrm_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value === "replace-with-a-long-random-secret") {
    throw new AppError("AUTH_SECRET is not configured.", 503, "AUTH_NOT_CONFIGURED");
  }
  return value;
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function slugify(value) {
  const slug = String(value || "business").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || `business-${crypto.randomBytes(3).toString("hex")}`;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, expected] = String(stored || "").split(":");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(expectedBuffer, actual);
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createSessionToken(payload) {
  const body = base64url(JSON.stringify({
    userId: payload.userId,
    businessId: payload.businessId,
    role: payload.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  }));
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token) {
  try {
    const [body, signature] = String(token || "").split(".");
    if (!body || !signature) return null;
    const expected = Buffer.from(sign(body), "utf8");
    const actual = Buffer.from(signature, "utf8");
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.get("cookie") || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    })
  );
}

export function sessionCookie(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function authenticateSessionToken(token) {
  const session = verifySessionToken(token);
  if (!session) throw new AppError("Sign in required.", 401, "AUTH_REQUIRED");

  const result = await query(
    `SELECT m.role, b.account_status
     FROM memberships m
     JOIN businesses b ON b.id = m.business_id
     WHERE m.user_id = $1 AND m.business_id = $2
     LIMIT 1`,
    [session.userId, session.businessId]
  );
  const membership = result.rows[0];
  if (!membership) throw new AppError("This workspace membership is no longer active.", 401, "AUTH_REQUIRED");
  if (membership.account_status === "suspended") {
    throw new AppError("This company workspace is suspended. Contact the platform administrator.", 403, "ACCOUNT_SUSPENDED");
  }
  return { ...session, role: membership.role };
}

export async function requireSession(request) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const allowedOrigins = new Set([new URL(request.url).origin]);
    if (process.env.APP_URL) allowedOrigins.add(new URL(process.env.APP_URL).origin);
    if (origin && !allowedOrigins.has(new URL(origin).origin)) throw new AppError("Invalid request origin.", 403, "INVALID_ORIGIN");
  }
  return authenticateSessionToken(parseCookies(request)[SESSION_COOKIE_NAME]);
}

export async function currentAccount(request) {
  const session = await requireSession(request);
  const result = await query(
    `SELECT u.id AS user_id, u.name AS user_name, u.email,
            b.id AS business_id, b.name AS business_name, b.account_status, b.review_access,
            CASE WHEN b.review_access THEN 'review' ELSE COALESCE(bs.status, 'pending') END AS subscription_status,
            CASE WHEN b.review_access THEN 'App Review Access' ELSE COALESCE(sp.name, 'Unassigned') END AS subscription_plan,
            m.role
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     JOIN businesses b ON b.id = m.business_id
     LEFT JOIN business_subscriptions bs ON bs.business_id = b.id
     LEFT JOIN subscription_plans sp ON sp.id = bs.plan_id
     WHERE u.id = $1 AND b.id = $2
     LIMIT 1`,
    [session.userId, session.businessId]
  );
  const row = result.rows[0];
  if (!row) throw new AppError("Account no longer exists.", 401, "AUTH_REQUIRED");
  if (row.account_status === "suspended") throw new AppError("This company workspace is suspended. Contact the platform administrator.", 403, "ACCOUNT_SUSPENDED");
  return {
    user: { id: row.user_id, name: row.user_name, email: row.email },
    business: {
      id: row.business_id,
      name: row.business_name,
      accountStatus: row.account_status,
      reviewAccess: Boolean(row.review_access),
      subscriptionStatus: row.subscription_status,
      subscriptionPlan: row.subscription_plan
    },
    role: row.role
  };
}

export async function registerAccount({ name, email, password, businessName }) {
  const cleanEmail = normalizeEmail(email);
  const cleanName = String(name || "").trim();
  const cleanBusinessName = String(businessName || "").trim();
  if (!cleanName || !cleanEmail || !password || !cleanBusinessName) {
    throw new AppError("Name, email, password, and business name are required.", 400, "VALIDATION_ERROR");
  }
  if (String(password).length < 8) throw new AppError("Password must be at least 8 characters.", 400, "VALIDATION_ERROR");

  return transaction(async (client) => {
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [cleanEmail]);
    if (existing.rows[0]) throw new AppError("An account already exists for this email.", 409, "EMAIL_EXISTS");

    const userId = id("u");
    const businessId = id("b");
    const membershipId = id("mb");
    const baseSlug = slugify(cleanBusinessName);
    const slug = `${baseSlug}-${crypto.randomBytes(2).toString("hex")}`;

    await client.query("INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)", [userId, cleanName, cleanEmail, hashPassword(password)]);
    await client.query(
      `INSERT INTO businesses (id, name, slug, webhook_url, mode, status, account_status)
       VALUES ($1, $2, $3, $4, 'Live Meta', 'Needs setup', 'pending')`,
      [businessId, cleanBusinessName, slug, process.env.WEBHOOK_URL || `${process.env.APP_URL || "http://localhost:3000"}/api/webhooks/meta`]
    );
    await client.query("INSERT INTO memberships (id, user_id, business_id, role) VALUES ($1, $2, $3, 'Owner')", [membershipId, userId, businessId]);

    const defaultPlanCode = String(process.env.DEFAULT_SUBSCRIPTION_PLAN_CODE || "").trim().toLowerCase();
    const plan = defaultPlanCode
      ? await client.query("SELECT id, trial_days FROM subscription_plans WHERE code = $1 AND is_active = TRUE AND visible = TRUE LIMIT 1", [defaultPlanCode])
      : { rows: [] };
    await client.query(
      `INSERT INTO business_subscriptions (id, business_id, plan_id, status, payment_status, starts_at, trial_ends_at, current_period_start, current_period_end, renews_at)
       VALUES ($1, $2, $3, $4, 'none', NOW(), $5, NOW(), NOW() + INTERVAL '1 month', NOW() + INTERVAL '1 month')`,
      [
        id("sub"),
        businessId,
        plan.rows[0]?.id || null,
        plan.rows[0] ? "trialing" : "pending",
        plan.rows[0] ? new Date(Date.now() + Number(plan.rows[0].trial_days || 0) * 24 * 60 * 60 * 1000) : null
      ]
    );

    await client.query("INSERT INTO audit_logs (id, business_id, user_id, action) VALUES ($1, $2, $3, 'account_registered')", [id("a"), businessId, userId]);

    return { userId, businessId, role: "Owner" };
  });
}

export async function loginAccount({ email, password }) {
  const cleanEmail = normalizeEmail(email);
  const user = await query("SELECT id, password_hash FROM users WHERE email = $1", [cleanEmail]);
  const row = user.rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new AppError("Invalid email or password.", 401, "INVALID_CREDENTIALS");
  }
  const membership = await query("SELECT business_id, role FROM memberships WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1", [row.id]);
  const member = membership.rows[0];
  if (!member) throw new AppError("No business workspace is linked to this account.", 403, "NO_WORKSPACE");
  return { userId: row.id, businessId: member.business_id, role: member.role };
}
