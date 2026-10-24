import { id, query, transaction } from './db.js';

export function collectWhatsAppRemoteCleanupTargets(business, accounts = []) {
  const cleanupTargets = [];
  const seenWaba = new Set();
  for (const account of accounts) {
    if (!account.waba_id || seenWaba.has(account.waba_id)) continue;
    seenWaba.add(account.waba_id);
    if (account.webhook_subscribed && account.access_token_encrypted) {
      cleanupTargets.push({ wabaId: account.waba_id, tokenEncrypted: account.access_token_encrypted });
    }
  }
  if (business?.webhook_subscribed && business.waba_id && business.access_token_encrypted && !seenWaba.has(business.waba_id)) {
    cleanupTargets.push({ wabaId: business.waba_id, tokenEncrypted: business.access_token_encrypted });
  }
  return cleanupTargets;
}

export async function applyLocalWhatsAppDisconnect({ businessId, userId, remoteCleanupState = 'not_required' }) {
  await transaction(async (client) => {
    await client.query(
      `UPDATE campaign_jobs AS job
          SET status = 'failed', locked_at = NULL, error_message = 'WhatsApp disconnected locally', updated_at = NOW()
         FROM campaign_recipients AS recipient
         JOIN campaigns AS campaign ON campaign.id = recipient.campaign_id
        WHERE job.campaign_recipient_id = recipient.id
          AND campaign.business_id = $1
          AND job.status IN ('queued', 'retry', 'processing')`,
      [businessId]
    );
    await client.query(
      `UPDATE ads_oauth_attempts SET status = 'failed'
        WHERE business_id = $1 AND status IN ('pending', 'claimed')`,
      [businessId]
    );
    await client.query(
      `UPDATE businesses SET whatsapp_number = '', waba_id = '', phone_number_id = '', access_token_encrypted = '', status = 'Needs setup', onboarding_method = 'manual', meta_token_expires_at = NULL, meta_connected_at = NULL, webhook_subscribed = FALSE, meta_connection_metadata = '{}'::jsonb, updated_at = NOW() WHERE id = $1`,
      [businessId]
    );
    await client.query('DELETE FROM whatsapp_accounts WHERE business_id = $1', [businessId]);
    await client.query(
      `UPDATE meta_authorizations
          SET status = 'revoked', is_current = FALSE, revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW()
        WHERE business_id = $1 AND integration = 'whatsapp'`,
      [businessId]
    );
    await client.query(
      "INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1, $2, $3, 'meta_disconnected', $4)",
      [id('a'), businessId, userId, JSON.stringify({ remoteCleanup: remoteCleanupState })]
    );
  });
}

export async function readWhatsAppAuthorizationSeq(businessId) {
  const authRow = (
    await query(
      `SELECT authorization_seq FROM meta_authorizations
        WHERE business_id=$1 AND integration='whatsapp' AND is_current=TRUE
        ORDER BY updated_at DESC LIMIT 1`,
      [businessId]
    )
  ).rows[0];
  return Number(authRow?.authorization_seq || 0);
}
