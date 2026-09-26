import Stripe from "stripe";
import { requireSuperAdmin } from "./super-admin";
import { AppError, id, json, query, transaction } from "./db";
import { readJsonBodyLimited } from "./security";

export async function listWorkspaceDeletionRequests(request) {
  await requireSuperAdmin(request);
  const result = await query(
    `SELECT r.id, r.business_id, r.status, r.requested_at, r.execute_after,
            b.name AS company_name, b.account_status, s.provider, s.status AS subscription_status,
            s.provider_subscription_id,
            (b.waba_id <> '' OR b.access_token_encrypted <> '' OR b.webhook_subscribed
             OR EXISTS (SELECT 1 FROM whatsapp_accounts wa WHERE wa.business_id = b.id)) AS meta_connected
       FROM workspace_deletion_requests r
       JOIN businesses b ON b.id = r.business_id
       LEFT JOIN business_subscriptions s ON s.business_id = b.id
      ORDER BY CASE WHEN r.status = 'pending_approval' THEN 0 WHEN r.status = 'scheduled' THEN 1 ELSE 2 END,
               r.requested_at DESC
      LIMIT 100`
  );
  return json({ requests: result.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    companyName: row.company_name,
    accountStatus: row.account_status,
    status: row.status,
    requestedAt: row.requested_at,
    executeAfter: row.execute_after,
    subscriptionStatus: row.subscription_status || "none",
    billedByStripe: row.provider === "stripe",
    metaConnected: Boolean(row.meta_connected)
  })) });
}

async function assertStripeSubscriptionEnded(subscriptionId) {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new AppError("Configure Stripe before approving deletion of a billed workspace.", 503, "STRIPE_NOT_CONFIGURED");
  }
  let subscription;
  try {
    subscription = await new Stripe(process.env.STRIPE_SECRET_KEY).subscriptions.retrieve(subscriptionId);
  } catch {
    throw new AppError("Stripe subscription could not be verified. Resolve billing before deletion.", 503, "STRIPE_VERIFICATION_FAILED");
  }
  if (!["canceled", "incomplete_expired"].includes(subscription.status)) {
    throw new AppError("Cancel the Stripe subscription and wait for cancellation before deleting this workspace.", 409, "SUBSCRIPTION_STILL_ACTIVE");
  }
}

export async function reviewWorkspaceDeletionRequest(request) {
  const admin = await requireSuperAdmin(request);
  const body = await readJsonBodyLimited(request, 16384);
  const requestId = String(body.id || "").trim();
  const action = String(body.action || "").trim();
  if (!requestId || !["approve", "reject"].includes(action)) {
    throw new AppError("Select a deletion request and action.", 400, "DELETION_REVIEW_INVALID");
  }
  if (action === "approve" && body.confirmation !== "DELETE_WORKSPACE") {
    throw new AppError("Confirm irreversible workspace deletion.", 400, "DELETION_CONFIRMATION_REQUIRED");
  }
  const pending = (await query(
    `SELECT r.business_id, r.status, r.execute_after, s.provider, s.provider_subscription_id,
            (b.waba_id <> '' OR b.access_token_encrypted <> '' OR b.webhook_subscribed
             OR EXISTS (SELECT 1 FROM whatsapp_accounts wa WHERE wa.business_id = b.id)) AS meta_connected
       FROM workspace_deletion_requests r
       JOIN businesses b ON b.id = r.business_id
       LEFT JOIN business_subscriptions s ON s.business_id = r.business_id
      WHERE r.id = $1`,
    [requestId]
  )).rows[0];
  if (!pending || pending.status !== "pending_approval" || new Date(pending.execute_after).getTime() > Date.now()) {
    throw new AppError("Deletion request is not ready for review.", 409, "DELETION_NOT_READY");
  }
  if (action === "approve" && pending.meta_connected) {
    throw new AppError("Disconnect WhatsApp and unsubscribe the app before deleting this workspace.", 409, "WHATSAPP_STILL_CONNECTED");
  }
  if (action === "approve" && pending.provider === "stripe") {
    if (!pending.provider_subscription_id) throw new AppError("Stripe billing has no linked subscription ID. Reconcile billing before deletion.", 409, "BILLING_UNVERIFIED");
    await assertStripeSubscriptionEnded(pending.provider_subscription_id);
  }
  await transaction(async (client) => {
    const current = (await client.query(
      `SELECT r.business_id, r.status, r.execute_after, s.provider, s.provider_subscription_id,
              (b.waba_id <> '' OR b.access_token_encrypted <> '' OR b.webhook_subscribed
               OR EXISTS (SELECT 1 FROM whatsapp_accounts wa WHERE wa.business_id = b.id)) AS meta_connected
         FROM workspace_deletion_requests r
         JOIN businesses b ON b.id = r.business_id
         LEFT JOIN business_subscriptions s ON s.business_id = r.business_id
        WHERE r.id = $1 FOR UPDATE OF r, b`,
      [requestId]
    )).rows[0];
    if (!current || current.status !== "pending_approval" || new Date(current.execute_after).getTime() > Date.now()) {
      throw new AppError("Deletion request changed. Refresh before reviewing.", 409, "DELETION_NOT_READY");
    }
    if (action === "approve" &&
        (current.provider !== pending.provider || current.provider_subscription_id !== pending.provider_subscription_id)) {
      throw new AppError("Billing changed during review. Refresh before deleting.", 409, "BILLING_CHANGED");
    }
    if (action === "approve" && current.meta_connected) {
      throw new AppError("WhatsApp connection changed during review. Disconnect it before deleting.", 409, "WHATSAPP_STILL_CONNECTED");
    }
    if (action === "approve") {
      const processing = await client.query(
        `SELECT
           EXISTS (SELECT 1 FROM campaign_jobs j
                   JOIN campaign_recipients cr ON cr.id = j.campaign_recipient_id
                   JOIN campaigns c ON c.id = cr.campaign_id
                  WHERE c.business_id = $1 AND j.status = 'processing')
           OR EXISTS (SELECT 1 FROM automation_jobs j
                       WHERE j.business_id = $1 AND j.status = 'processing') AS active`,
        [current.business_id]
      );
      if (processing.rows[0].active) {
        throw new AppError("Messages are still processing. Wait for the worker to settle them before deleting.", 409, "MESSAGES_STILL_PROCESSING");
      }
    }
    if (action === "reject") {
      await client.query("UPDATE workspace_deletion_requests SET status = 'failed' WHERE id = $1", [requestId]);
    } else {
      const members = await client.query("SELECT user_id FROM memberships WHERE business_id = $1", [current.business_id]);
      await client.query("DELETE FROM businesses WHERE id = $1", [current.business_id]);
      const userIds = members.rows.map((row) => row.user_id);
      if (userIds.length) {
        await client.query(
          `DELETE FROM users u WHERE u.id = ANY($1)
             AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
             AND NOT EXISTS (SELECT 1 FROM team_invitations ti WHERE ti.invited_by = u.id)
             AND NOT EXISTS (SELECT 1 FROM conversation_notes n WHERE n.user_id = u.id)`,
          [userIds]
        );
      }
    }
    await client.query(
      "INSERT INTO platform_audit_logs (id, super_admin_id, action, metadata) VALUES ($1, $2, $3, $4)",
      [id("pa"), admin.id, action === "approve" ? "workspace_deleted" : "workspace_deletion_rejected",
        JSON.stringify({ requestId, businessId: current.business_id })]
    );
  });
  return json({ ok: true, action });
}
