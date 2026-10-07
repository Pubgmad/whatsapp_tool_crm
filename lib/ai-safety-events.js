import { id, query } from './db.js';

export async function recordAiSafetyEvent(
  { businessId, conversationId, eventKind, source = 'inbound', detail = '', metadata = {} },
  run = query
) {
  if (!businessId || !eventKind) return;
  await run(
    `INSERT INTO ai_safety_events(id,business_id,conversation_id,event_kind,source,detail,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      id('ase'),
      businessId,
      conversationId || null,
      eventKind,
      String(source || 'inbound').slice(0, 40),
      String(detail || '').slice(0, 500),
      JSON.stringify(metadata || {})
    ]
  );
}

export async function aiSafetyDashboard(businessId, run = query) {
  const since24 = (
    await run(
      `SELECT
        COUNT(*) FILTER (WHERE event_kind='prompt_injection')::int AS injection_24h,
        COUNT(*) FILTER (WHERE event_kind='policy_blocked')::int AS blocked_24h,
        COUNT(*) FILTER (WHERE event_kind='rate_limited')::int AS rate_limited_24h,
        COUNT(*) FILTER (WHERE event_kind='autonomous_denied')::int AS autonomous_denied_24h,
        COUNT(*) FILTER (WHERE event_kind='eval_sample')::int AS eval_samples_24h,
        COUNT(*)::int AS total_24h
       FROM ai_safety_events WHERE business_id=$1 AND created_at>NOW()-INTERVAL '24 hours'`,
      [businessId]
    )
  ).rows[0];
  const recent = (
    await run(
      `SELECT id,event_kind,source,detail,conversation_id,created_at
       FROM ai_safety_events WHERE business_id=$1 ORDER BY created_at DESC LIMIT 25`,
      [businessId]
    )
  ).rows;
  const daily = (
    await run(
      `SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
        COUNT(*) FILTER (WHERE event_kind='prompt_injection')::int AS injection,
        COUNT(*) FILTER (WHERE event_kind='policy_blocked')::int AS blocked
       FROM ai_safety_events
       WHERE business_id=$1 AND created_at>NOW()-INTERVAL '14 days'
       GROUP BY 1 ORDER BY 1 DESC`,
      [businessId]
    )
  ).rows;
  return {
    last24h: {
      injection: Number(since24?.injection_24h || 0),
      blocked: Number(since24?.blocked_24h || 0),
      rateLimited: Number(since24?.rate_limited_24h || 0),
      autonomousDenied: Number(since24?.autonomous_denied_24h || 0),
      evalSamples: Number(since24?.eval_samples_24h || 0),
      total: Number(since24?.total_24h || 0)
    },
    daily,
    recent
  };
}
