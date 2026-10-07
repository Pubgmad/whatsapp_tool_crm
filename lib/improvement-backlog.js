import { PRODUCT_CAPABILITIES, PRODUCT_CAPABILITY_GROUPS } from './product-capability-registry-data.js';

const PRIORITY_ORDER = { gap: 0, partial: 1, strong: 2 };

/**
 * Capabilities that still need product, live Meta, or ops work (codeStatus !== strong).
 */
export function capabilityImprovementBacklog({ includeStrong = false } = {}) {
  const groupLabel = Object.fromEntries(PRODUCT_CAPABILITY_GROUPS.map((g) => [g.id, g.label]));
  return PRODUCT_CAPABILITIES
    .filter((item) => includeStrong || item.codeStatus !== 'strong')
    .map((item) => ({
      id: item.id,
      label: item.label,
      group: item.group,
      groupLabel: groupLabel[item.group] || item.group,
      codeStatus: item.codeStatus,
      benchmarks: item.benchmarks || [],
      evidence: item.evidence || [],
      operatorNote: item.operatorNote || '',
      feature: item.feature || null,
      metaKey: item.metaKey || null,
      priority: PRIORITY_ORDER[item.codeStatus] ?? 1
    }))
    .sort((a, b) => a.priority - b.priority || a.groupLabel.localeCompare(b.groupLabel) || a.label.localeCompare(b.label));
}

export function improvementBacklogSummary(backlog = capabilityImprovementBacklog()) {
  const byStatus = backlog.reduce(
    (acc, item) => {
      acc[item.codeStatus] = (acc[item.codeStatus] || 0) + 1;
      return acc;
    },
    { partial: 0, gap: 0, strong: 0 }
  );
  return {
    total: backlog.length,
    byStatus,
    topPartial: backlog.filter((i) => i.codeStatus === 'partial').slice(0, 15)
  };
}
