import { id } from './db.js';
import { purgeMetaLeadCopiesForPrincipal } from './meta-lead-deletion.js';

/**
 * Data covered by a Meta deletion request for the linked authorization:
 * - Credentials and pending OAuth tokens for integrations this principal currently owns.
 * - Meta-sourced lead payloads and ads insight payloads, including copies on contacts, events, and audit logs.
 * - Meta analytics snapshots collected for the workspace WhatsApp account.
 * Not deleted: the business, contacts the customer supplied, campaigns, templates,
 * invoices, or another principal's current credential on the same workspace.
 * Operator backups can reintroduce deleted rows after restore. Replay Meta deletion callbacks
 * or use super-admin deletion resume for any principal still entitled to erasure.
 */

function step(store, count, note = '') {
  return { store, count, note, at: new Date().toISOString() };
}

async function otherCurrentOwner(client, businessId, integration, metaUserId) {
  const row = await client.query(
    `SELECT 1 FROM meta_authorizations
      WHERE business_id = $1 AND integration = $2 AND meta_user_id <> $3
        AND status = 'active' AND is_current = TRUE
      LIMIT 1`,
    [businessId, integration, metaUserId]
  );
  return row.rowCount > 0;
}

export async function executeMetaPlatformDeletion(client, { metaUserId, businessIds }) {
  const log = [];
  for (const businessId of businessIds) {
    log.push(...(await purgeMetaLeadCopiesForPrincipal(client, { businessId, metaUserId })));
    const auths = (await client.query(
      `SELECT id, integration, is_current, status
         FROM meta_authorizations
        WHERE business_id = $1 AND meta_user_id = $2
        FOR UPDATE`,
      [businessId, metaUserId]
    )).rows;
    const integrations = new Set(auths.map((row) => row.integration));
    if (integrations.has('whatsapp') && !(await otherCurrentOwner(client, businessId, 'whatsapp', metaUserId))) {
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
            SET status = 'failed', locked_at = NULL, error_message = 'Meta data deletion stopped this send', updated_at = NOW()
           FROM campaign_recipients AS recipient
           JOIN campaigns AS campaign ON campaign.id = recipient.campaign_id
          WHERE job.campaign_recipient_id = recipient.id
            AND campaign.business_id = $1
            AND job.status IN ('queued', 'retry')`,
        [businessId]
      );
      const analytics = await client.query('DELETE FROM whatsapp_analytics_snapshots WHERE business_id = $1', [businessId]);
      log.push(step('whatsapp_credentials', accounts.rowCount));
      log.push(step('queued_campaign_jobs', jobs.rowCount));
      log.push(step('whatsapp_analytics_snapshots', analytics.rowCount));
    } else if (integrations.has('whatsapp')) {
      log.push(step('whatsapp_credentials', 0, 'left_in_place_other_current_principal'));
    }
    if (integrations.has('ads') && !(await otherCurrentOwner(client, businessId, 'ads', metaUserId))) {
      const connections = await client.query(
        `UPDATE whatsapp_ads_connections
            SET access_token_encrypted = '', authorization_status = 'revoked', leadgen_subscribed = FALSE, updated_at = NOW()
          WHERE business_id = $1`,
        [businessId]
      );
      const pending = await client.query('DELETE FROM ads_oauth_pending WHERE business_id = $1', [businessId]);
      await client.query(
        `UPDATE ads_oauth_attempts SET status = 'failed' WHERE business_id = $1 AND status IN ('pending', 'claimed')`,
        [businessId]
      );
      const insights = await client.query(
        `UPDATE whatsapp_ads_insight_snapshots
            SET actions = '[]'::jsonb, raw = '{}'::jsonb
          WHERE business_id = $1`,
        [businessId]
      );
      log.push(step('ads_credentials', connections.rowCount));
      log.push(step('ads_oauth_pending', pending.rowCount));
      log.push(step('ads_insight_payloads', insights.rowCount, 'anonymized'));
    } else if (integrations.has('ads')) {
      log.push(step('ads_credentials', 0, 'left_in_place_other_current_principal'));
    }
    const removed = await client.query(
      'DELETE FROM meta_authorizations WHERE business_id = $1 AND meta_user_id = $2',
      [businessId, metaUserId]
    );
    log.push(step('meta_authorizations', removed.rowCount, 'linkage_removed_after_deletion'));
    await client.query(
      'INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1,$2,NULL,$3,$4)',
      [id('a'), businessId, 'meta_data_deleted', JSON.stringify({ stores: log.filter((item) => item.store).map((item) => item.store) })]
    );
  }
  return log;
}
