import { AppError, errorJson, json } from "./db";
import { runCampaignQueue } from "./actions";
import { runAutomationQueue } from "./automation";

function clean(value) {
  return String(value || "").trim();
}

export async function processAllQueuesJob(request) {
  try {
    const expected = clean(process.env.JOB_RUNNER_SECRET);
    const header = clean(request.headers.get("authorization")).replace(/^Bearer\s+/i, "");
    if (!expected || expected.startsWith("replace-with")) throw new AppError("JOB_RUNNER_SECRET is not configured.", 503, "JOB_SECRET_NOT_CONFIGURED");
    if (header !== expected) throw new AppError("Invalid job runner secret.", 401, "JOB_UNAUTHORIZED");
    const body = await request.json().catch(() => ({}));
    const businessId = clean(body.businessId);
    const limit = Number(body.limit) || 25;
    const [campaigns, automation] = await Promise.all([
      runCampaignQueue({ businessId, limit }),
      runAutomationQueue({ businessId, limit })
    ]);
    return json({ ok: true, campaigns, automation });
  } catch (error) {
    return errorJson(error);
  }
}
