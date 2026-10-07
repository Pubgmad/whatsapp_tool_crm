import { AppError, id, query, transaction } from './db.js';
import { buildRetargetRules, countRetargetPreset, loadRetargetPresetCatalog } from './retargeting-presets.js';

export async function retargetSnapshotForCampaign(businessId, sourceCampaignId) {
  const campaign = (await query('SELECT id,name,status FROM campaigns WHERE id=$1 AND business_id=$2', [sourceCampaignId, businessId])).rows[0];
  if (!campaign) throw new AppError('Campaign not found.', 404, 'CAMPAIGN_NOT_FOUND');
  const catalog = await loadRetargetPresetCatalog();
  const presets = await Promise.all(
    catalog.map(async (preset) => ({
      ...preset,
      eligibleCount: await countRetargetPreset(businessId, preset.id, sourceCampaignId)
    }))
  );
  return { campaign, presets };
}

export async function createRetargetAudience({
  businessId,
  userId,
  sourceCampaignId,
  presetId,
  segmentName,
  withinDays
}) {
  const source = (await query('SELECT id,name FROM campaigns WHERE id=$1 AND business_id=$2', [sourceCampaignId, businessId])).rows[0];
  if (!source) throw new AppError('Campaign not found.', 404, 'CAMPAIGN_NOT_FOUND');
  const catalog = await loadRetargetPresetCatalog();
  const preset = catalog.find((item) => item.id === presetId);
  if (!preset) throw new AppError('Choose a valid retarget audience.', 400, 'RETARGET_PRESET_INVALID');
  const rules = buildRetargetRules(presetId, sourceCampaignId, { withinDays });
  const count = await countRetargetPreset(businessId, presetId, sourceCampaignId, { withinDays });
  if (!count) throw new AppError('No contacts match this retarget audience yet.', 409, 'RETARGET_AUDIENCE_EMPTY');
  const name =
    segmentName?.trim() ||
    `Retarget: ${preset.title} · ${source.name}`.slice(0, 255);
  const segmentId = id('seg');
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO audience_segments(id,business_id,name,description,rules,is_active,retarget_source_campaign_id,retarget_preset_id)
       VALUES($1,$2,$3,$4,$5,TRUE,$6,$7)`,
      [
        segmentId,
        businessId,
        name,
        `Auto-audience from campaign ${source.name} (${preset.id}).`,
        JSON.stringify(rules),
        sourceCampaignId,
        presetId
      ]
    );
    await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)', [
      id('a'),
      businessId,
      userId,
      'retarget_audience_created',
      JSON.stringify({ segmentId, sourceCampaignId, presetId, count })
    ]);
  });
  return { segmentId, name, contactCount: count, presetId, sourceCampaignId };
}

export async function getCampaignRetarget(request, context) {
  const { currentAccount } = await import('./auth.js');
  const { requireWorkspaceManager } = await import('./workspace-permissions.js');
  const { json, errorJson } = await import('./db.js');
  try {
    const account = await currentAccount(request);
    requireWorkspaceManager(account);
    const params = await context.params;
    return json(await retargetSnapshotForCampaign(account.business.id, params.id));
  } catch (error) {
    return errorJson(error);
  }
}

export async function postCampaignRetarget(request, context) {
  const { currentAccount } = await import('./auth.js');
  const { requireWorkspaceManager } = await import('./workspace-permissions.js');
  const { readOptionalJsonBodyLimited } = await import('./security.js');
  const { json, errorJson } = await import('./db.js');
  try {
    const account = await currentAccount(request);
    requireWorkspaceManager(account);
    const params = await context.params;
    const body = await readOptionalJsonBodyLimited(request, 16384);
    const presetId = String(body.presetId || '').trim();
    if (!presetId) throw new AppError('Choose a retarget audience preset.', 400, 'RETARGET_PRESET_REQUIRED');
    const result = await createRetargetAudience({
      businessId: account.business.id,
      userId: account.user.id,
      sourceCampaignId: params.id,
      presetId,
      segmentName: body.segmentName,
      withinDays: body.withinDays
    });
    return json(result, 201);
  } catch (error) {
    return errorJson(error);
  }
}
