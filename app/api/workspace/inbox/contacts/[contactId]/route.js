import { workspaceRoute } from '@/lib/workspace-route.ts';
import { loadInboxContactProfile, updateInboxContactTags } from '@/lib/inbox-contact-360.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (_request, session, context) => {
  const { contactId } = await context.params;
  return loadInboxContactProfile(session.businessId, contactId, session);
});

export const PATCH = workspaceRoute(async (request, session, context) => {
  const { contactId } = await context.params;
  return updateInboxContactTags(request, session.businessId, contactId, session);
});
