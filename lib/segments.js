import { currentAccount } from "./auth";
import { AppError, errorJson, id, json, query } from "./db";

export async function listAudienceSegments(businessId) {
  const result = await query("SELECT * FROM audience_segments WHERE business_id = $1 ORDER BY updated_at DESC", [businessId]);
  return Promise.all(result.rows.map(async (row) => ({
    ...mapSegment(row),
    contactCount: (await resolveSegmentContactIds(businessId, row.rules)).length
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
    const params = context.params ? await context.params : {};
    const body = await request.json().catch(() => ({}));
    const name = clean(body.name);
    if (!name) throw new AppError("Segment name is required.", 400, "VALIDATION_ERROR");
    const rules = normalizeRules(body.rules);
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
    const params = await context.params;
    const deleted = await query("DELETE FROM audience_segments WHERE id = $1 AND business_id = $2 RETURNING id", [params.id, account.business.id]);
    if (!deleted.rows[0]) throw new AppError("Audience segment not found.", 404, "SEGMENT_NOT_FOUND");
    await query("INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1, $2, $3, 'segment_deleted', $4)", [id("a"), account.business.id, account.user.id, JSON.stringify({ segmentId: params.id })]);
    return json({ segments: await listAudienceSegments(account.business.id) });
  } catch (error) { return errorJson(error); }
}

export async function resolveSegmentContactIds(businessId, rawRules) {
  const rules = normalizeRules(rawRules);
  const clauses = ["business_id = $1"];
  const params = [businessId];
  const add = (clause, value) => { params.push(value); clauses.push(clause.replace("?", `$${params.length}`)); };
  if (rules.permission === "marketable") clauses.push("marketing_permission = TRUE AND unsubscribed = FALSE");
  if (rules.permission === "blocked") clauses.push("(marketing_permission = FALSE OR unsubscribed = TRUE)");
  if (rules.tags.length) {
    params.push(rules.tags);
    clauses.push(`tags ${rules.tagMode === "all" ? "?&" : "?|"} $${params.length}::text[]`);
  }
  if (rules.sources.length) add("source = ANY(?::text[])", rules.sources);
  if (rules.lastActiveDays) add("last_message_at >= NOW() - (?::text || ' days')::interval", String(rules.lastActiveDays));
  if (rules.createdWithinDays) add("created_at >= NOW() - (?::text || ' days')::interval", String(rules.createdWithinDays));
  const result = await query(`SELECT id FROM contacts WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`, params);
  return result.rows.map((row) => row.id);
}

function normalizeRules(value = {}) {
  const rules = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    permission: ["all", "marketable", "blocked"].includes(rules.permission) ? rules.permission : "marketable",
    tagMode: rules.tagMode === "all" ? "all" : "any",
    tags: normalizeList(rules.tags).map((item) => item.toLowerCase()),
    sources: normalizeList(rules.sources),
    lastActiveDays: positiveInteger(rules.lastActiveDays),
    createdWithinDays: positiveInteger(rules.createdWithinDays)
  };
}

function mapSegment(row) {
  return { id: row.id, name: row.name, description: row.description || "", rules: normalizeRules(row.rules), isActive: Boolean(row.is_active), createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at) };
}

function normalizeList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(list.map(clean).filter(Boolean))].slice(0, 100);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, 3650) : null;
}

function toIso(value) { return value ? new Date(value).toISOString() : null; }
function clean(value) { return String(value || "").trim(); }