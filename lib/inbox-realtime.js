import { requireSession } from './auth.js';
import { AppError, errorJson, query } from './db.js';

const MAX_WAIT_MS = 25000;
const POLL_MS = 1200;

async function inboxRevision(businessId, conversationId = '') {
  if (conversationId) {
    const row = (await query(
      `SELECT COALESCE(version,0)::bigint AS revision, updated_at
       FROM conversations
       WHERE business_id=$1 AND id=$2`,
      [businessId, conversationId]
    )).rows[0];
    return {
      revision: row ? Number(row.revision) : 0,
      updatedAt: row?.updated_at || null,
      conversationId
    };
  }
  const row = (await query(
    `SELECT COALESCE(MAX(version),0)::bigint AS revision,
            MAX(updated_at) AS updated_at,
            COALESCE(SUM(unread_count),0)::int AS unread_total
     FROM conversations
     WHERE business_id=$1`,
    [businessId]
  )).rows[0];
  return {
    revision: Number(row?.revision || 0),
    updatedAt: row?.updated_at || null,
    unreadTotal: Number(row?.unread_total || 0),
    conversationId: ''
  };
}

export async function inboxStreamRequest(request) {
  try {
    const session = await requireSession(request);
    const url = new URL(request.url);
    const since = Number(url.searchParams.get('since') || 0);
    const conversationId = String(url.searchParams.get('conversationId') || '').trim();
    const accept = String(request.headers.get('accept') || '');
    const preferSse = accept.includes('text/event-stream') || url.searchParams.get('sse') === '1';

    if (preferSse) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const started = Date.now();
          let last = Number.isFinite(since) ? since : 0;
          const send = (event, data) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };
          send('connected', { ok: true, at: new Date().toISOString() });
          while (Date.now() - started < MAX_WAIT_MS) {
            if (request.signal?.aborted) break;
            const snapshot = await inboxRevision(session.businessId, conversationId);
            if (snapshot.revision !== last) {
              send('inbox', { ...snapshot, changed: true });
              last = snapshot.revision;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          }
          const finalSnapshot = await inboxRevision(session.businessId, conversationId);
          send('inbox', { ...finalSnapshot, changed: finalSnapshot.revision !== since });
          controller.close();
        }
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        }
      });
    }

    const started = Date.now();
    let snapshot = await inboxRevision(session.businessId, conversationId);
    while (Date.now() - started < MAX_WAIT_MS && snapshot.revision === since) {
      if (request.signal?.aborted) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      snapshot = await inboxRevision(session.businessId, conversationId);
    }
    return Response.json(
      { ...snapshot, changed: snapshot.revision !== since },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof AppError) return errorJson(error);
    return errorJson(error);
  }
}
