import { query } from './db.js';

export async function aiWorkspaceAnalytics(businessId, { days = 30 } = {}) {
  const windowDays = Number.isInteger(days) && days >= 1 && days <= 90 ? days : 30;
  const [autoReply, proposals, handoffs, safety, usage, knowledge, tests] = await Promise.all([
    query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status='sent')::int AS sent,
         COUNT(*) FILTER (WHERE status='skipped')::int AS skipped,
         COUNT(*) FILTER (WHERE status='failed')::int AS failed,
         COUNT(*) FILTER (WHERE status='unknown')::int AS unknown,
         COUNT(*) FILTER (WHERE last_error='AI_HANDOFF_REQUIRED')::int AS handoff_skips,
         COUNT(*) FILTER (WHERE last_error='AI_NO_SOURCE')::int AS no_source,
         ROUND(AVG(EXTRACT(EPOCH FROM (updated_at-created_at))) FILTER (WHERE status='sent')::numeric,2) AS avg_send_seconds
       FROM ai_auto_reply_jobs
       WHERE business_id=$1 AND created_at>=NOW()-($2::int * INTERVAL '1 day')`,
      [businessId, windowDays]
    ),
    query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status='pending')::int AS pending,
         COUNT(*) FILTER (WHERE status='completed')::int AS completed,
         COUNT(*) FILTER (WHERE status='rejected')::int AS rejected,
         COUNT(*) FILTER (WHERE status='failed')::int AS failed,
         COUNT(*) FILTER (WHERE status='unknown')::int AS unknown
       FROM ai_action_proposals
       WHERE business_id=$1 AND created_at>=NOW()-($2::int * INTERVAL '1 day')`,
      [businessId, windowDays]
    ),
    query(
      `SELECT COUNT(*)::int AS count FROM audit_logs
       WHERE business_id=$1 AND at>=NOW()-($2::int * INTERVAL '1 day')
         AND action IN ('ai_intent_routed','support_auto_assigned','conversation_assigned','conversation_takeover')`,
      [businessId, windowDays]
    ),
    query(
      `SELECT event_kind, COUNT(*)::int AS count FROM ai_safety_events
       WHERE business_id=$1 AND created_at>=NOW()-($2::int * INTERVAL '1 day')
       GROUP BY event_kind ORDER BY count DESC`,
      [businessId, windowDays]
    ),
    query(
      `SELECT COALESCE(SUM(requests),0)::int AS requests FROM ai_agent_daily_usage
       WHERE business_id=$1 AND usage_date>=((NOW() AT TIME ZONE 'UTC')::date - ($2::int * INTERVAL '1 day'))`,
      [businessId, windowDays]
    ),
    query(
      `SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE is_active)::int AS active
       FROM ai_agent_knowledge WHERE business_id=$1`,
      [businessId]
    ),
    query(
      `SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status='completed')::int AS completed,
         COUNT(*) FILTER (WHERE handoff)::int AS handoffs
       FROM ai_agent_test_runs
       WHERE business_id=$1 AND created_at>=NOW()-($2::int * INTERVAL '1 day')`,
      [businessId, windowDays]
    )
  ]);

  return {
    days: windowDays,
    autoReply: autoReply.rows[0],
    actions: proposals.rows[0],
    handoffEvents: handoffs.rows[0]?.count || 0,
    safety: safety.rows,
    aiRequests: usage.rows[0]?.requests || 0,
    knowledge: knowledge.rows[0],
    tests: tests.rows[0]
  };
}
