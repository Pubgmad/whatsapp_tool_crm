import { currentAccount } from '@/lib/auth.js';
import { loadState, stateOptions } from '@/lib/workspace-state.js';
import { workspaceRoute } from '@/lib/workspace-route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Full workspace bootstrap for the Inbox shell.
 * Must return the same shape as GET /api/workspace/[section] with view=inbox
 * (including setup, featureFlags, templates, teamMembers). A slim conversations-only
 * payload previously shadowed [section] and crashed /app/inbox on hard refresh.
 *
 * Uses workspaceRoute for session/CSRF/rate-limit policy, then currentAccount for the
 * full workspace account shape expected by loadState.
 */
export const GET = workspaceRoute(async (request, session) => {
  const account = await currentAccount(request);
  const options = { ...stateOptions(request), view: 'inbox' };
  if (!options.inboxFilter && (account.role || session.role) === 'Agent') options.inboxFilter = 'mine';
  return loadState(account, options);
});
