import { AppError, errorJson, json } from "./db";
import { runCampaignQueue } from "./actions";
import { runAutomationQueue } from "./automation";
import { readOptionalJsonBodyLimited } from "./security";

import { query } from './db.js';

function clean(value) {
  return String(value || "").trim();
}

export async function processAllQueuesJob(request) {
  try {
    const { enterSystemContext } = await import('./db');
    enterSystemContext();
    const expected = clean(process.env.JOB_RUNNER_SECRET);
    const header = clean(request.headers.get("authorization")).replace(/^Bearer\s+/i, "");
    if (!expected || expected.startsWith("replace-with")) throw new AppError("JOB_RUNNER_SECRET is not configured.", 503, "JOB_SECRET_NOT_CONFIGURED");
    if (header !== expected) throw new AppError("Invalid job runner secret.", 401, "JOB_UNAUTHORIZED");
    const body = await readOptionalJsonBodyLimited(request, 16384);
    const { runRetentionJobs } = await import('./retention');
    const businessId = clean(body.businessId);
    const limit = Number(body.limit) || 25;
    const [campaigns, automation, retention] = await Promise.all([
      runCampaignQueue({ businessId, limit }),
      runAutomationQueue({ businessId, limit }),
      body.runRetention === false ? Promise.resolve(null) : runRetentionJobs()
    ]);
    await query(
      `INSERT INTO worker_heartbeats (worker_name,last_success_at) VALUES ('queue',NOW())
       ON CONFLICT (worker_name) DO UPDATE SET last_success_at=NOW(),updated_at=NOW()`
    );
    return json({ ok: true, campaigns, automation, retention });
  } catch (error) {
    return errorJson(error);
  }
}
