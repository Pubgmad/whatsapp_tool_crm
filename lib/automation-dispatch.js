import { AppError, query } from "./db.js";
import { okToReply } from "./reply-window.js";
import { workspaceFeatureFlags } from "./feature-controls.js";

export async function assertAutomationDispatchAllowed({ businessId, contactId, sessionId, messageType = '', category = '' }) {
  const state = (await query(
    `SELECT c.unsubscribed,c.last_message_at,c.marketing_permission,s.context,
            c.opt_in_at IS NOT NULL AND EXISTS (
              SELECT 1 FROM contact_consent_events ce
              WHERE ce.business_id=c.business_id AND ce.contact_id=c.id
                AND ce.source=c.opt_in_source AND ce.occurred_at>=c.opt_in_at
                AND LENGTH(ce.evidence)>=10
            ) AS recorded_opt_in,
            s.status AS session_status, COALESCE(v.automation_paused,FALSE) AS automation_paused
     FROM automation_sessions s
     JOIN contacts c ON c.id=s.contact_id AND c.business_id=s.business_id
     LEFT JOIN conversations v ON v.business_id=s.business_id AND v.contact_id=s.contact_id
     WHERE s.id=$1 AND s.business_id=$2 AND s.contact_id=$3`,
    [sessionId, businessId, contactId]
  )).rows[0];
  if (!state || state.session_status !== "active" || state.automation_paused) {
    throw new AppError("Automation stopped or handed to an agent.", 409, "AUTOMATION_SUPERSEDED");
  }
  if (state.unsubscribed) {
    throw new AppError("Customer opted out of automated messages.", 409, "AUTOMATION_OPTED_OUT");
  }
  if (state.context?.commerceOrderId || state.context?.providerConnectorId) {
    const flags = await workspaceFeatureFlags(businessId);
    if (!flags.automation || (state.context.commerceOrderId && !flags.commerce) ||
      (state.context.providerConnectorId && !flags.connectors) ||
      (state.context.providerCheckoutId && !flags.checkout_recovery)) {
      throw new AppError('This automated workflow is disabled.', 403, 'FEATURE_DISABLED');
    }
  }
  if (state.context?.providerCheckoutId) {
    const checkout = (await query(`SELECT 1 FROM provider_connector_records r
      JOIN provider_connectors c ON c.id=r.connector_id AND c.business_id=r.business_id
      WHERE r.business_id=$1 AND r.connector_id=$2 AND r.external_id=$3 AND r.resource='checkout'
        AND r.recovery_status='queued' AND r.recovery_session_id=$4
        AND r.data->>'terminal'='false' AND COALESCE(r.data->>'checkoutUrlEncrypted','')<>'' AND c.enabled AND c.recovery_enabled
        AND NOT EXISTS (SELECT 1 FROM provider_connector_records o WHERE o.business_id=r.business_id AND o.connector_id=r.connector_id
          AND o.resource='order' AND o.data->>'checkoutId'=r.external_id)
        AND NOT EXISTS (SELECT 1 FROM provider_connector_events e WHERE e.business_id=r.business_id AND e.connector_id=r.connector_id
          AND e.status='queued' AND ((e.data->>'resource'='order' AND e.data->>'checkoutId'=r.external_id)
            OR (e.data->>'resource'='checkout' AND e.data->>'externalId'=r.external_id AND e.data->>'terminal'='true')))`,
      [businessId,state.context.providerConnectorId,state.context.providerCheckoutId,sessionId])).rowCount;
    if (!checkout) throw new AppError('Checkout recovery is no longer applicable.',409,'CHECKOUT_RECOVERY_STOPPED');
  }
  if (messageType === 'freeform' && !okToReply(state)) {
    throw new AppError('WhatsApp reply window closed.', 403, 'REPLY_WINDOW_CLOSED');
  }
  if (messageType === 'template' && ((category === 'MARKETING' && !state.marketing_permission) ||
    ((category === 'MARKETING' || !okToReply(state)) && !state.recorded_opt_in))) {
    throw new AppError('Recorded WhatsApp opt-in is required for this automated template.', 403, 'AUTOMATION_CONSENT_REQUIRED');
  }
}
