/**
 * Meta App Review workspace: no Razorpay subscription, unlimited plan limits, all plan features.
 * Scoped to REVIEWER_EMAIL (default: metareview@gmail.com) — all Owner workspaces for that user.
 */

import { normalizeEmail } from './auth.js';
import { query } from './db.js';

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

/**
 * True when this workspace is owned by the Meta App Review account (REVIEWER_EMAIL).
 * If the DB flag is stale, heals review_access and drops subscription rows on first use.
 * @param {string} businessId
 * @param {(sql: string, params?: unknown[]) => Promise<import('pg').QueryResult>} [run]
 */
export async function resolveReviewerBypass(businessId, run = query) {
  const { email } = reviewerEnv();
  if (!email || !businessId) return false;

  const row = (
    await run(
      `SELECT b.review_access,
              EXISTS (
                SELECT 1 FROM memberships m
                  JOIN users u ON u.id = m.user_id
                 WHERE m.business_id = b.id AND m.role = 'Owner' AND lower(u.email) = $2
              ) AS reviewer_owned
         FROM businesses b
        WHERE b.id = $1`,
      [businessId, email]
    )
  ).rows[0];

  if (!row) return false;
  if (row.review_access) return true;
  if (!row.reviewer_owned) return false;

  await run(
    `UPDATE businesses
        SET review_access = TRUE,
            account_status = CASE WHEN account_status = 'suspended' THEN account_status ELSE 'active' END,
            updated_at = NOW()
      WHERE id = $1`,
    [businessId]
  );
  await run('DELETE FROM business_subscriptions WHERE business_id = $1', [businessId]);
  return true;
}
