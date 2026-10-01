import { query } from "./db.js";

export function workerIsFresh(lastSuccessAt, now = Date.now(), pollIntervalMs = Number(process.env.JOB_POLL_INTERVAL_MS) || 15000) {
  const tolerance = Math.max(60000, pollIntervalMs * 4);
  const timestamp = lastSuccessAt ? new Date(lastSuccessAt).getTime() : NaN;
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= tolerance;
}

export async function readiness() {
  try {
    const [result, schema] = await Promise.all([
      query("SELECT last_success_at FROM worker_heartbeats WHERE worker_name='queue'"),
      query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='feature_overrides') AS ready")
    ]);
    const workerReady = workerIsFresh(result.rows[0]?.last_success_at);
    const schemaReady = Boolean(schema.rows[0]?.ready);
    return Response.json({ status: workerReady && schemaReady ? "ready" : "degraded", database: "ready", schema: schemaReady ? "ready" : "outdated", worker: workerReady ? "ready" : "stale" }, {
      status: workerReady && schemaReady ? 200 : 503,
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    return Response.json({ status: "unavailable", database: "unavailable", worker: "unknown" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
