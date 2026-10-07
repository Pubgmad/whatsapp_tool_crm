import { getPlatformOperationsSnapshot } from './platform-operations.js';
import {
  PRODUCT_CAPABILITIES,
  PRODUCT_CAPABILITY_GROUPS,
  metaCapabilityByKey,
  registrySummary,
  workspaceFeatureLabel
} from './product-capability-registry.js';

function mergeLiveStatus({ codeStatus, metaAvailable, certificationPass, certificationFail }) {
  if (codeStatus === 'gap') return 'gap';
  if (certificationFail) return 'live_attention';
  if (codeStatus === 'strong' && metaAvailable !== false && certificationPass !== false) return 'production_ready_code';
  return 'partial';
}

export async function buildPlatformParityReport({ businessId = null } = {}) {
  const generatedAt = new Date().toISOString();
  const summary = registrySummary();
  const { summarizeMetaCapabilitiesForAdmin } = await import('./whatsapp-operations.js');
  const { workspaceProductionCertification } = await import('./production-certification.js');
  const [operations, metaCapabilities, certification] = await Promise.all([
    getPlatformOperationsSnapshot(),
    businessId ? summarizeMetaCapabilitiesForAdmin(businessId) : Promise.resolve(null),
    businessId ? workspaceProductionCertification(businessId) : Promise.resolve(null)
  ]);

  const metaMap = new Map((metaCapabilities?.capabilities || []).map((item) => [item.key, item]));
  const certMap = new Map((certification?.checks || []).map((item) => [item.id, item]));

  const capabilities = PRODUCT_CAPABILITIES.map((item) => {
    const meta = item.metaKey ? metaMap.get(item.metaKey) || metaCapabilityByKey(item.metaKey) : null;
    const metaAvailable = item.metaKey ? metaMap.get(item.metaKey)?.status === 'available' : undefined;
    const liveChecks = (item.liveCheckIds || []).map((id) => certMap.get(id)).filter(Boolean);
    const certificationPass = liveChecks.length ? liveChecks.every((check) => check.pass) : undefined;
    const certificationFail = liveChecks.some((check) => check && !check.pass);
    return {
      ...item,
      groupLabel: PRODUCT_CAPABILITY_GROUPS.find((group) => group.id === item.group)?.label || item.group,
      featureLabel: item.feature ? workspaceFeatureLabel(item.feature) : '',
      meta: meta
        ? {
            key: item.metaKey,
            name: meta.name || metaCapabilityByKey(item.metaKey)?.name,
            status: metaMap.get(item.metaKey)?.status || 'setup',
            prerequisite: meta.prerequisite || metaCapabilityByKey(item.metaKey)?.prerequisite,
            detail: metaMap.get(item.metaKey)?.detail || ''
          }
        : null,
      liveChecks,
      liveStatus: mergeLiveStatus({ codeStatus: item.codeStatus, metaAvailable, certificationPass, certificationFail })
    };
  });

  return {
    generatedAt,
    scope: businessId ? 'workspace' : 'platform',
    businessId,
    summary: {
      ...summary,
      live: certification
        ? {
            ready: certification.ready,
            passed: certification.checks.filter((item) => item.pass).length,
            total: certification.checks.length
          }
        : null,
      operations: {
        worker: operations.worker?.status,
        metaWebhooksLagOk: operations.metaWebhooks?.lagOk,
        databaseIsolationReady: operations.database?.isolationReady,
        razorpayConfigured: operations.razorpayConfigured
      },
      meta: metaCapabilities
        ? {
            available: metaCapabilities.availableCount,
            missing: metaCapabilities.missingCount
          }
        : null
    },
    groups: PRODUCT_CAPABILITY_GROUPS,
    capabilities,
    certification,
    metaCapabilities
  };
}
