import { buildPlatformParityReport } from './parity-report.js';
import { workspaceProductionCertification } from './production-certification.js';
import { workspaceOperationsReport } from './workspace-operations-report.js';
import { campaignFailedRecipientsWorkbench } from './campaign-failed-workbench.js';
import { workspaceProductionHub } from './workspace-production-hub.js';
import { campaignSourceAnalytics } from './campaign-source-analytics.js';

export async function workspaceResultsManagerBundle(businessId, options = {}) {
  const deepProbe = options.deepProbe === true;
  const [hub, certification, operations, failures, parity, campaignSources] = await Promise.all([
    workspaceProductionHub(businessId),
    workspaceProductionCertification(businessId, { deepProbe }),
    workspaceOperationsReport(businessId),
    campaignFailedRecipientsWorkbench(businessId, 75),
    buildPlatformParityReport({ businessId }),
    campaignSourceAnalytics(businessId, options)
  ]);
  return {
    generatedAt: new Date().toISOString(),
    hub,
    certification,
    operations,
    failures,
    campaignSources,
    parity: {
      summary: parity.summary,
      capabilities: parity.capabilities
    }
  };
}
