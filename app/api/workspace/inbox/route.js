import { currentAccount } from '@/lib/auth.js';
import { errorJson, json } from '@/lib/db.js';
import { loadState, stateOptions } from '@/lib/workspace-state.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Full workspace bootstrap for the Inbox shell.
 * Must return the same shape as GET /api/workspace/[section] with view=inbox
 * (including setup, featureFlags, templates, teamMembers). A slim conversations-only
 * payload previously shadowed [section] and crashed /app/inbox on hard refresh.
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
