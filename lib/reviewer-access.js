/**
 * Meta App Review workspace: no Razorpay subscription, unlimited plan limits, all plan features.
 * Scoped to REVIEWER_EMAIL + REVIEWER_BUSINESS_NAME (defaults: metareview@gmail.com).
 */

export function reviewerEnv() {
  const email = String(process.env.REVIEWER_EMAIL || 'metareview@gmail.com').trim().toLowerCase();
  const businessName = String(process.env.REVIEWER_BUSINESS_NAME || 'Meta App Review Workspace').trim();
  return { email, businessName };
}

/** @param {import('pg').PoolClient} client */
export async function ensureMetaReviewerWorkspaceAccess(client) {
  const { email, businessName } = reviewerEnv();
  if (!email) return { updated: 0 };

  await client.query(`SELECT set_config('app.system_access', 'true', true)`);

  const result = await client.query(
    `UPDATE businesses b
        SET review_access = TRUE,
            account_status = 'active',
            updated_at = NOW()
      FROM memberships m
      JOIN users u ON u.id = m.user_id
     WHERE b.id = m.business_id
       AND lower(u.email) = $1
       AND m.role = 'Owner'
       AND (b.review_access = TRUE OR b.name = $2)
     RETURNING b.id`,
    [email, businessName]
  );

  if (result.rowCount) {
    const ids = result.rows.map((row) => row.id);
    await client.query('DELETE FROM business_subscriptions WHERE business_id = ANY($1::text[])', [ids]);
  }

  return { updated: result.rowCount || 0, businessIds: result.rows.map((row) => row.id) };
}
