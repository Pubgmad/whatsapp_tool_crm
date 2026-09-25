import crypto from "node:crypto";
import { AppError } from "./db.js";

export function verifyFlowSignature(rawBody, header, appSecret) {
  if (!appSecret || !/^sha256=[a-f0-9]{64}$/i.test(header || "")) return false;
  const actual = Buffer.from(header.slice(7), "hex");
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest();
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function decodeBase64(value, maxBytes) {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length > maxBytes * 2) {
    throw new AppError("Invalid encrypted Flow request.", 400, "INVALID_FLOW_PAYLOAD");
  }
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || decoded.length > maxBytes) throw new AppError("Invalid encrypted Flow request.", 400, "INVALID_FLOW_PAYLOAD");
  return decoded;
}

export function decryptFlowRequest(body, privatePem) {
  const encryptedKey = decodeBase64(body?.encrypted_aes_key, 512);
  const encryptedData = decodeBase64(body?.encrypted_flow_data, 256 * 1024);
  const iv = decodeBase64(body?.initial_vector, 32);
  if (encryptedData.length <= 16 || ![12, 16].includes(iv.length)) throw new AppError("Invalid encrypted Flow request.", 400, "INVALID_FLOW_PAYLOAD");
  let aesKey;
  try {
    aesKey = crypto.privateDecrypt({
      key: privatePem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    }, encryptedKey);
  } catch {
    throw new AppError("Flow encryption key changed. Retry the Flow.", 421, "FLOW_KEY_MISMATCH");
  }
  if (aesKey.length !== 16) throw new AppError("Invalid encrypted Flow request.", 400, "INVALID_FLOW_PAYLOAD");
  try {
    const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, iv);
    decipher.setAuthTag(encryptedData.subarray(-16));
    const plain = Buffer.concat([decipher.update(encryptedData.subarray(0, -16)), decipher.final()]);
    const request = JSON.parse(plain.toString("utf8"));
    if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Invalid body");
    return { request, aesKey, iv };
  } catch {
    throw new AppError("Invalid encrypted Flow request.", 400, "INVALID_FLOW_PAYLOAD");
  }
}

export function encryptFlowResponse(response, aesKey, iv) {
  const flippedIv = Buffer.from(iv.map((byte) => byte ^ 0xff));
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, flippedIv);
  return Buffer.concat([cipher.update(JSON.stringify(response), "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
}
