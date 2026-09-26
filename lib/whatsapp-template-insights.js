import { requireSession } from "./auth.js";
import { AppError, errorJson, json, query } from "./db.js";
import { decryptSecret } from "./meta.js";

export function templateInsightsPath(wabaId, templateId, start, end) {
  if (!/^\d+$/.test(String(wabaId)) || !/^\d+$/.test(String(templateId))) {
    throw new AppError("A synced Meta template and WhatsApp account are required.", 400, "META_TEMPLATE_REQUIRED");
  }
  const params = new URLSearchParams({
    start: String(start),
    end: String(end),
    granularity: "DAILY",
    product_type: "CLOUD_API",
    template_ids: JSON.stringify([String(templateId)])
  });
  return `${wabaId}/template_analytics?${params}`;
}

export function summarizeTemplateInsights(payload, templateId) {
  const groups = payload?.data?.template_analytics?.data || payload?.template_analytics?.data || payload?.data || [];
  const points = (Array.isArray(groups) ? groups : []).flatMap((group) => group?.data_points || []);
  const selected = points.filter((point) => String(point.template_id) === String(templateId));
  const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  return {
    sent: selected.reduce((sum, point) => sum + count(point.sent), 0),
    delivered: selected.reduce((sum, point) => sum + count(point.delivered), 0),
    read: selected.reduce((sum, point) => sum + count(point.read), 0),
    daysReported: selected.length
  };
}

export async function getTemplateInsights(request, templateId) {
  try {
    const session = await requireSession(request);
    const template = (await query(
      "SELECT meta_template_id FROM templates WHERE id=$1 AND business_id=$2",
      [templateId, session.businessId]
    )).rows[0];
    if (!template) throw new AppError("Template not found.", 404, "TEMPLATE_NOT_FOUND");
    if (!template.meta_template_id) throw new AppError("Sync this template with Meta before viewing insights.", 400, "META_TEMPLATE_REQUIRED");
    const url = new URL(request.url);
    const days = Number(url.searchParams.get("days") || 30);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw new AppError("Choose a period from 1 to 90 days.", 400, "INVALID_INSIGHTS_PERIOD");
    }
    const accountId = url.searchParams.get("accountId") || "";
    const account = (await query(
      `SELECT waba_id,access_token_encrypted,token_expires_at FROM whatsapp_accounts
       WHERE business_id=$1 AND ($2='' OR id=$2)
       ORDER BY is_default DESC, created_at LIMIT 1`,
      [session.businessId, accountId]
    )).rows[0];
    if (!account?.access_token_encrypted) throw new AppError("Connect the template's WhatsApp account first.", 400, "META_NOT_CONFIGURED");
    if (account.token_expires_at && new Date(account.token_expires_at).getTime() <= Date.now()) {
      throw new AppError("Reconnect the WhatsApp account to refresh authorization.", 409, "META_TOKEN_EXPIRED");
    }
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const path = templateInsightsPath(account.waba_id, template.meta_template_id, start.toISOString(), end.toISOString());
    const version = process.env.META_GRAPH_API_VERSION || "v26.0";
    const response = await fetch(`https://graph.facebook.com/${version}/${path}`, {
      headers: { Authorization: `Bearer ${decryptSecret(account.access_token_encrypted)}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new AppError(payload.error?.error_user_msg || payload.error?.message || "Meta template insights are unavailable.", response.status, "META_INSIGHTS_FAILED");
    return json({
      templateId,
      periodDays: days,
      ...summarizeTemplateInsights(payload, template.meta_template_id)
    });
  } catch (error) {
    return errorJson(error);
  }
}
