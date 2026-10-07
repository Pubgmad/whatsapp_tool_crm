import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { AppError } from "../lib/db.js";
import { decryptFlowRequest, encryptFlowResponse, verifyFlowSignature } from "../lib/whatsapp-flow-crypto.js";

function assertInvalidFlowPayload(fn) {
  assert.throws(fn, (error) => error instanceof AppError && error.code === "INVALID_FLOW_PAYLOAD");
}

function buildEncryptedFlowBody() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  const aesKey = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, iv);
  const payload = JSON.stringify({ action: "INIT", screen: "START" });
  const data = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
  const body = {
    encrypted_aes_key: crypto.publicEncrypt(
      { key: publicKey, oaepHash: "sha256", padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
      aesKey
    ).toString("base64"),
    encrypted_flow_data: data.toString("base64"),
    initial_vector: iv.toString("base64")
  };
  return { body, privateKey, aesKey, iv, data };
}

test("Flow request signature validates exact bytes", () => {
  const secret = "test-secret";
  const raw = JSON.stringify({ action: "ping" });
  const header = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyFlowSignature(raw, header, secret), true);
  assert.equal(verifyFlowSignature(raw + " ", header, secret), false);
  assert.equal(verifyFlowSignature(raw, null, secret), false);
  assert.equal(verifyFlowSignature(raw, header, ""), false);
});

test("Flow encryption round-trips response payload", () => {
  const { body, privateKey, aesKey, iv } = buildEncryptedFlowBody();
  const decrypted = decryptFlowRequest(body, privateKey);
  assert.equal(decrypted.request.screen, "START");
  const response = encryptFlowResponse({ screen: "NEXT", data: {} }, decrypted.aesKey, decrypted.iv);
  const flippedIv = Buffer.from(iv.map((byte) => byte ^ 0xff));
  const encrypted = Buffer.from(response, "base64");
  const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, flippedIv);
  decipher.setAuthTag(encrypted.subarray(-16));
  const plain = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString("utf8");
  assert.deepEqual(JSON.parse(plain), { screen: "NEXT", data: {} });
});

test("Flow decryption rejects tampered ciphertext and auth tag", () => {
  const { body, privateKey, data } = buildEncryptedFlowBody();
  const corruptCipher = Buffer.from(data);
  corruptCipher[0] ^= 0xff;
  assertInvalidFlowPayload(() => decryptFlowRequest(
    { ...body, encrypted_flow_data: corruptCipher.toString("base64") },
    privateKey
  ));

  const corruptTag = Buffer.from(data);
  corruptTag[corruptTag.length - 1] ^= 0xff;
  assertInvalidFlowPayload(() => decryptFlowRequest(
    { ...body, encrypted_flow_data: corruptTag.toString("base64") },
    privateKey
  ));

  assertInvalidFlowPayload(() => decryptFlowRequest(
    { ...body, encrypted_flow_data: "not-valid-base64!!!" },
    privateKey
  ));
});
