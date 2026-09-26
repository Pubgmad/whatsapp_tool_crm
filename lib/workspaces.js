import { createSessionToken, requireSession, sessionCookie } from "./auth.js";
import { AppError, enterSystemContext, json, query } from "./db.js";
import { readOptionalJsonBodyLimited } from "./security.js";

export async function listMyWorkspaces(request) {
  const session = await requireSession(request);
  enterSystemContext();
  const result = await query(
    `SELECT b.id, b.name, b.account_status, m.role
       FROM memberships m
       JOIN businesses b ON b.id = m.business_id
      WHERE m.user_id = $1
      ORDER BY b.name ASC, b.id ASC`,
    [session.userId]
  );
  return json({
    currentBusinessId: session.businessId,
    workspaces: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.account_status,
      role: row.role
    }))
  });
}

export async function switchWorkspace(request) {
  const session = await requireSession(request);
  const body = await readOptionalJsonBodyLimited(request, 16384);
  const businessId = String(body.businessId || "").trim();
  if (!businessId || businessId.length > 128) throw new AppError("Select a valid workspace.", 400, "WORKSPACE_REQUIRED");
  enterSystemContext();
  const result = await query(
    `SELECT m.role, b.account_status, u.session_version
       FROM memberships m
       JOIN businesses b ON b.id = m.business_id
       JOIN users u ON u.id = m.user_id
      WHERE m.user_id = $1 AND m.business_id = $2
      LIMIT 1`,
    [session.userId, businessId]
  );
  const member = result.rows[0];
  if (!member) throw new AppError("This workspace is not linked to your account.", 403, "WORKSPACE_FORBIDDEN");
  if (member.account_status === "suspended") throw new AppError("This workspace is suspended.", 403, "ACCOUNT_SUSPENDED");
  const token = createSessionToken({
    userId: session.userId,
    businessId,
    role: member.role,
    sessionVersion: member.session_version
  });
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token) });
}
