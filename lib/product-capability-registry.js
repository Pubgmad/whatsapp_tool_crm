import {
  META_CAPABILITY_DEFINITIONS,
  PRODUCT_CAPABILITY_GROUPS,
  PRODUCT_CAPABILITIES,
  WORKSPACE_FEATURE_LABELS
} from './product-capability-registry-data.js';

export {
  META_CAPABILITY_DEFINITIONS,
  PRODUCT_CAPABILITY_GROUPS,
  PRODUCT_CAPABILITIES,
  WORKSPACE_FEATURE_LABELS
};

export function metaCapabilityByKey(key) {
  return META_CAPABILITY_DEFINITIONS.find((item) => item.key === key) || null;
}

export function workspaceFeatureLabel(feature) {
  return WORKSPACE_FEATURE_LABELS[feature] || feature || '';
}

export function registrySummary() {
  const byStatus = { strong: 0, partial: 0, gap: 0 };
  for (const item of PRODUCT_CAPABILITIES) byStatus[item.codeStatus] = (byStatus[item.codeStatus] || 0) + 1;
  return {
    total: PRODUCT_CAPABILITIES.length,
    groups: PRODUCT_CAPABILITY_GROUPS.length,
    byStatus,
    metaCapabilityKeys: META_CAPABILITY_DEFINITIONS.map((item) => item.key),
    workspaceFeatures: Object.keys(WORKSPACE_FEATURE_LABELS)
  };
}
