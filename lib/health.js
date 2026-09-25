import { query } from "./db.js";

export function workerIsFresh(lastSuccessAt, now = Date.now(), pollIntervalMs = Number(process.env.JOB_POLL_INTERVAL_MS) || 15000) {
  const tolerance = Math.max(60000, pollIntervalMs * 4);
  const timestamp = lastSuccessAt ? new Date(lastSuccessAt).getTime() : NaN;
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= tolerance;
}

export async function readiness() {
  try {
    const result = await query("SELECT last_success_at FROM worker_heartbeats WHERE worker_name='queue'");
    const workerReady = workerIsFresh(result.rows[0]?.last_success_at);
    return Response.json({ status: workerReady ? "ready" : "degraded", database: "ready", worker: workerReady ? "ready" : "stale" }, {
      status: workerReady ? 200 : 503,
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    return Response.json({ status: "unavailable", database: "unavailable", worker: "unknown" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
