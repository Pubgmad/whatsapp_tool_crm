import { currentAccount } from '@/lib/auth';
import { errorJson, json } from '@/lib/db';
import { readJsonBodyLimited } from '@/lib/security';
import { requireWorkspaceManager } from '@/lib/workspace-permissions';
import { simulateAutomationFlow } from '@/lib/automation-simulate.js';
import { withWorkspaceFeature } from '@/lib/feature-controls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function postAutomationSimulate(request) {
  try {
    const account = await currentAccount(request);
    requireWorkspaceManager(account);
    const body = await readJsonBodyLimited(request, 1_000_000);
    const result = simulateAutomationFlow(body.definition, {
      text: body.text, values: body.values, apiOutcome: body.apiOutcome,
      apiStatus: body.apiStatus, advancedOutcome: body.advancedOutcome
    });
    return json(result);
  } catch (error) {
    return errorJson(error);
  }
}

export const POST = withWorkspaceFeature('automation', postAutomationSimulate);
