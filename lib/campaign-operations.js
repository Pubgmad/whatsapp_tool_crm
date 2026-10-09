import { query, AppError } from './db.js';
import { getPlatformSettingValue } from './platform.js';
import { operationalPolicy } from './operational-policy.js';

const IANA = /^[A-Za-z_]+\/[A-Za-z0-9_+-]+$/;

export function assertCampaignScheduleWithinPolicy(scheduledAt, now = Date.now(), env = process.env) {
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= now) return;
  const maxDays = operationalPolicy(env).campaignMaxScheduleDays;
  const limitMs = now + maxDays * 24 * 60 * 60 * 1000;
  if (scheduledAt.getTime() > limitMs) {
    throw new AppError(`Campaigns can be scheduled up to ${maxDays} days ahead.`, 400, 'CAMPAIGN_SCHEDULE_TOO_FAR');
  }
}

export function validateCampaignTimezone(timezone) {
  const value = String(timezone || 'UTC').trim();
  if (!IANA.test(value)) return 'UTC';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
}

export async function activateDueScheduledCampaigns(run = query) {
  const due = (
    await run(
      `UPDATE campaigns SET status='queued',updated_at=NOW()
       WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at<=NOW()
       RETURNING id`
    )
  ).rows;
  return { activated: due.length };
}

export async function campaignQueueMetrics(run = query) {
  const row = (
    await run(
      `SELECT
        (SELECT COUNT(*)::int FROM campaign_jobs WHERE status IN ('queued','retry')) AS queued_jobs,
        (SELECT COUNT(*)::int FROM campaign_jobs WHERE status='processing') AS processing_jobs,
        (SELECT COUNT(*)::int FROM campaigns WHERE status='scheduled') AS scheduled_campaigns,
        (SELECT MIN(run_at) FROM campaign_jobs WHERE status IN ('queued','retry')) AS oldest_job_run_at`
    )
  ).rows[0];
  let configuredLag = Number(process.env.CAMPAIGN_QUEUE_MAX_LAG_SECONDS);
  try {
    const platformLag = Number(await getPlatformSettingValue('campaign_queue_max_lag_seconds', null));
    if (Number.isFinite(platformLag) && platformLag >= 60) configuredLag = platformLag;
  } catch {
    /* database optional in tests */
  }
  const maxLagMs = (Number.isFinite(configuredLag) && configuredLag >= 60 ? configuredLag : 600) * 1000;
  const oldest = row?.oldest_job_run_at ? new Date(row.oldest_job_run_at).getTime() : null;
  const lagOk = !oldest || Date.now() - oldest <= maxLagMs;
  return { ...row, lagOk, maxLagSeconds: maxLagMs / 1000 };
}
