import { buildPlatformParityReport } from './parity-report.js';
import { workspaceProductionCertification } from './production-certification.js';
import { workspaceOperationsReport } from './workspace-operations-report.js';
import { campaignFailedRecipientsWorkbench } from './campaign-failed-workbench.js';
import { workspaceProductionHub } from './workspace-production-hub.js';
import { campaignSourceAnalytics } from './campaign-source-analytics.js';

function settledValue(result, fallback) {
  return result.status === 'fulfilled' ? result.value : fallback;
}

function settledError(result) {
  if (result.status !== 'rejected') return null;
  const error = result.reason;
  return {
    code: error?.code || 'RESULTS_SECTION_FAILED',
    message: String(error?.message || 'Section failed to load').slice(0, 240)
  };
}

/**
 * Campaign Insights manager bundle. Sections load independently so a failure in
 * hub/parity/certification does not blank Campaign origins or journey tools.
 */
export async function workspaceResultsManagerBundle(businessId, options = {}) {
  const deepProbe = options.deepProbe === true;
  const [
    hubResult,
    certificationResult,
    operationsResult,
    failuresResult,
    parityResult,
    campaignSourcesResult
  ] = await Promise.allSettled([
    workspaceProductionHub(businessId),
    workspaceProductionCertification(businessId, { deepProbe }),
    workspaceOperationsReport(businessId),
    campaignFailedRecipientsWorkbench(businessId, 75),
    buildPlatformParityReport({ businessId }),
    campaignSourceAnalytics(businessId, options)
  ]);

  const sectionErrors = {
    hub: settledError(hubResult),
    certification: settledError(certificationResult),
    operations: settledError(operationsResult),
    failures: settledError(failuresResult),
    parity: settledError(parityResult),
    campaignSources: settledError(campaignSourcesResult)
  };

  const parity = settledValue(parityResult, null);

  return {
    generatedAt: new Date().toISOString(),
    hub: settledValue(hubResult, null),
    certification: settledValue(certificationResult, null),
    operations: settledValue(operationsResult, null),
    failures: settledValue(failuresResult, null),
    campaignSources: settledValue(campaignSourcesResult, []),
    parity: parity
      ? {
          summary: parity.summary,
          capabilities: parity.capabilities
        }
      : null,
    sectionErrors
  };
}
