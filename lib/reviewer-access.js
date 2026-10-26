/**
 * Meta App Review workspace: no Razorpay subscription, unlimited plan limits, all plan features.
 * Scoped to REVIEWER_EMAIL (default: metareview@gmail.com).
 */

import { normalizeEmail } from './auth.js';
import { query, transaction } from './db.js';

export function reviewerEnv() {
  const email = String(process.env.REVIEWER_EMAIL || 'metareview@gmail.com').trim().toLowerCase();
  const businessName = String(process.env.REVIEWER_BUSINESS_NAME || 'Meta App Review Workspace').trim();
  return { email, businessName };
}

export function isMetaReviewerEmail(email) {
  const { email: reviewerEmail } = reviewerEnv();
  if (!reviewerEmail) return false;
  return normalizeEmail(email) === reviewerEmail;
}

/** @param {import('pg').PoolClient} client */
export async function ensureMetaReviewerWorkspaceAccess(client) {
  const { email } = reviewerEnv();
  if (!email) return { updated: 0, businessIds: [] };

  await client.query(`SELECT set_config('app.system_access', 'true', true)`);

  const result = await client.query(
    `UPDATE businesses b
        SET review_access = TRUE,
            account_status = CASE WHEN b.account_status = 'suspended' THEN b.account_status ELSE 'active' END,
            updated_at = NOW()
      FROM memberships m
      JOIN users u ON u.id = m.user_id
     WHERE b.id = m.business_id
       AND lower(u.email) = $1
       AND m.role = 'Owner'
     RETURNING b.id`,
    [email]
  );

  if (result.rowCount) {
    const ids = result.rows.map((row) => row.id);
    await client.query('DELETE FROM business_subscriptions WHERE business_id = ANY($1::text[])', [ids]);
  }

  return { updated: result.rowCount || 0, businessIds: result.rows.map((row) => row.id) };
}

/**
 * Heal reviewer billing bypass when the signed-in user is the Meta App Review account.
 * @param {import('pg').PoolClient} client
 * @param {string} email
 */
export async function healMetaReviewerAccessIfNeeded(client, email) {
  if (!isMetaReviewerEmail(email)) return { updated: 0, businessIds: [] };
  return ensureMetaReviewerWorkspaceAccess(client);
}

async function tryPersistReviewerBypass(businessId) {
  if (!process.env.DATABASE_URL) return;
  try {
    await transaction(async (client) => {
      await client.query(`SELECT set_config('app.system_access', 'true', true)`);
      await client.query(
        `UPDATE businesses
            SET review_access = TRUE,
                account_status = CASE WHEN account_status = 'suspended' THEN account_status ELSE 'active' END,
                updated_at = NOW()
          WHERE id = $1`,
        [businessId]
      );
      await client.query('DELETE FROM business_subscriptions WHERE business_id = $1', [businessId]);
    });
  } catch (error) {
    console.warn('reviewer_access_persist_skipped', {
      businessId,
      code: error?.code,
      message: String(error?.message || '').slice(0, 200)
    });
  }
}

/**
 * Subscription / feature bypass for the Meta App Review account on this workspace.
 * Uses memberships + users (no businesses RLS). Never throws — heal is best-effort only.
 * @param {string} businessId
 * @param {(sql: string, params?: unknown[]) => Promise<import('pg').QueryResult>} [run]
 */
export async function reviewerSubscriptionBypassAllowed(businessId, run = query) {
  const { email } = reviewerEnv();
  if (!email || !businessId) return false;

  try {
    const member = (
      await run(
        `SELECT 1 AS ok
           FROM memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.business_id = $1 AND lower(u.email) = $2
          LIMIT 1`,
        [businessId, email]
      )
    ).rows[0];
    if (!member) return false;
  } catch (error) {
    console.warn('reviewer_bypass_membership_check_failed', {
      businessId,
      message: String(error?.message || '').slice(0, 200)
    });
    return false;
  }

  await tryPersistReviewerBypass(businessId);
  return true;
}

/**
 * @deprecated Prefer reviewerSubscriptionBypassAllowed — kept for tests with custom `run`.
 */
export async function resolveReviewerBypass(businessId, run = query) {
  return reviewerSubscriptionBypassAllowed(businessId, run);
}

/** @deprecated Use reviewerSubscriptionBypassAllowed */
export async function resolveReviewerBypassWithSystem(businessId) {
  return reviewerSubscriptionBypassAllowed(businessId);
}
