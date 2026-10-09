const BILLING_REQUIRED_SCOPES = Object.freeze([
  "business_management",
  "whatsapp_business_management",
  "whatsapp_business_messaging"
]);
const BILLING_CACHE_TTL_MS = 15 * 60 * 1000;
const clean = (value) => String(value || "").trim();

function billingSnapshot(state, reasonCode, detail, extra = {}) {
  return {
    state,
    reasonCode,
    detail,
    source: "meta_extended_credit",
    checkedAt: new Date().toISOString(),
    cacheTtlSeconds: BILLING_CACHE_TTL_MS / 1000,
    ...extra
  };
}

export function billingVisibilityPaths(portfolioId, allocationId = "") {
  if (!/^\d{1,32}$/.test(String(portfolioId || ""))) return null;
  return {
    permissions: "me/permissions",
    creditLines: `${portfolioId}/extendedcredits?fields=id%2Cis_access_revoked&limit=100`,
    allocation: /^\d{1,32}$/.test(String(allocationId || ""))
      ? `${allocationId}?fields=id%2Cowning_credential%2Creceiving_credential%2Crequest_status`
      : ""
  };
}

export function deriveBillingVisibilityState({
  configured = false,
  permissions = [],
  creditLines = [],
  allocation = null,
  expectedWabaId = "",
  expectedCreditLineId = "",
  errorCode = ""
} = {}) {
  if (!configured) {
    return billingSnapshot("unavailable", "META_BILLING_NOT_CONFIGURED",
      "Platform billing credential and Business Portfolio ID are not configured.");
  }
  if (errorCode) {
    return billingSnapshot("error", errorCode, "Meta billing verification failed; retry or inspect server diagnostics.");
  }
  const granted = new Set((permissions || [])
    .filter((item) => item?.status === "granted")
    .map((item) => clean(item.permission)));
  const missingScopes = BILLING_REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
  if (missingScopes.length) {
    return billingSnapshot("unavailable", "META_BILLING_SCOPES_MISSING",
      `System-user token is missing ${missingScopes.join(", ")}.`, { missingScopes });
  }
  const usableLines = (creditLines || []).filter((line) =>
    /^\d{1,32}$/.test(String(line?.id || "")) && line?.is_access_revoked !== true);
  if (!usableLines.length) {
    return billingSnapshot("eligible", "META_BILLING_NO_CREDIT_LINE",
      "Meta accepted billing access, but no usable extended credit line was returned.", { creditLineCount: 0 });
  }
  const receivingId = clean(allocation?.receiving_credential?.id || allocation?.receiving_credential);
  const owningId = clean(allocation?.owning_credential?.id || allocation?.owning_credential);
  const requestStatus = clean(allocation?.request_status).toUpperCase();
  const lineMatches = usableLines.some((line) => String(line.id) === String(expectedCreditLineId));
  const allocationActive = /^\d{1,32}$/.test(clean(allocation?.id)) &&
    receivingId === String(expectedWabaId) &&
    owningId === String(expectedCreditLineId) &&
    lineMatches &&
    !["DECLINED", "REJECTED", "REVOKED", "CANCELLED"].includes(requestStatus);
  if (allocationActive) {
    return billingSnapshot("active", "META_BILLING_ALLOCATION_VERIFIED",
      "Meta verified an active extended-credit allocation for this WABA.", {
        creditLineCount: usableLines.length,
        allocationVerified: true
      });
  }
  return billingSnapshot("eligible", "META_BILLING_ALLOCATION_NOT_VERIFIED",
    "Extended-credit access is available, but Meta did not verify an allocation for this WABA.", {
      creditLineCount: usableLines.length,
      allocationVerified: false
    });
}

export function safeCachedBillingVisibility(snapshot, now = Date.now()) {
  if (!snapshot || typeof snapshot !== "object" || !["unavailable", "eligible", "active", "error"].includes(snapshot.state)) {
    return deriveBillingVisibilityState({ configured: false });
  }
  const checkedAt = new Date(snapshot.checkedAt || 0).getTime();
  const ttlMs = Math.min(
    Math.max(Number(snapshot.cacheTtlSeconds || 0) * 1000, 0),
    BILLING_CACHE_TTL_MS
  );
  if (["active", "eligible"].includes(snapshot.state) &&
      (!Number.isFinite(checkedAt) || !ttlMs || now - checkedAt > ttlMs || checkedAt - now > 5 * 60 * 1000)) {
    return {
      ...snapshot,
      state: "error",
      reasonCode: "META_BILLING_CACHE_STALE",
      detail: "Cached Meta billing verification expired; refresh entitlements before relying on it.",
      allocationVerified: false
    };
  }
  return snapshot;
}
