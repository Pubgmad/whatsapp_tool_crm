import { requireSession } from '@/lib/auth.js';
import { errorJson, json } from '@/lib/db.js';
import { inboxSlaDashboard } from '@/lib/inbox-sla-snapshot.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await requireSession(request);
    const payload = await inboxSlaDashboard(session.businessId, session.userId, session.role);
    return json(payload);
  } catch (error) {
    return errorJson(error);
  }
}
