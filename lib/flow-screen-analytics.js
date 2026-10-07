import crypto from 'node:crypto';
import { id, query } from './db.js';

export async function recordFlowScreenView({ businessId, flowId, sessionId, screenId, completed = false }) {
  const screen = String(screenId || '').slice(0, 80);
  const session = String(sessionId || '').slice(0, 80);
  const flow = String(flowId || '').slice(0, 80);
  if (!businessId || !flow || !session || !screen) return;
  await query(
    `INSERT INTO flow_screen_events(id,business_id,flow_id,session_id,screen_id,event_kind)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [id('fse'), businessId, flow, session, screen, completed ? 'complete' : 'view']
  );
}

export function flowSessionKey(flowToken) {
  if (!/^[a-f0-9]{64}$/.test(String(flowToken || ''))) return '';
  return crypto.createHash('sha256').update(flowToken).digest('hex').slice(0, 32);
}

export async function flowScreenFunnelForBusiness(businessId) {
  return (
    await query(
      `SELECT flow_id,screen_id,
        COUNT(*) FILTER (WHERE event_kind='view')::int AS views,
        COUNT(*) FILTER (WHERE event_kind='complete')::int AS completions
       FROM flow_screen_events WHERE business_id=$1 AND created_at>NOW()-INTERVAL '90 days'
       GROUP BY flow_id,screen_id ORDER BY flow_id,views DESC`,
      [businessId]
    )
  ).rows;
}
