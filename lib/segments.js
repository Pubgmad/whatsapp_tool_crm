import { currentAccount } from "./auth";
import { AppError, errorJson, id, json, query } from "./db";
import { requireWorkspaceManager } from "./workspace-permissions";
import { readOptionalJsonBodyLimited } from "./security";
import { normalizeAudienceRules as normalizeRules, audienceContactQuery } from './audience-rules.js';

export async function listAudienceSegments(businessId) {
  const result = await query("SELECT * FROM audience_segments WHERE business_id = $1 ORDER BY updated_at DESC", [businessId]);
  return Promise.all(result.rows.map(async (row) => ({
    ...mapSegment(row),
    contactCount: await segmentContactCount(businessId, row.rules)
  })));
}

export async function getAudienceSegments(request) {
  try {
    const account = await currentAccount(request);
    return json({ segments: await listAudienceSegments(account.business.id) });
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

function mapSegment(row) {
  return { id: row.id, name: row.name, description: row.description || "", rules: normalizeRules(row.rules), isActive: Boolean(row.is_active), createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at) };
}

function toIso(value) { return value ? new Date(value).toISOString() : null; }
function clean(value) { return String(value || "").trim(); }
