import {
  META_CAPABILITY_DEFINITIONS,
  PRODUCT_CAPABILITY_GROUPS as ALL_PRODUCT_CAPABILITY_GROUPS,
  PRODUCT_CAPABILITIES as ALL_PRODUCT_CAPABILITIES,
  WORKSPACE_FEATURE_LABELS as ALL_WORKSPACE_FEATURE_LABELS
} from './product-capability-registry-data.js';
import {
  filterProductCapabilities,
  filterWorkspaceFeatureLabels,
  RELEASE_EXCLUDED_FEATURES
} from './release-feature-allowlist.js';

export { META_CAPABILITY_DEFINITIONS };

export const WORKSPACE_FEATURE_LABELS = Object.freeze(
  filterWorkspaceFeatureLabels(ALL_WORKSPACE_FEATURE_LABELS)
);

const EXCLUDED_GROUP_IDS = new Set(['commerce', 'ads']);

export const PRODUCT_CAPABILITY_GROUPS = ALL_PRODUCT_CAPABILITY_GROUPS.filter(
  (group) => !EXCLUDED_GROUP_IDS.has(group.id)
).map((group) =>
  group.id === 'core_crm'
    ? { ...group, id: 'core_messaging', label: 'Core messaging & inbox' }
    : group
);

export const PRODUCT_CAPABILITIES = filterProductCapabilities(
  ALL_PRODUCT_CAPABILITIES.map((item) =>
    item.group === 'core_crm' ? { ...item, group: 'core_messaging' } : item
  )
);

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
    metaCapabilityKeys: META_CAPABILITY_DEFINITIONS.map((item) => item.key).filter(
      (key) => !['catalogs', 'ctwa', 'calling'].includes(key)
    ),
    workspaceFeatures: Object.keys(WORKSPACE_FEATURE_LABELS),
    excludedWorkspaceFeatures: [...RELEASE_EXCLUDED_FEATURES]
  };
}
