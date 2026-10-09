import { workspaceRoute } from '@/lib/workspace-route.ts';
import { loadWorkspaceGroupsInbox, markWorkspaceGroupRead, sendWorkspaceGroupMessage } from '@/lib/workspace-groups-inbox.js';
import { assertWorkspaceFeature } from '@/lib/feature-controls.js';
import { readJsonBodyLimited } from '@/lib/security.js';
import { AppError } from '@/lib/db.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (request, session) => {
  await assertWorkspaceFeature('whatsapp_groups', session.businessId);
  const params = new globalThis.URL(request.url).searchParams;
  const inbox = await loadWorkspaceGroupsInbox(session.businessId, {
    page: params.get('page'),
    pageSize: params.get('pageSize'),
    messagePage: params.get('messagePage'),
    messagePageSize: params.get('messagePageSize'),
    groupId: params.get('groupId'),
    q: params.get('q')
  });
  return { ...inbox, permissions: { canSync: ['Owner', 'Manager'].includes(session.role), canSend: true } };
});

export const POST = workspaceRoute(async (request, session) => {
  await assertWorkspaceFeature('whatsapp_groups', session.businessId);
  const body = await readJsonBodyLimited(request, 10000);
  if (body.action === 'send') return sendWorkspaceGroupMessage(session.businessId, session.userId, body);
  if (body.action === 'mark_read') return markWorkspaceGroupRead(session.businessId, body.groupId);
  throw new AppError('Unsupported group inbox action.', 400, 'VALIDATION_ERROR');
});
