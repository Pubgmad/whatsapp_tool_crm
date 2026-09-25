import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { decryptFlowRequest, encryptFlowResponse, verifyFlowSignature } from "../lib/whatsapp-flow-crypto.js";

test("Flow request signature validates exact bytes", () => {
  const secret = "test-secret";
  const raw = JSON.stringify({ action: "ping" });
  const header = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyFlowSignature(raw, header, secret), true);
  assert.equal(verifyFlowSignature(raw + " ", header, secret), false);
  assert.equal(verifyFlowSignature(raw, null, secret), false);
  assert.equal(verifyFlowSignature(raw, header, ""), false);
});

test("Flow encryption round-trips and rejects tampering", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  const aesKey = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify({ action: "INIT", screen: "START" })), cipher.final(), cipher.getAuthTag()]);
  const body = {
    encrypted_aes_key: crypto.publicEncrypt({ key: publicKey, oaepHash: "sha256", padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, aesKey).toString("base64"),
    encrypted_flow_data: data.toString("base64"),
    initial_vector: iv.toString("base64")
  };
  const decrypted = decryptFlowRequest(body, privateKey);
  assert.equal(decrypted.request.screen, "START");
  const response = encryptFlowResponse({ screen: "NEXT", data: {} }, decrypted.aesKey, decrypted.iv);
  const flipped = Buffer.from(iv.map((byte) => byte ^ 0xff));
  const encrypted = Buffer.from(response, "base64");
  const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, flipped);
  decipher.setAuthTag(encrypted.subarray(-16));
  assert.deepEqual(JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString()), { screen: "NEXT", data: {} });
  assert.throws(() => decryptFlowRequest({ ...body, encrypted_flow_data: Buffer.concat([data.subarray(0, -1), Buffer.from([0])]).toString("base64") }, privateKey), { code: "INVALID_FLOW_PAYLOAD" });
});
