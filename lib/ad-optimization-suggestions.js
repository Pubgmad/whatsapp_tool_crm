import { AppError, id, query, json, errorJson } from './db.js';
import { requireSession } from './auth.js';
import { requireWorkspaceManager } from './workspace-permissions.js';
import { readJsonBodyLimited } from './security.js';

export async function listAdOptimizationSuggestions(businessId, { limit = 25 } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const rows = await query(
    `SELECT id, operation_id, suggestion_kind, payload, status, created_at
     FROM ad_optimization_suggestions WHERE business_id=$1 AND status='pending'
     ORDER BY created_at DESC LIMIT $2`,
    [businessId, capped]
  );
  return { suggestions: rows.rows };
}

export async function recordAdOptimizationSuggestion(businessId, { operationId, kind, payload }) {
  const suggestionId = id('aos');
  await query(
    `INSERT INTO ad_optimization_suggestions (id, business_id, operation_id, suggestion_kind, payload, status)
     VALUES ($1,$2,$3,$4,$5::jsonb,'pending')`,
    [suggestionId, businessId, operationId || null, String(kind || 'budget').slice(0, 64), JSON.stringify(payload || {})]
  );
  return suggestionId;
}

export async function adOptimizationSuggestionsRequest(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    if (request.method === 'GET') {
      const limit = Number(new URL(request.url).searchParams.get('limit')) || 25;
      return json(await listAdOptimizationSuggestions(session.businessId, { limit }));
    }
    const body = await readJsonBodyLimited(request, 65536);
    if (body.action === 'dismiss' && body.id) {
      await query(
        "UPDATE ad_optimization_suggestions SET status='dismissed' WHERE id=$1 AND business_id=$2",
        [body.id, session.businessId]
      );
      return json({ ok: true });
    }
    if (body.action === 'record' && body.kind) {
      const suggestionId = await recordAdOptimizationSuggestion(session.businessId, {
        operationId: body.operationId,
        kind: body.kind,
        payload: body.payload
      });
      return json({ ok: true, id: suggestionId }, 201);
    }
    throw new AppError('Invalid optimization action.', 400, 'VALIDATION_ERROR');
  } catch (error) {
    return errorJson(error);
  }
}
