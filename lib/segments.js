import { currentAccount } from "./auth.js";
import { AppError, errorJson, id, json, query, transaction } from "./db.js";
import { requireWorkspaceManager } from "./workspace-permissions.js";
import { readOptionalJsonBodyLimited } from "./security.js";
import { normalizeAudienceRules as normalizeRules, audienceContactQuery } from './audience-rules.js';

export async function listAudienceSegments(businessId) {
  return (await pageAudienceSegments(businessId)).segments;
}

export async function pageAudienceSegments(businessId, { page = 1, search = '', segmentId = '', activeOnly = false } = {}) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || search.length > 120 || (segmentId && !/^[a-zA-Z0-9_-]{1,100}$/.test(segmentId))) {
    throw new AppError('Invalid segment search.', 400, 'INVALID_PAGE');
  }
  const result = segmentId
    ? await query('SELECT * FROM audience_segments WHERE business_id=$1 AND id=$2 AND ($3=FALSE OR is_active=TRUE)', [businessId, segmentId, activeOnly])
    : await query("SELECT * FROM audience_segments WHERE business_id=$1 AND ($2='' OR STRPOS(LOWER(name),LOWER($2))>0) AND ($4=FALSE OR is_active=TRUE) ORDER BY updated_at DESC,id DESC LIMIT 26 OFFSET $3", [businessId, search, (page - 1) * 25, activeOnly]);
  const segments = await Promise.all(result.rows.slice(0, 25).map(async (row) => ({
    ...mapSegment(row),
    contactCount: await segmentContactCount(businessId, row.rules)
  })));
  return { segments, hasMore: !segmentId && result.rows.length > 25, page };
}

export async function getAudienceSegments(request) {
  try {
    const account = await currentAccount(request);
    const params = new URL(request.url).searchParams;
    return json(await pageAudienceSegments(account.business.id, {
      page: Number(params.get('page') || 1), search: params.get('q') || '', segmentId: params.get('id') || '', activeOnly: params.get('active') === '1'
    }));
  } catch (error) { return errorJson(error); }
}

export async function saveAudienceSegment(request, context = {}) {
  try {
    const account = await currentAccount(request);
    requireWorkspaceManager(account);
    const params = context.params ? await context.params : {};
    const body = await readOptionalJsonBodyLimited(request, 65536);
    const name = clean(body.name);
    if (!name) throw new AppError("Segment name is required.", 400, "VALIDATION_ERROR");
    const rules = normalizeRules(body.rules);
    for (const campaignId of new Set(rules.engagement.map(rule => rule.campaignId))) {
      if (!(await query('SELECT 1 FROM campaigns WHERE id=$1 AND business_id=$2', [campaignId, account.business.id])).rowCount) {
        throw new AppError('Select campaigns belonging to this workspace.', 400, 'SEGMENT_CAMPAIGN_INVALID');
      }
    }
    const segmentId = params.id || id("seg");
    if (params.id) {
      const updated = await query(
        `UPDATE audience_segments SET name = $1, description = $2, rules = $3, is_active = $4, updated_at = NOW()
         WHERE id = $5 AND business_id = $6 RETURNING *`,
        [name, clean(body.description), JSON.stringify(rules), body.isActive !== false, segmentId, account.business.id]
      );
      if (!updated.rows[0]) throw new AppError("Audience segment not found.", 404, "SEGMENT_NOT_FOUND");
    } else {
      await query(
        `INSERT INTO audience_segments (id, business_id, name, description, rules, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [segmentId, account.business.id, name, clean(body.description), JSON.stringify(rules), body.isActive !== false]
      );
    }
    await query("INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1, $2, $3, $4, $5)", [id("a"), account.business.id, account.user.id, params.id ? "segment_updated" : "segment_created", JSON.stringify({ segmentId })]);
    return json({ segments: await listAudienceSegments(account.business.id) }, params.id ? 200 : 201);
  } catch (error) { return errorJson(error); }
}

export async function deleteAudienceSegment(request, context) {
  try {
    const account = await currentAccount(request);
    requireWorkspaceManager(account);
    const params = await context.params;
    const deleted = await query("DELETE FROM audience_segments WHERE id = $1 AND business_id = $2 RETURNING id", [params.id, account.business.id]);
    if (!deleted.rows[0]) throw new AppError("Audience segment not found.", 404, "SEGMENT_NOT_FOUND");
    await query("INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1, $2, $3, 'segment_deleted', $4)", [id("a"), account.business.id, account.user.id, JSON.stringify({ segmentId: params.id })]);
    return json({ segments: await listAudienceSegments(account.business.id) });
  } catch (error) { return errorJson(error); }
}

export async function resolveSegmentContactIds(businessId, rawRules) {
  const statement = audienceContactQuery(businessId, rawRules);
  const result = await query(statement.text, statement.params);
  return result.rows.map((row) => row.id);
}

export async function segmentContactCount(businessId, rawRules) {
  const statement = audienceContactQuery(businessId, rawRules, { count: true });
  return (await query(statement.text, statement.params)).rows[0].count;
}

export async function getAudienceCampaignOptions(request) {
  try {
    const account = await currentAccount(request);
    requireWorkspaceManager(account);
    const params = new URL(request.url).searchParams;
    const page = Number(params.get('page') || 1), search = params.get('search') || '';
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || search.length > 120) throw new AppError('Invalid campaign search.', 400, 'INVALID_PAGE');
    const result = await query('SELECT id,name FROM campaigns WHERE business_id=$1 AND STRPOS(LOWER(name), LOWER($2))>0 ORDER BY created_at DESC,id LIMIT 26 OFFSET $3', [account.business.id, search, (page-1)*25]);
    return json({ campaigns: result.rows.slice(0,25), hasMore: result.rows.length>25, page });
  } catch (error) { return errorJson(error); }
}

export async function refreshRetargetAudienceSegment(request, context) {
  try {
    const account = await currentAccount(request);
    requireWorkspaceManager(account);
    const params = await context.params;
    const segment = (await query('SELECT * FROM audience_segments WHERE id=$1 AND business_id=$2', [params.id, account.business.id])).rows[0];
    if (!segment) throw new AppError('Audience segment not found.', 404, 'SEGMENT_NOT_FOUND');
    const { refreshRetargetSegmentRules } = await import('./retargeting-segment-refresh.js');
    await transaction(async (client) => {
      const result = await refreshRetargetSegmentRules(client, account.business.id, segment);
      if (!result.refreshed) throw new AppError('Only retarget audiences created from a campaign preset can be refreshed.', 409, 'SEGMENT_NOT_RETARGET');
    });
    const count = await segmentContactCount(account.business.id, (await query('SELECT rules FROM audience_segments WHERE id=$1', [params.id])).rows[0].rules);
    await query("INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1, $2, $3, 'segment_retarget_refreshed', $4)", [id('a'), account.business.id, account.user.id, JSON.stringify({ segmentId: params.id, contactCount: count })]);
    return json({ segmentId: params.id, contactCount: count });
  } catch (error) {
    return errorJson(error);
  }
}

function mapSegment(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    rules: normalizeRules(row.rules),
    isActive: Boolean(row.is_active),
    retargetSourceCampaignId: row.retarget_source_campaign_id || null,
    retargetPresetId: row.retarget_preset_id || '',
    isRetargetAudience: Boolean(row.retarget_preset_id && row.retarget_source_campaign_id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function toIso(value) { return value ? new Date(value).toISOString() : null; }
function clean(value) { return String(value || "").trim(); }
