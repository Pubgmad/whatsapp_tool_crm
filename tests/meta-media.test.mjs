import assert from "node:assert/strict";
import test from "node:test";
import { encryptSecret, fetchWhatsAppMedia, validateMetaMediaUrl } from "../lib/meta.js";

const originalKey = process.env.ENCRYPTION_KEY;
process.env.ENCRYPTION_KEY = "test-media-key-only";
const setup = {
  phone_number_id: "123456",
  waba_id: "654321",
  access_token_encrypted: encryptSecret("test-token")
};
if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
else process.env.ENCRYPTION_KEY = originalKey;

test("accepts only trusted HTTPS Meta media hosts", () => {
  assert.equal(validateMetaMediaUrl("https://lookaside.fbsbx.com/whatsapp_business/attachments/?id=1"), "https://lookaside.fbsbx.com/whatsapp_business/attachments/?id=1");
  for (const value of [
    "http://lookaside.fbsbx.com/file",
    "https://lookaside.fbsbx.com.evil.example/file",
    "https://127.0.0.1/file",
    "https://user:pass@lookaside.fbsbx.com/file",
    "https://lookaside.fbsbx.com:8443/file"
  ]) {
    assert.throws(() => validateMetaMediaUrl(value), { code: "META_MEDIA_URL_INVALID" });
  }
});

test("media download checks phone ownership and never forwards token to an untrusted URL", async () => {
  const originalFetch = globalThis.fetch;
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = "test-media-key-only";
  const urls = [];
  globalThis.fetch = async (url, options) => {
    urls.push([String(url), options]);
    return Response.json({ url: "https://lookaside.fbsbx.com.evil.example/media" });
  };
  try {
    await assert.rejects(() => fetchWhatsAppMedia({ setup, mediaId: "media-1" }), { code: "META_MEDIA_URL_INVALID" });
    assert.equal(urls.length, 1);
    assert.equal(new URL(urls[0][0]).searchParams.get("phone_number_id"), setup.phone_number_id);
    assert.equal(urls[0][1].redirect, "error");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEncryptionKey;
  }
});

test("media download rejects oversized responses before buffering", async () => {
  const originalFetch = globalThis.fetch;
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = "test-media-key-only";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? Response.json({ url: "https://lookaside.fbsbx.com/media" })
      : new Response("data", { headers: { "content-length": String(101 * 1024 * 1024) } });
  };
  try {
    await assert.rejects(() => fetchWhatsAppMedia({ setup, mediaId: "media-2" }), { code: "META_MEDIA_TOO_LARGE" });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEncryptionKey;
  }
});
