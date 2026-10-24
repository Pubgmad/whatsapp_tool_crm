import crypto from 'node:crypto';

export async function authorizationSeqSnapshot(client, metaUserId) {
  const rows = (
    await client.query(
      `SELECT business_id, integration, authorization_seq
         FROM meta_authorizations
        WHERE meta_user_id = $1`,
      [metaUserId]
    )
  ).rows;
  const snapshot = {};
  for (const row of rows) {
    const key = `${row.business_id}:${row.integration}`;
    snapshot[key] = Math.max(Number(snapshot[key] || 0), Number(row.authorization_seq || 0));
  }
  return snapshot;
}

export function snapshotExceedsScope(current, scope = {}) {
  const scopeObj = scope && typeof scope === 'object' ? scope : {};
  for (const [key, value] of Object.entries(current || {})) {
    if (Number(value || 0) > Number(scopeObj[key] || 0)) return true;
  }
  return false;
}

export async function hasPostDeletionData(client, metaUserId, completedAt) {
  if (!completedAt) return true;
  const leads = await client.query(
    `SELECT 1 FROM meta_leadgen_submissions s
      JOIN meta_authorizations a ON a.business_id = s.business_id AND a.meta_user_id = $1
     WHERE s.ingested_at > $2
     LIMIT 1`,
    [metaUserId, completedAt]
  );
  if (leads.rowCount) return true;
  const auths = await client.query(
    `SELECT 1 FROM meta_authorizations
      WHERE meta_user_id = $1 AND updated_at > $2 AND status = 'active'
     LIMIT 1`,
    [metaUserId, completedAt]
  );
  return auths.rowCount > 0;
}

export function buildDeletionCycleKey(metaUserIdHash, secret, snapshot, completedAt) {
  const material = `${JSON.stringify(snapshot || {})}:${completedAt ? new Date(completedAt).toISOString() : '0'}`;
  return crypto.createHmac('sha256', secret).update(`${metaUserIdHash}:${material}`).digest('hex');
}

export async function needsNewDeletionCycle(client, metaUserId, prior) {
  if (!prior || prior.status !== 'completed') return true;
  const current = await authorizationSeqSnapshot(client, metaUserId);
  if (snapshotExceedsScope(current, prior.scope_max_authorization_seq)) return true;
  if (await hasPostDeletionData(client, metaUserId, prior.completed_at)) return true;
  const linked = await client.query(
    'SELECT 1 FROM meta_authorizations WHERE meta_user_id=$1 LIMIT 1',
    [metaUserId]
  );
  if (linked.rowCount && prior.result_code === 'no_linked_data') return true;
  return false;
}
