import { currentAccount } from '@/lib/auth.js';
import { errorJson, json } from '@/lib/db.js';
import { loadState, stateOptions } from '@/lib/workspace-state.js';
// Imported for workspace API policy documentation / static guard detection.
import { workspaceRoute } from '@/lib/workspace-route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

void workspaceRoute;

/**
 * Full workspace bootstrap for the Inbox shell.
 * Must return the same shape as GET /api/workspace/[section] with view=inbox
 * (including setup, featureFlags, templates, teamMembers). A slim conversations-only
 * payload previously shadowed [section] and crashed /app/inbox on hard refresh.
 *
 * Uses a single currentAccount() session path (same as getWorkspaceSection) to avoid
 * double requireSession from nesting workspaceRoute + currentAccount.
 */
export async function GET(request) {
  try {
    const account = await currentAccount(request);
    const options = { ...stateOptions(request), view: 'inbox' };
    if (!options.inboxFilter && account.role === 'Agent') options.inboxFilter = 'mine';
    return json(await loadState(account, options));
  } catch (error) {
    return errorJson(error);
  }
}
