import { workspaceRoute } from '@/lib/workspace-route.ts';
import { loadWorkspaceInbox } from '@/lib/workspace-inbox-loader.js';
import { clean } from '@/lib/workspace-mappers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function inboxOptions(request) {
  const params = new URL(request.url).searchParams;
  const positiveInteger = (name, fallback, maximum = 100) =>
    Math.max(1, Math.min(Number.parseInt(params.get(name), 10) || fallback, maximum));
  return {
    page: positiveInteger('page', 1, 100000),
    pageSize: positiveInteger('pageSize', 25, 100),
    messagePage: positiveInteger('messagePage', 1),
    notePage: positiveInteger('notePage', 1),
    conversationId: clean(params.get('conversationId')),
    q: clean(params.get('q')).slice(0, 120),
    inboxFilter: clean(params.get('inboxFilter'))
  };
}

export const GET = workspaceRoute(async (request, session) => {
  const options = inboxOptions(request);
  if (!options.inboxFilter && session.role === 'Agent') options.inboxFilter = 'mine';
  return loadWorkspaceInbox(session.businessId, options, session);
});
