import crypto from "crypto";
import { AppError, id } from "./db";

const graphVersion = () => process.env.META_GRAPH_API_VERSION || "v20.0";
const graphUrl = (path) => `https://graph.facebook.com/${graphVersion()}/${path}`;

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
  return Boolean(setup?.phone_number_id && setup?.waba_id && setup?.access_token_encrypted);
}

function accessToken(setup) {
  if (!metaReady(setup)) throw new AppError("Meta WhatsApp credentials are required before sending messages.", 400, "META_NOT_CONFIGURED");
  return decryptSecret(setup.access_token_encrypted);
}

export function templateApiName(name) {
  return String(name || "template")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || `template_${id("wa").slice(3)}`;
}

export async function createWhatsAppTemplate({ setup, name, body, category = "MARKETING", language = "en_US" }) {
  const token = accessToken(setup);
  const apiName = templateApiName(name);
  const response = await fetch(graphUrl(`${setup.waba_id}/message_templates`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: apiName,
      language,
      category,
      components: [{ type: "BODY", text: body }]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AppError(payload.error?.message || "Meta template submission failed.", response.status, "META_TEMPLATE_FAILED");
  }
  return { id: payload.id || "", name: apiName, status: payload.status || "PENDING" };
}

export async function listWhatsAppTemplates({ setup }) {
  const token = accessToken(setup);
  const response = await fetch(graphUrl(`${setup.waba_id}/message_templates?fields=id,name,status,category,language,components&limit=100`), {
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AppError(payload.error?.message || "Meta template sync failed.", response.status, "META_TEMPLATE_SYNC_FAILED");
  }
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function sendTextMessage({ setup, to, body }) {
  const token = accessToken(setup);
  const response = await fetch(graphUrl(`${setup.phone_number_id}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: String(to).replace(/\D/g, ""),
      type: "text",
      text: { preview_url: false, body: String(body || "") }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AppError(payload.error?.message || "Meta text message send failed.", response.status, "META_SEND_FAILED");
  }
  return { status: "sent", metaMessageId: payload.messages?.[0]?.id || id("wamid"), provider: "meta" };
}

export async function sendTemplateMessage({ setup, to, templateName, variables = [] }) {
  const token = accessToken(setup);
  const response = await fetch(graphUrl(`${setup.phone_number_id}/messages`), {
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
    throw new AppError(payload.error?.message || "Meta template message send failed.", response.status, "META_SEND_FAILED");
  }
  return { status: "sent", metaMessageId: payload.messages?.[0]?.id || id("wamid"), provider: "meta" };
}
