import crypto from "crypto";
import { AppError, id } from "./db";

function encryptionKey() {
  const base = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!base || base.startsWith("replace-with")) return null;
  return crypto.createHash("sha256").update(base).digest();
}

export function encryptSecret(value) {
  const plain = String(value || "").trim();
  if (!plain) return "";
  const key = encryptionKey();
  if (!key) throw new AppError("ENCRYPTION_KEY is required before storing Meta access tokens.", 503, "ENCRYPTION_NOT_CONFIGURED");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(value) {
  if (!value) return "";
  const key = encryptionKey();
  if (!key) throw new AppError("ENCRYPTION_KEY is required before using stored Meta access tokens.", 503, "ENCRYPTION_NOT_CONFIGURED");
  const [version, iv, tag, encrypted] = String(value).split(":");
  if (version !== "v1") return "";
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function metaReady(setup) {
  return Boolean(setup?.phone_number_id && setup?.access_token_encrypted && setup?.mode === "Live Meta");
}

export async function sendTemplateMessage({ setup, to, templateName, variables = [] }) {
  if (!metaReady(setup)) {
    return { status: "sent", metaMessageId: id("mock_wamid"), provider: "mock" };
  }

  const token = decryptSecret(setup.access_token_encrypted);
  const response = await fetch(`https://graph.facebook.com/v20.0/${setup.phone_number_id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(to).replace(/\D/g, ""),
      type: "template",
      template: {
        name: templateName,
        language: { code: "en_US" },
        components: variables.length ? [{
          type: "body",
          parameters: variables.map((value) => ({ type: "text", text: String(value) }))
        }] : []
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AppError(payload.error?.message || "Meta message send failed.", response.status, "META_SEND_FAILED");
  }
  return { status: "sent", metaMessageId: payload.messages?.[0]?.id || id("wamid"), provider: "meta" };
}
