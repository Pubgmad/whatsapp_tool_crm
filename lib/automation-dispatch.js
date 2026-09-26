import { AppError, query } from "./db.js";

export async function assertAutomationDispatchAllowed({ businessId, contactId, sessionId }) {
  const state = (await query(
    `SELECT c.unsubscribed, s.status AS session_status, COALESCE(v.automation_paused,FALSE) AS automation_paused
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
}
