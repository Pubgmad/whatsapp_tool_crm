import { requireSuperAdmin } from "./super-admin";
import { AppError, id, json, query, transaction } from "./db";

export async function listMetaDeletionRequests(request) {
  await requireSuperAdmin(request);
  const result = await query(
    `SELECT id,confirmation_code,status,businesses_affected,business_ids,requested_at,completed_at,review_note
       FROM meta_data_deletion_requests
      ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, requested_at DESC
      LIMIT 100`
  );
  return json({ requests: result.rows.map((row) => ({
    id: row.id,
    confirmationCode: row.confirmation_code,
    status: row.status,
    businessesAffected: row.businesses_affected,
    businessIds: row.business_ids || [],
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    reviewNote: row.review_note
  })) });
}

export async function reviewMetaDeletionRequest(request) {
  const admin = await requireSuperAdmin(request);
  const body = await request.json().catch(() => ({}));
  const requestId = String(body.id || "").trim();
  const status = String(body.status || "").trim();
  const note = String(body.note || "").trim();
  if (!requestId || !["pending", "completed", "failed"].includes(status) || note.length < 20 || note.length > 4000) {
    throw new AppError("Select a request and provide a review note of 20 to 4000 characters.", 400, "DELETION_REVIEW_INVALID");
  }
  if (status === "completed" && body.confirmation !== "REVIEWED_DATA_DELETION") {
    throw new AppError("Confirm that remaining Meta Platform Data was reviewed and handled.", 400, "DELETION_CONFIRMATION_REQUIRED");
  }
  await transaction(async (client) => {
    const result = await client.query(
      `UPDATE meta_data_deletion_requests
          SET status=$1,reviewed_by=$2,review_note=$3,completed_at=CASE WHEN $1='completed' THEN NOW() ELSE NULL END,updated_at=NOW()
        WHERE id=$4 AND status IN ('pending','failed') AND status<>$1
        RETURNING confirmation_code`,
      [status, admin.id, note, requestId]
    );
    if (!result.rows[0]) throw new AppError("Reviewable deletion request not found.", 404, "DELETION_REQUEST_NOT_FOUND");
    await client.query(
      "INSERT INTO platform_audit_logs (id,super_admin_id,action,metadata) VALUES ($1,$2,$3,$4)",
      [id("pa"), admin.id, "meta_deletion_reviewed", JSON.stringify({ requestId, status })]
    );
  });
  return json({ ok: true });
}
