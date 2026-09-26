import { AppError, errorJson, json } from "./db.js";

export function creditLinesPath(businessId) {
  if (!/^\d+$/.test(String(businessId))) {
    throw new AppError("Configure a valid Meta Business Portfolio ID.", 503, "META_BUSINESS_ID_REQUIRED");
  }
  return `${businessId}/extendedcredits?fields=id%2Clegal_entity_name`;
}

export async function getMetaCreditLines(request) {
  try {
    const { requireSuperAdmin } = await import("./super-admin.js");
    await requireSuperAdmin(request);
    const businessId = process.env.META_BUSINESS_PORTFOLIO_ID;
    const token = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
    if (!businessId || !token) {
      return json({ configured: false, creditLines: [] });
    }
    const version = process.env.META_GRAPH_API_VERSION || "v26.0";
    const response = await fetch(`https://graph.facebook.com/${version}/${creditLinesPath(businessId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AppError(payload.error?.error_user_msg || payload.error?.message || "Meta credit-line status is unavailable.", response.status, "META_CREDIT_LINES_FAILED");
    }
    return json({
      configured: true,
      creditLines: (Array.isArray(payload.data) ? payload.data : [])
        .filter((item) => /^\d+$/.test(String(item.id)))
        .map((item) => ({ id: String(item.id), legalEntityName: String(item.legal_entity_name || "") }))
    });
  } catch (error) {
    return errorJson(error);
  }
}
