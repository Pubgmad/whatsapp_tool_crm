import crypto from 'node:crypto';
import { id, query } from './db.js';

export async function recordFlowScreenView({ businessId, flowId, sessionId, screenId, completed = false, abandoned = false }) {
  const screen = String(screenId || '').slice(0, 80);
  const session = String(sessionId || '').slice(0, 80);
  const flow = String(flowId || '').slice(0, 80);
  if (!businessId || !flow || !session || !screen) return;
  const eventKind = completed ? 'complete' : abandoned ? 'abandon' : 'view';
  await query(
    `INSERT INTO flow_screen_events(id,business_id,flow_id,session_id,screen_id,event_kind)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [id('fse'), businessId, flow, session, screen, eventKind]
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
        COUNT(*) FILTER (WHERE event_kind='complete')::int AS completions,
        COUNT(*) FILTER (WHERE event_kind='abandon')::int AS abandons,
        COUNT(DISTINCT session_id) FILTER (WHERE event_kind='view')::int AS sessions
       FROM flow_screen_events WHERE business_id=$1 AND created_at>NOW()-INTERVAL '90 days'
       GROUP BY flow_id,screen_id ORDER BY flow_id,views DESC`,
      [businessId]
    )
  ).rows;
}

export async function flowScreenDropOffForFlow(businessId, flowId) {
  const rows = (
    await query(
      `WITH screen_views AS (
         SELECT session_id, screen_id,
           MIN(created_at) AS first_at
         FROM flow_screen_events
         WHERE business_id=$1 AND flow_id=$2 AND event_kind='view' AND created_at>NOW()-INTERVAL '90 days'
         GROUP BY session_id, screen_id
       ),
       completed_sessions AS (
         SELECT DISTINCT session_id FROM flow_screen_events
         WHERE business_id=$1 AND flow_id=$2 AND event_kind='complete'
       )
       SELECT v.screen_id,
         COUNT(*)::int AS views,
         COUNT(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM completed_sessions c WHERE c.session_id=v.session_id
         ))::int AS drop_offs,
         ROUND(100.0 * COUNT(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM completed_sessions c WHERE c.session_id=v.session_id
         )) / NULLIF(COUNT(*),0), 1) AS drop_off_rate
       FROM screen_views v
       GROUP BY v.screen_id
       ORDER BY views DESC`,
      [businessId, flowId]
    )
  ).rows;
  return rows;
}

export async function flowScreenDropOffForBusiness(businessId) {
  const flows = (await query('SELECT id FROM whatsapp_native_flows WHERE business_id=$1', [businessId])).rows;
  const rows = [];
  for (const flow of flows) {
    const dropOff = await flowScreenDropOffForFlow(businessId, flow.id);
    rows.push(...dropOff.map((entry) => ({ flow_id: flow.id, ...entry })));
  }
  return rows;
}
