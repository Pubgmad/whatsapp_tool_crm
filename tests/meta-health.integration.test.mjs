import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { enterSystemContext, query } from "../lib/db.js";
import { encryptSecret } from "../lib/meta.js";
import { monitorDueMetaConnections, recordMetaWebhookActivity } from "../lib/meta-health.js";

test("worker records Meta health and signed webhook activity per WABA", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const suffix = crypto.randomBytes(8).toString("hex");
  const businessId = "health_b_" + suffix;
  const accountId = "health_a_" + suffix;
  const wabaId = String(BigInt("0x" + suffix));
  const previous = {
    fetch: globalThis.fetch,
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    encryptionKey: process.env.ENCRYPTION_KEY
  };
  process.env.META_APP_ID = "123456";
  process.env.META_APP_SECRET = "integration-test-secret";
  process.env.ENCRYPTION_KEY = "integration-test-encryption-key";
  globalThis.fetch = async (url) => Response.json(String(url).includes("debug_token")
    ? { data: { is_valid: true, app_id: "123456", scopes: ["whatsapp_business_management", "whatsapp_business_messaging"] } }
    : { data: [{ id: "123456" }] });
  enterSystemContext();
  try {
    await query("INSERT INTO businesses (id,name,slug) VALUES ($1,$2,$3)", [businessId, "Health test", businessId]);
    await query(
      "INSERT INTO whatsapp_accounts (id,business_id,waba_id,access_token_encrypted,is_default) VALUES ($1,$2,$3,$4,TRUE)",
      [accountId, businessId, wabaId, encryptSecret("test-token")]
    );
    const result = await monitorDueMetaConnections();
    assert.ok(result.checked >= 1);
    assert.equal(result.failed, 0);
    await recordMetaWebhookActivity(businessId, wabaId, "messages");
    const row = (await query("SELECT health_status,webhook_subscribed,health_checked_at,last_webhook_at,last_message_webhook_at FROM whatsapp_accounts WHERE id=$1", [accountId])).rows[0];
    assert.equal(row.health_status, "healthy");
    assert.equal(row.webhook_subscribed, true);
    assert.ok(row.health_checked_at && row.last_webhook_at && row.last_message_webhook_at);
  } finally {
    await query("DELETE FROM businesses WHERE id=$1", [businessId]);
    globalThis.fetch = previous.fetch;
    for (const [key, name] of [["appId", "META_APP_ID"], ["appSecret", "META_APP_SECRET"], ["encryptionKey", "ENCRYPTION_KEY"]]) {
      if (previous[key] === undefined) delete process.env[name];
      else process.env[name] = previous[key];
    }
  }
});
