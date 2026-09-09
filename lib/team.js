import crypto from "crypto";
import { createSessionToken, hashPassword, normalizeEmail, requireSession, sessionCookie, verifyPassword } from "./auth";
import { AppError, errorJson, id, json, query, transaction } from "./db";

const managerRoles = new Set(["Owner", "Manager"]);
const invitationHash = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");
const inviteHours = () => Math.max(1, Math.min(Number(process.env.TEAM_INVITE_TTL_HOURS) || 72, 720));
const clean = (value) => String(value || "").trim();

function assertManager(session) {
  if (!managerRoles.has(session.role)) throw new AppError("Only workspace owners and managers can manage the team.", 403, "TEAM_FORBIDDEN");
}

async function listInvitations(businessId) {
  const result = await query(
    `SELECT id, email, role, expires_at, created_at FROM team_invitations
     WHERE business_id = $1 AND accepted_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC`,
    [businessId]
  );
  return result.rows.map((row) => ({ id: row.id, email: row.email, role: row.role, expiresAt: row.expires_at?.toISOString(), createdAt: row.created_at?.toISOString() }));
}

export async function getTeamInvitations(request) {
  try { const session = await requireSession(request); assertManager(session); return json({ invitations: await listInvitations(session.businessId) }); }
  catch (error) { return errorJson(error); }
}

export async function createTeamInvitation(request) {
  try {
    const session = await requireSession(request);
    assertManager(session);
    const body = await request.json();
    const email = normalizeEmail(body.email);
    const role = ["Manager", "Agent"].includes(body.role) ? body.role : "Agent";
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new AppError("Enter a valid email address.", 400, "VALIDATION_ERROR");
    const existing = await query(`SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = $1 AND u.email = $2`, [session.businessId, email]);
    if (existing.rows[0]) throw new AppError("This user already belongs to the workspace.", 409, "MEMBER_EXISTS");
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + inviteHours() * 60 * 60 * 1000);
    await query(
      `INSERT INTO team_invitations (id, business_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (business_id, email) WHERE accepted_at IS NULL DO UPDATE
       SET role = EXCLUDED.role, token_hash = EXCLUDED.token_hash, invited_by = EXCLUDED.invited_by, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
      [id("inv"), session.businessId, email, role, invitationHash(token), session.userId, expiresAt]
    );
    const appUrl = clean(process.env.APP_URL) || new URL(request.url).origin;
    return json({ invitations: await listInvitations(session.businessId), inviteUrl: `${appUrl.replace(/\/$/, "")}/invite/${token}` }, 201);
  } catch (error) { return errorJson(error); }
}

export async function revokeTeamInvitation(request, context) {
  try { const session = await requireSession(request); assertManager(session); const params = await context.params; await query("DELETE FROM team_invitations WHERE id = $1 AND business_id = $2 AND accepted_at IS NULL", [params.id, session.businessId]); return json({ invitations: await listInvitations(session.businessId) }); }
  catch (error) { return errorJson(error); }
}

export async function acceptTeamInvitation(request, context) {
  try {
    const params = await context.params;
    const body = await request.json();
    const name = clean(body.name);
    const password = String(body.password || "");
    if (!name || password.length < 8) throw new AppError("Name and a password of at least 8 characters are required.", 400, "VALIDATION_ERROR");
    const session = await transaction(async (client) => {
      const invitation = (await client.query("SELECT * FROM team_invitations WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > NOW() FOR UPDATE", [invitationHash(params.token)])).rows[0];
      if (!invitation) throw new AppError("This invitation is invalid or has expired.", 410, "INVITE_EXPIRED");
      let user = (await client.query("SELECT * FROM users WHERE email = $1", [invitation.email])).rows[0];
      if (user && !verifyPassword(password, user.password_hash)) throw new AppError("Use the existing account password for this email.", 401, "INVALID_CREDENTIALS");
      if (!user) { const userId = id("u"); await client.query("INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)", [userId, name, invitation.email, hashPassword(password)]); user = { id: userId }; }
      await client.query("INSERT INTO memberships (id, user_id, business_id, role) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, business_id) DO NOTHING", [id("mb"), user.id, invitation.business_id, invitation.role]);
      await client.query("UPDATE team_invitations SET accepted_at = NOW() WHERE id = $1", [invitation.id]);
      return { userId: user.id, businessId: invitation.business_id, role: invitation.role };
    });
    return json({ ok: true }, 201, { "Set-Cookie": sessionCookie(createSessionToken(session)) });
  } catch (error) { return errorJson(error); }
}

export async function updateTeamMember(request, context) {
  try {
    const session = await requireSession(request);
    const params = await context.params;
    const body = await request.json();
    const availability = body.availability === undefined ? null : (["available", "away", "offline"].includes(body.availability) ? body.availability : null);
    if (body.availability !== undefined && !availability) throw new AppError("Choose a valid availability.", 400, "VALIDATION_ERROR");
    if (body.role === undefined) {
      if (params.id !== session.userId) assertManager(session);
      const updated = await query("UPDATE memberships SET availability = $1 WHERE business_id = $2 AND user_id = $3 RETURNING id", [availability, session.businessId, params.id]);
      if (!updated.rows[0]) throw new AppError("Team member not found.", 404, "MEMBER_NOT_FOUND");
    } else {
      assertManager(session);
      const role = ["Manager", "Agent"].includes(body.role) ? body.role : null;
      if (!role) throw new AppError("Choose a valid company role.", 400, "VALIDATION_ERROR");
      const updated = await query("UPDATE memberships SET role = $1 WHERE business_id = $2 AND user_id = $3 AND role <> 'Owner' RETURNING id", [role, session.businessId, params.id]);
      if (!updated.rows[0]) throw new AppError("Team member not found or owner cannot be changed.", 404, "MEMBER_NOT_FOUND");
    }
    return json({ ok: true });
  } catch (error) { return errorJson(error); }
}
export async function removeTeamMember(request, context) {
  try { const session = await requireSession(request); assertManager(session); const params = await context.params; if (params.id === session.userId) throw new AppError("You cannot remove your own membership.", 409, "SELF_REMOVE_FORBIDDEN"); const removed = await query("DELETE FROM memberships WHERE business_id = $1 AND user_id = $2 AND role <> 'Owner' RETURNING id", [session.businessId, params.id]); if (!removed.rows[0]) throw new AppError("Team member not found or owner cannot be removed.", 404, "MEMBER_NOT_FOUND"); return json({ ok: true }); }
  catch (error) { return errorJson(error); }
}