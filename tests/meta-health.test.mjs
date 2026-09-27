import assert from "node:assert/strict";
import test from "node:test";
import { encryptSecret } from "../lib/meta.js";
import { classifyMetaHealth, probeMetaConnection, publicMetaHealth } from "../lib/meta-health.js";

const appId = "123456";
const wabaId = "789012";
const token = "test-token-not-real";

async function withMeta(fetchMock, run) {
  const previous = {
    fetch: globalThis.fetch,
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    encryptionKey: process.env.ENCRYPTION_KEY
  };
  process.env.META_APP_ID = appId;
  process.env.META_APP_SECRET = "unit-test-secret";
  process.env.ENCRYPTION_KEY = "unit-test-encryption-key";
  globalThis.fetch = fetchMock;
  try { return await run(encryptSecret(token)); }
  finally {
    globalThis.fetch = previous.fetch;
    for (const [key, name] of [["appId", "META_APP_ID"], ["appSecret", "META_APP_SECRET"], ["encryptionKey", "ENCRYPTION_KEY"]]) {
      if (previous[key] === undefined) delete process.env[name];
      else process.env[name] = previous[key];
    }
  }
}

const debug = { data: { is_valid: true, app_id: appId, scopes: ["whatsapp_business_management", "whatsapp_business_messaging"] } };

test("healthy Meta access requires a valid token and WABA subscription", async () => {
  const calls = [];
  await withMeta(async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    return Response.json(String(url).includes("debug_token") ? debug : { data: [{ whatsapp_business_api_data: { id: appId } }] });
  }, async (encrypted) => {
    const health = await probeMetaConnection(wabaId, encrypted);
    assert.equal(health.status, "healthy");
    assert.equal(health.subscribed, true);
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.url.startsWith("https://graph.facebook.com/")));
});

test("missing WABA subscription is repaired and verified", async () => {
  const methods = [];
  await withMeta(async (url, options) => {
    if (String(url).includes("debug_token")) return Response.json(debug);
    methods.push(options.method);
    if (options.method === "POST") return Response.json({ success: true });
    return Response.json({ data: methods.includes("POST") ? [{ id: appId }] : [] });
  }, async (encrypted) => {
    const health = await probeMetaConnection(wabaId, encrypted);
    assert.equal(health.status, "healthy");
    assert.equal(health.subscribed, true);
  });
  assert.deepEqual(methods, ["GET", "POST", "GET"]);
});

test("revoked Meta access is classified as reconnect required", async () => {
  await withMeta(async () => Response.json({ data: { is_valid: false, app_id: appId } }), async (encrypted) => {
    await assert.rejects(probeMetaConnection(wabaId, encrypted), (error) => {
      assert.equal(classifyMetaHealth(error).status, "reconnect_required");
      return true;
    });
  });
  assert.equal(classifyMetaHealth({ metaCode: 190 }).status, "reconnect_required");
  assert.equal(classifyMetaHealth({ status: 503 }).status, "degraded");
});

test("stale checks cannot be presented as a healthy live connection", () => {
  const stale = new Date(Date.now() - 2 * 86400000);
  assert.deepEqual(
    [publicMetaHealth({ health_status: "healthy", health_checked_at: stale }).status,
      publicMetaHealth({ health_status: "reconnect_required", health_checked_at: stale }).status],
    ["degraded", "reconnect_required"]
  );
});

test("failed webhook re-subscription is not reported as healthy", async () => {
  await withMeta(async (url, options) => {
    if (String(url).includes("debug_token")) return Response.json(debug);
    if (options.method === "POST") return Response.json({ error: { code: 10 } }, { status: 403 });
    return Response.json({ data: [] });
  }, async (encrypted) => {
    await assert.rejects(probeMetaConnection(wabaId, encrypted), (error) => {
      assert.equal(classifyMetaHealth(error).reason, "webhook_unsubscribed");
      return true;
    });
  });
});
