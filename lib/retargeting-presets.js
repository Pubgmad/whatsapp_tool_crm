import { query } from './db.js';
import { audienceContactQuery, normalizeAudienceRules } from './audience-rules.js';

export function defaultRetargetingPresetCatalog() {
  return {
    delivered_not_read: {
      title: 'Delivered, not read',
      description: 'Message reached the device but was not opened yet — ideal for a short reminder.'
    },
    read_no_reply: {
      title: 'Read, no reply',
      description: 'Opened your broadcast but stayed silent — follow up with an offer or question.'
    },
    read_no_click: {
      title: 'Read, no link click',
      description: 'Saw the message but did not continue through your tracked link.'
    },
    clicked_no_purchase: {
      title: 'Clicked, no purchase',
      description: 'Engaged with your CTA but has not completed a WhatsApp order.'
    },
    read_no_purchase: {
      title: 'Read, no purchase',
      description: 'Aware of your campaign but has not bought — nudge with social proof.'
    },
    replied: {
      title: 'Replied',
      description: 'Responded to this campaign — continue the conversation or upsell.'
    },
    clicked: {
      title: 'Clicked tracked link',
      description: 'Confirmed a tracked Continue click from this campaign.'
    },
    failed_delivery: {
      title: 'Failed delivery',
      description: 'Could not be delivered — retry after fixing numbers or templates.'
    },
    flow_abandoned: {
      title: 'Abandoned WhatsApp Flow',
      description: 'Started a flow invite from this send window but did not finish before expiry.'
    }
  };
}

const PRESET_DEFS = [
  {
    id: 'delivered_not_read',
    buildRules: (campaignId) => ({
      engagementMode: 'all',
      engagement: [
        { campaignId, event: 'delivered', match: 'matched' },
        { campaignId, event: 'read', match: 'not_matched' }
      ]
    })
  },
  {
    id: 'read_no_reply',
    buildRules: (campaignId) => ({
      engagementMode: 'all',
      engagement: [
        { campaignId, event: 'read', match: 'matched' },
        { campaignId, event: 'replied', match: 'not_matched' }
      ]
    })
  },
  {
    id: 'read_no_click',
    buildRules: (campaignId) => ({
      engagementMode: 'all',
      engagement: [
        { campaignId, event: 'read', match: 'matched' },
        { campaignId, event: 'clicked', match: 'not_matched' }
      ]
    })
  },
  {
    id: 'clicked_no_purchase',
    buildRules: (campaignId) => ({
      engagementMode: 'all',
      engagement: [{ campaignId, event: 'clicked', match: 'matched' }],
      purchase: 'not_purchased'
    })
  },
  {
    id: 'read_no_purchase',
    buildRules: (campaignId) => ({
      engagementMode: 'all',
      engagement: [
        { campaignId, event: 'read', match: 'matched' },
        { campaignId, event: 'replied', match: 'not_matched' }
      ],
      purchase: 'not_purchased'
    })
  },
  {
    id: 'replied',
    buildRules: (campaignId) => ({
      engagement: [{ campaignId, event: 'replied', match: 'matched' }]
    })
  },
  {
    id: 'clicked',
    buildRules: (campaignId) => ({
      engagement: [{ campaignId, event: 'clicked', match: 'matched' }]
    })
  },
  {
    id: 'failed_delivery',
    buildRules: (campaignId) => ({
      engagement: [{ campaignId, event: 'failed', match: 'matched' }]
    })
  },
  {
    id: 'flow_abandoned',
    buildRules: (campaignId, { withinDays } = {}) => ({
      engagement: [{ campaignId, event: 'flow_abandoned', match: 'matched', ...(withinDays ? { withinDays } : {}) }]
    })
  }
];

const presetMap = new Map(PRESET_DEFS.map((item) => [item.id, item]));

export function listRetargetPresetIds() {
  return PRESET_DEFS.map((item) => item.id);
}

export async function loadRetargetPresetCatalog(run = query) {
  const row = (await run("SELECT value FROM platform_settings WHERE key='retargeting_preset_catalog'")).rows[0];
  let labels = {};
  const fallbacks = defaultRetargetingPresetCatalog();
  if (row?.value) {
    try {
      labels = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    } catch {
      labels = {};
    }
  }
  return PRESET_DEFS.map((preset) => {
    const meta = { ...fallbacks[preset.id], ...(labels[preset.id] || {}) };
    return {
      id: preset.id,
      title: String(meta.title || preset.id.replaceAll('_', ' ')),
      description: String(meta.description || ''),
      requiresTrackedLinks: preset.id.includes('click')
    };
  });
}

export function buildRetargetRules(presetId, sourceCampaignId, options = {}) {
  const preset = presetMap.get(presetId);
  if (!preset) throw Object.assign(new Error('Unknown retarget preset.'), { code: 'RETARGET_PRESET_INVALID' });
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(sourceCampaignId)) throw Object.assign(new Error('Invalid source campaign.'), { code: 'RETARGET_CAMPAIGN_INVALID' });
  const merged = {
    permission: 'marketable',
    purchase: 'all',
    ...preset.buildRules(sourceCampaignId, options)
  };
  return normalizeAudienceRules(merged);
}

export async function countRetargetPreset(businessId, presetId, sourceCampaignId, options = {}) {
  const rules = buildRetargetRules(presetId, sourceCampaignId, options);
  const statement = audienceContactQuery(businessId, rules, { count: true });
  return (await query(statement.text, statement.params)).rows[0]?.count || 0;
}
