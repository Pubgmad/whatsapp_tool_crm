import test from "node:test";
import assert from "node:assert/strict";
import {
  billingVisibilityPaths,
  deriveBillingVisibilityState,
  safeCachedBillingVisibility
} from "../lib/whatsapp-billing-visibility.js";

const permissions = [
  "business_management",
  "whatsapp_business_management",
  "whatsapp_business_messaging"
].map((permission) => ({ permission, status: "granted" }));

test("billing visibility paths accept only Meta numeric IDs", () => {
  assert.deepEqual(billingVisibilityPaths("123", "456"), {
    permissions: "me/permissions",
    creditLines: "123/extendedcredits?fields=id%2Cis_access_revoked&limit=100",
    allocation: "456?fields=id%2Cowning_credential%2Creceiving_credential%2Crequest_status"
  });
  assert.equal(billingVisibilityPaths("../123"), null);
  assert.equal(billingVisibilityPaths("123", "../456").allocation, "");
});

test("billing visibility is unavailable without supported credentials and scopes", () => {
  assert.equal(deriveBillingVisibilityState().state, "unavailable");
  const missing = deriveBillingVisibilityState({
    configured: true,
    permissions: [{ permission: "business_management", status: "granted" }]
  });
  assert.equal(missing.state, "unavailable");
  assert.deepEqual(missing.missingScopes, [
    "whatsapp_business_management",
    "whatsapp_business_messaging"
  ]);
});

test("successful extended-credit access is eligible until exact WABA allocation is verified", () => {
  const eligible = deriveBillingVisibilityState({
    configured: true,
    permissions,
    creditLines: [{ id: "100", is_access_revoked: false }],
    allocation: {
      id: "200",
      owning_credential: { id: "100" },
      receiving_credential: { id: "wrong-waba" },
      request_status: "APPROVED"
    },
    expectedWabaId: "300",
    expectedCreditLineId: "100"
  });
  assert.equal(eligible.state, "eligible");
  assert.equal(eligible.allocationVerified, false);
});

test("billing visibility becomes active only from a live exact allocation match", () => {
  const active = deriveBillingVisibilityState({
    configured: true,
    permissions,
    creditLines: [{ id: "100", is_access_revoked: false }],
    allocation: {
      id: "200",
      owning_credential: { id: "100" },
      receiving_credential: { id: "300" },
      request_status: "APPROVED"
    },
    expectedWabaId: "300",
    expectedCreditLineId: "100"
  });
  assert.equal(active.state, "active");
  assert.equal(active.allocationVerified, true);

  const rejected = deriveBillingVisibilityState({
    configured: true,
    permissions,
    creditLines: [{ id: "100", is_access_revoked: false }],
    allocation: {
      id: "200",
      owning_credential: { id: "100" },
      receiving_credential: { id: "300" },
      request_status: "REJECTED"
    },
    expectedWabaId: "300",
    expectedCreditLineId: "100"
  });
  assert.equal(rejected.state, "eligible");
});

test("errors are explicit and stale active cache cannot remain active", () => {
  assert.equal(deriveBillingVisibilityState({
    configured: true,
    permissions,
    errorCode: "META_BILLING_TIMEOUT"
  }).state, "error");

  const cached = {
    state: "active",
    reasonCode: "META_BILLING_ALLOCATION_VERIFIED",
    detail: "verified",
    checkedAt: "2026-01-01T00:00:00.000Z",
    cacheTtlSeconds: 900,
    allocationVerified: true
  };
  const stale = safeCachedBillingVisibility(cached, Date.parse("2026-01-01T00:16:00.000Z"));
  assert.equal(stale.state, "error");
  assert.equal(stale.reasonCode, "META_BILLING_CACHE_STALE");
  assert.equal(stale.allocationVerified, false);
});
