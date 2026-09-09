import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { verifyMetaSignedRequest } from "../lib/meta-data-controls.js";

const secret = "unit-test-meta-secret";

function signedRequest(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${signature}.${encodedPayload}`;
}

test("accepts a valid Meta signed request", () => {
  const payload = verifyMetaSignedRequest(signedRequest({ algorithm: "HMAC-SHA256", user_id: "123456" }), secret);
  assert.equal(payload.user_id, "123456");
});

test("rejects a modified Meta signed request", () => {
  const value = signedRequest({ algorithm: "HMAC-SHA256", user_id: "123456" });
  assert.throws(() => verifyMetaSignedRequest(`${value.slice(0, -1)}A`, secret), /signature|payload/i);
});

test("rejects an unsupported signing algorithm", () => {
  assert.throws(() => verifyMetaSignedRequest(signedRequest({ algorithm: "none", user_id: "123456" }), secret), /algorithm/i);
});
