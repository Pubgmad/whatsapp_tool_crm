import { buildPlatformParityReport } from './parity-report.js';
import { workspaceProductionCertification } from './production-certification.js';
import { workspaceOperationsReport } from './workspace-operations-report.js';
import { campaignFailedRecipientsWorkbench } from './campaign-failed-workbench.js';
import { workspaceProductionHub } from './workspace-production-hub.js';

export async function workspaceResultsManagerBundle(businessId, options = {}) {
  const deepProbe = options.deepProbe === true;
  const [hub, certification, operations, failures, parity] = await Promise.all([
    workspaceProductionHub(businessId),
    workspaceProductionCertification(businessId, { deepProbe }),
    workspaceOperationsReport(businessId),
    campaignFailedRecipientsWorkbench(businessId, 75),
    buildPlatformParityReport({ businessId })
  ]);
  return {
    generatedAt: new Date().toISOString(),
    hub,
    certification,
    operations,
    failures,
    parity: {
      summary: parity.summary,
      capabilities: parity.capabilities
    }
  };
}
