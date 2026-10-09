import { requireSession } from './auth.js';
import { AppError, query, transaction, json, errorJson, id } from './db.js';
import { readJsonBodyLimited } from './security.js';
import { callingHoursOpen, validateCallingHours } from './calling-business-hours.js';

const defaultCallingHours = { useSupportPolicy: true };

async function settingsResult(businessId, at = new Date()) {
  const [business, support] = await Promise.all([
    query('SELECT meta_connection_metadata FROM businesses WHERE id=$1', [businessId]),
    query('SELECT config FROM support_policies WHERE business_id=$1', [businessId])
  ]);
  const meta = business.rows[0]?.meta_connection_metadata || {};
  const callingHours = validateCallingHours(meta.callingHours || defaultCallingHours);
  const supportPolicy = support.rows[0]?.config || null;
  const open = await callingHoursOpen(businessId, supportPolicy, callingHours, at);
  return {
    callingHours,
    preview: {
      open,
      evaluatedAt: at.toISOString(),
      source: callingHours.useSupportPolicy ? 'support_policy' : 'dedicated',
      timezone: callingHours.useSupportPolicy ? supportPolicy?.timezone || null : callingHours.timezone,
      closedBehavior: 'New outgoing calls and answers to incoming calls are blocked. Active calls can still be ended.'
    },
    supportPolicyAvailable: Boolean(supportPolicy)
  };
}

export async function callingSettingsRequest(request) {
  try {
    const session = await requireSession(request);
    if (!['Owner', 'Manager'].includes(session.role)) throw new AppError('Owner or Manager access is required.', 403, 'FORBIDDEN');
    if (request.method === 'GET') {
      return json(await settingsResult(session.businessId));
    }
    const body = await readJsonBodyLimited(request, 32768);
    if (!Object.hasOwn(body, 'callingHours')) throw new AppError('Calling hours are required.', 400, 'VALIDATION_ERROR');
    const callingHours = validateCallingHours(body.callingHours);
    await transaction(async (client) => {
      const support = await client.query('SELECT config FROM support_policies WHERE business_id=$1', [session.businessId]);
      if (callingHours.useSupportPolicy && !support.rows[0]?.config) {
        throw new AppError('Configure a support policy before using its business hours.', 409, 'SUPPORT_POLICY_REQUIRED');
      }
      await client.query(
        "UPDATE businesses SET meta_connection_metadata=jsonb_set(COALESCE(meta_connection_metadata,'{}'::jsonb),'{callingHours}',$1::jsonb),updated_at=NOW() WHERE id=$2",
        [JSON.stringify(callingHours), session.businessId]
      );
      await client.query(
        "INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'calling_hours_updated',$4)",
        [id('a'), session.businessId, session.userId, JSON.stringify({ callingHours })]
      );
    });
    return json({ ok: true, ...(await settingsResult(session.businessId)) });
  } catch (error) {
    return errorJson(error);
  }
}
