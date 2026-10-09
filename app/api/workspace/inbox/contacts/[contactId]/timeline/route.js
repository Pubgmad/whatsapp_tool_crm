import { URL } from 'node:url';
import { workspaceRoute } from '@/lib/workspace-route.ts';
import { loadInboxContactTimeline } from '@/lib/inbox-contact-360.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (request, session, context) => {
  const { contactId } = await context.params;
  const params = new URL(request.url).searchParams;
  return loadInboxContactTimeline(session.businessId, contactId, session, {
    cursor: params.get('cursor'),
    limit: params.get('limit')
  });
});
