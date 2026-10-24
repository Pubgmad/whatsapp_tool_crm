import crypto from 'node:crypto';
import { id } from './db.js';

export function metaUserHash(metaUserId, appSecret) {
  return crypto.createHmac('sha256', appSecret).update(String(metaUserId)).digest('hex');
}

/**
 * One current credential per business and integration.
 * A revoked or historical principal does not clear another principal's current token.
 * Unique Page and WABA indexes already stop two tenants from storing the same asset.
 */
export async function recordMetaAuthorization(client, {
  businessId,
  metaUserId,
  integration,
  appSecret,
  assets = {},
  principalKind = 'meta_user'
}) {
  const userId = String(metaUserId || '').trim();
  if (!userId) return null;
  const hash = appSecret ? metaUserHash(userId, appSecret) : '';
  await client.query(
    `UPDATE meta_authorizations
        SET is_current = FALSE, updated_at = NOW()
      WHERE business_id = $1 AND integration = $2 AND meta_user_id <> $3`,
    [businessId, integration, userId]
  );
  const row = await client.query(
    `INSERT INTO meta_authorizations
      (id, business_id, meta_user_id, integration, status, principal_kind, assets, meta_user_id_hash, is_current, revoked_at)
     VALUES ($1,$2,$3,$4,'active',$5,$6::jsonb,$7,TRUE,NULL)
     ON CONFLICT (business_id, meta_user_id, integration) DO UPDATE SET
       status = 'active',
       principal_kind = EXCLUDED.principal_kind,
       assets = EXCLUDED.assets,
       meta_user_id_hash = CASE WHEN EXCLUDED.meta_user_id_hash <> '' THEN EXCLUDED.meta_user_id_hash ELSE meta_authorizations.meta_user_id_hash END,
       authorization_seq = meta_authorizations.authorization_seq + 1,
       is_current = TRUE,
       revoked_at = NULL,
       updated_at = NOW()
     RETURNING id`,
    [id('ma'), businessId, userId, integration, principalKind, JSON.stringify(assets || {}), hash]
  );
  return row.rows[0];
}

async function clearWhatsAppCredentials(client, businessId) {
  const accounts = await client.query('DELETE FROM whatsapp_accounts WHERE business_id = $1', [businessId]);
  await client.query(
    `UPDATE businesses
        SET whatsapp_number = '', waba_id = '', phone_number_id = '', access_token_encrypted = '',
            status = 'Needs setup', onboarding_method = 'manual', meta_token_expires_at = NULL,
            meta_connected_at = NULL, webhook_subscribed = FALSE,
            meta_connection_metadata = '{}'::jsonb, updated_at = NOW()
      WHERE id = $1`,
    [businessId]
  );
  const jobs = await client.query(
    `UPDATE campaign_jobs AS job
        SET status = 'failed', locked_at = NULL, error_message = 'Meta authorization was revoked before send', updated_at = NOW()
       FROM campaign_recipients AS recipient
       JOIN campaigns AS campaign ON campaign.id = recipient.campaign_id
      WHERE job.campaign_recipient_id = recipient.id
        AND campaign.business_id = $1
        AND job.status IN ('queued', 'retry')`,
    [businessId]
  );
  return { accountsRemoved: accounts.rowCount, queuedJobsStopped: jobs.rowCount };
}

async function clearAdsCredentials(client, businessId) {
  const connections = await client.query(
    `UPDATE whatsapp_ads_connections
        SET access_token_encrypted = '', authorization_status = 'revoked', leadgen_subscribed = FALSE, updated_at = NOW()
      WHERE business_id = $1`,
    [businessId]
  );
  const pending = await client.query('DELETE FROM ads_oauth_pending WHERE business_id = $1', [businessId]);
  const attempts = await client.query(
    `UPDATE ads_oauth_attempts SET status = 'failed' WHERE business_id = $1 AND status IN ('pending', 'claimed')`,
    [businessId]
  );
  return { connectionsRevoked: connections.rowCount, pendingRemoved: pending.rowCount, attemptsClosed: attempts.rowCount };
}

export async function revokeMetaUserAuthorizations(client, metaUserId, eventType) {
  const affected = await client.query(
    `SELECT id, business_id, integration, is_current
       FROM meta_authorizations
      WHERE meta_user_id = $1 AND status = 'active'
      FOR UPDATE`,
    [metaUserId]
  );
  const businessIds = [];
  for (const row of affected.rows) {
    if (!businessIds.includes(row.business_id)) businessIds.push(row.business_id);
    const otherCurrent = await client.query(
      `SELECT 1 FROM meta_authorizations
        WHERE business_id = $1 AND integration = $2 AND meta_user_id <> $3
          AND status = 'active' AND is_current = TRUE
        LIMIT 1`,
      [row.business_id, row.integration, metaUserId]
    );
    if (row.is_current && !otherCurrent.rowCount) {
      if (row.integration === 'whatsapp') await clearWhatsAppCredentials(client, row.business_id);
      if (row.integration === 'ads') await clearAdsCredentials(client, row.business_id);
    }
    await client.query(
      `UPDATE meta_authorizations
          SET status = 'revoked', is_current = FALSE, revoked_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [row.id]
    );
    await client.query(
      'INSERT INTO meta_connection_events (id, business_id, event_type, metadata) VALUES ($1,$2,$3,$4)',
      [id('mce'), row.business_id, eventType, JSON.stringify({ source: 'meta_callback', integration: row.integration })]
    );
    await client.query(
      'INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1,$2,NULL,$3,$4)',
      [id('a'), row.business_id, eventType, JSON.stringify({ source: 'meta_callback', integration: row.integration })]
    );
  }
  return { count: affected.rowCount, businessIds };
}
