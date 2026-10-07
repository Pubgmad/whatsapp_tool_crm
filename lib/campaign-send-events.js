import { id, query } from './db.js';
import { isRetryableCampaignJobError } from './campaign-retry-policy.js';

function clean(value) {
  return String(value || '').slice(0, 500);
}

export async function recordCampaignSendEvent(
  {
    businessId,
    campaignId,
    campaignRecipientId,
    jobId,
    httpStatus = 0,
    errorCode = '',
    errorMessage = '',
    eventKind = 'failure'
  },
  run = query
) {
  if (!businessId || !campaignRecipientId) return;
  const retryable = eventKind === 'failure' ? isRetryableCampaignJobError({ status: httpStatus, code: errorCode, message: errorMessage }) : false;
  await run(
    `INSERT INTO campaign_send_events(id,business_id,campaign_id,campaign_recipient_id,job_id,event_kind,http_status,error_code,error_message,retryable)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id('cse'),
      businessId,
      campaignId || null,
      campaignRecipientId,
      jobId || null,
      eventKind,
      Number(httpStatus) || 0,
      clean(errorCode),
      clean(errorMessage),
      retryable
    ]
  );
}

export async function campaignSendEventMetrics(businessId, run = query) {
  const row = (
    await run(
      `SELECT
        COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '24 hours')::int AS events_24h,
        COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '24 hours' AND retryable)::int AS retryable_24h,
        COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '24 hours' AND http_status=429)::int AS rate_limited_24h,
        COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '24 hours' AND NOT retryable AND event_kind='failure')::int AS terminal_24h
       FROM campaign_send_events WHERE business_id=$1`,
      [businessId]
    )
  ).rows[0];
  return {
    events24h: Number(row?.events_24h || 0),
    retryable24h: Number(row?.retryable_24h || 0),
    rateLimited24h: Number(row?.rate_limited_24h || 0),
    terminal24h: Number(row?.terminal_24h || 0)
  };
}
