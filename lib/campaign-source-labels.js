import { CAMPAIGN_SOURCE_KINDS } from './campaign-source.js';

const LABELS = Object.freeze({
  workspace_broadcast: 'Workspace broadcast',
  public_api: 'Public API campaign',
  drip: 'Drip sequence',
  recurring_child: 'Recurring broadcast',
  retarget: 'Retarget campaign',
  legacy: 'Legacy import',
  unknown: 'Unknown origin'
});

export function campaignSourceLabel(kind) {
  const normalized = String(kind || '').trim().toLowerCase();
  return LABELS[normalized] || normalized.replaceAll('_', ' ') || LABELS.unknown;
}

export function campaignSourceOptions() {
  return CAMPAIGN_SOURCE_KINDS.filter((kind) => kind !== 'unknown').map((kind) => ({
    id: kind,
    label: campaignSourceLabel(kind)
  }));
}
