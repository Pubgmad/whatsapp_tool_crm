import fs from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
export const demoDataEnabled = process.env.DEMO_DATA !== "false";

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function baseSetup() {
  return {
    businessName: process.env.DEFAULT_BUSINESS_NAME || "",
    whatsappNumber: process.env.DEFAULT_WHATSAPP_NUMBER || "",
    wabaId: process.env.META_WABA_ID || "",
    phoneNumberId: process.env.META_PHONE_NUMBER_ID || "",
    accessToken: process.env.META_ACCESS_TOKEN || "",
    webhookUrl: process.env.WEBHOOK_URL || "http://localhost:3000/api/webhooks/meta",
    mode: process.env.META_ACCESS_TOKEN ? "Live Meta" : "Mock Meta",
    status: process.env.META_WABA_ID && process.env.META_PHONE_NUMBER_ID ? "Connected" : "Needs setup"
  };
}

export function emptyStore() {
  return { setup: baseSetup(), contacts: [], templates: [], campaigns: [], conversations: [], events: [] };
}

export function demoStore() {
  return {
    setup: {
      ...baseSetup(),
      businessName: process.env.DEFAULT_BUSINESS_NAME || "ABC Clothing",
      whatsappNumber: process.env.DEFAULT_WHATSAPP_NUMBER || "+91 98765 43210",
      wabaId: process.env.META_WABA_ID || "mock-waba-10293",
      phoneNumberId: process.env.META_PHONE_NUMBER_ID || "mock-phone-78910",
      mode: process.env.META_ACCESS_TOKEN ? "Live Meta" : "Mock Meta",
      status: "Connected"
    },
    contacts: [
      { id: "c_1", name: "John Mathew", phone: "+91 98765 10001", marketingPermission: true, unsubscribed: false, lastMessageAt: isoHoursAgo(2), source: "Demo seed" },
      { id: "c_2", name: "Ahmed Khan", phone: "+91 98765 10002", marketingPermission: true, unsubscribed: false, lastMessageAt: isoHoursAgo(29), source: "Demo seed" },
      { id: "c_3", name: "Rahul Nair", phone: "+91 98765 10003", marketingPermission: false, unsubscribed: true, lastMessageAt: null, source: "Demo seed" },
      { id: "c_4", name: "Meera Iyer", phone: "+91 98765 10004", marketingPermission: true, unsubscribed: false, lastMessageAt: isoHoursAgo(5), source: "Demo seed" },
      { id: "c_5", name: "Sara Joseph", phone: "+91 98765 10005", marketingPermission: true, unsubscribed: false, lastMessageAt: null, source: "Demo seed" }
    ],
    templates: [
      { id: "t_1", name: "Weekend Sale", category: "Marketing", body: "Hi {{name}}, we have a {{discount}} discount this weekend. Visit our store today.", variables: ["name", "discount"], status: "Approved", metaTemplateId: "meta_tpl_weekend_sale", source: "Demo seed" },
      { id: "t_2", name: "Diwali Discount", category: "Marketing", body: "Hi {{name}}, Diwali sale is live. Get {{discount}} off today.", variables: ["name", "discount"], status: "Pending", metaTemplateId: "", source: "Demo seed" }
    ],
    campaigns: [],
    conversations: [
      { id: "v_1", contactId: "c_1", messages: [
        { id: "m_1", direction: "incoming", body: "Is this offer available tomorrow?", at: isoHoursAgo(2), status: "received" },
        { id: "m_2", direction: "outgoing", body: "Yes, it is available until Sunday.", at: isoHoursAgo(1.8), status: "sent" }
      ] },
      { id: "v_2", contactId: "c_2", messages: [
        { id: "m_3", direction: "incoming", body: "Do you have medium size?", at: isoHoursAgo(29), status: "received" }
      ] }
    ],
    events: []
  };
}

export function id(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) saveStore(demoDataEnabled ? demoStore() : emptyStore());
}

export function loadStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
}

export function saveStore(store) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function resetStore(useDemo = true) {
  const store = useDemo ? demoStore() : emptyStore();
  saveStore(store);
  return store;
}

export function okToReply(contact) {
  if (!contact?.lastMessageAt) return false;
  return Date.now() - new Date(contact.lastMessageAt).getTime() <= 24 * 60 * 60 * 1000;
}

export function templateVariables(body) {
  return [...new Set([...String(body || "").matchAll(/{{\s*([\w.-]+)\s*}}/g)].map((match) => match[1]))];
}

export function renderTemplate(body, contact, variables = {}) {
  return String(body || "").replace(/{{\s*([\w.-]+)\s*}}/g, (_, key) => key === "name" ? contact.name : variables[key] || "");
}

export function campaignStats(recipients) {
  return {
    total: recipients.length,
    sent: recipients.filter((r) => ["sent", "delivered", "read"].includes(r.status)).length,
    delivered: recipients.filter((r) => ["delivered", "read"].includes(r.status)).length,
    read: recipients.filter((r) => r.status === "read").length,
    failed: recipients.filter((r) => r.status === "failed").length
  };
}

export function publicStore(store) {
  return {
    ...store,
    meta: {
      demoData: demoDataEnabled,
      storage: STORE_PATH,
      liveMetaReady: Boolean(store.setup.accessToken && store.setup.wabaId && store.setup.phoneNumberId)
    },
    setup: { ...store.setup, accessToken: store.setup.accessToken ? "saved-token-hidden" : "" },
    conversations: store.conversations.map((conversation) => ({
      ...conversation,
      canReply: okToReply(store.contacts.find((contact) => contact.id === conversation.contactId))
    }))
  };
}

export function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}
