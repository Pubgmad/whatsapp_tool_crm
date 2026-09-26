import test from "node:test";
import assert from "node:assert/strict";
import { summarizeTemplateInsights, templateInsightsPath } from "../lib/whatsapp-template-insights.js";

test("template insights request scopes IDs and date range", () => {
  const path = templateInsightsPath("123", "456", "2026-09-01T00:00:00Z", "2026-09-08T00:00:00Z");
  assert.equal(path.split("?")[0], "123/template_analytics");
  const params = new URLSearchParams(path.split("?")[1]);
  assert.deepEqual(JSON.parse(params.get("template_ids")), ["456"]);
  assert.equal(params.get("product_type"), "CLOUD_API");
  assert.throws(() => templateInsightsPath("../bad", "456", "a", "b"), { code: "META_TEMPLATE_REQUIRED" });
});

test("template insights totals only the requested Meta template", () => {
  const payload = { data: { template_analytics: { data: [{ data_points: [
    { template_id: "456", sent: 10, delivered: 8, read: 4 },
    { template_id: "999", sent: 100, delivered: 90, read: 50 },
    { template_id: "456", sent: 5, delivered: 5, read: 3 }
  ] }] } } };
  assert.deepEqual(summarizeTemplateInsights(payload, "456"), {
    sent: 15, delivered: 13, read: 7, daysReported: 2
  });
});
