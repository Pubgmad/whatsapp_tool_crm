import crypto from "crypto";
import { templateSendComponents } from './template-send-components.js';
import {advancedTemplateComponents} from './advanced-template-components.js';
import { AppError, id } from "./db.js";
import { metaGraphApiVersion } from './operational-policy.js';

const graphVersion = () => metaGraphApiVersion();
const graphUrl = (path) => `https://graph.facebook.com/${graphVersion()}/${path}`;

function encryptionKey(base = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET) {
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
  const [version, iv, tag, encrypted] = String(value).split(":");
  if (version !== "v1") return "";
  const keys = [encryptionKey(), encryptionKey(process.env.ENCRYPTION_KEY_PREVIOUS)].filter(Boolean);
  if (!keys.length) throw new AppError('ENCRYPTION_KEY is required before using stored secrets.', 503, 'ENCRYPTION_NOT_CONFIGURED');
  for (const key of keys) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
    } catch {}
  }
  throw new AppError('Stored secret cannot be decrypted with the configured keys.', 503, 'SECRET_ROTATION_REQUIRED');
}

export function metaReady(setup) {
  return Boolean(setup?.phone_number_id && setup?.waba_id && setup?.access_token_encrypted);
}

function accessToken(setup) {
  if (!metaReady(setup)) throw new AppError("Meta WhatsApp credentials are required before sending messages.", 400, "META_NOT_CONFIGURED");
  return decryptSecret(setup.access_token_encrypted);
}

function accountAccessToken(setup) {
  if (!setup?.waba_id || !setup?.access_token_encrypted) throw new AppError('Connect a WhatsApp account before managing templates.', 400, 'META_NOT_CONFIGURED');
  return decryptSecret(setup.access_token_encrypted);
}

function confirmedMessageId(payload) {
  const messageId = payload.messages?.[0]?.id;
  if (!messageId || typeof messageId !== "string") {
    throw new AppError("Meta did not return a message ID. Delivery is unconfirmed; check Meta before resending.", 409, "META_SEND_UNCONFIRMED");
  }
  return messageId;
}

async function postMetaMessage(setup, token, body, failureMessage, endpoint = 'messages') {
  let response;
  try {
    response = await fetch(graphUrl(`${setup.phone_number_id}/${endpoint}`), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30000)
    });
  } catch {
    throw new AppError("Meta delivery is unconfirmed after a network error. Check Meta before resending.", 409, "META_SEND_UNCONFIRMED");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new AppError(payload.error?.message || failureMessage, response.status, "META_SEND_FAILED");
  return { status: "sent", metaMessageId: confirmedMessageId(payload), provider: "meta" };
}

export async function sendNativeFlowMessage({setup,to,body,cta,flowId,screen,token}) {
  return postMetaMessage(setup,accessToken(setup),{messaging_product:'whatsapp',recipient_type:'individual',to,type:'interactive',interactive:{type:'flow',body:{text:body},action:{name:'flow',parameters:{flow_message_version:'3',mode:'published',flow_token:token,flow_id:flowId,flow_cta:cta,flow_action:'navigate',flow_action_payload:{screen}}}}},'Meta rejected the Flow message.');
}

export async function sendCtaUrlMessage({setup,to,body,cta,url,headerText=''}) {
  if(typeof body!=='string'||!body.trim()||body.length>1024||typeof cta!=='string'||!cta.trim()||cta.length>20)throw new AppError('Provide a valid WhatsApp link message.',400,'CTA_URL_INVALID');
  let target;try{target=new URL(url);}catch{throw new AppError('Invalid WhatsApp link destination.',400,'CTA_URL_INVALID');}
  if(target.protocol!=='https:'||target.username||target.password||target.hash)throw new AppError('WhatsApp links require a trusted HTTPS destination.',400,'CTA_URL_INVALID');
  const header=clean(headerText);
  const interactive={type:'cta_url',body:{text:body.trim()},action:{name:'cta_url',parameters:{display_text:cta.trim(),url:target.href}}};
  if(header)interactive.header={type:'text',text:header.slice(0,60)};
  return postMetaMessage(setup,accessToken(setup),{messaging_product:'whatsapp',recipient_type:'individual',to:String(to).replace(/\D/g,''),type:'interactive',interactive},'Meta rejected the WhatsApp link message.');
}

function clean(value){return String(value||'').trim();}

export function hostedWebviewUrl(viewId,sessionToken=''){
  let app;try{app=new URL(process.env.APP_URL||'');}catch{throw new AppError('Configure the public HTTPS app URL.',503,'WEBVIEW_URL_UNAVAILABLE');}
  if(app.protocol!=='https:'||app.username||app.password||app.search||app.hash)throw new AppError('Configure the public HTTPS app URL.',503,'WEBVIEW_URL_UNAVAILABLE');
  const url=new URL(`/w/${encodeURIComponent(viewId)}`,app.origin);
  if(sessionToken)url.searchParams.set('session',sessionToken);
  return url.href;
}

export function templateApiName(name) {
  return String(name || "template")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || `template_${id("wa").slice(3)}`;
}

export async function createWhatsAppTemplate({ setup, name, body, category = "MARKETING", language = "en_US", headerText = "", footerText = "", buttons = [], componentSchema = {} }) {
  const token = accountAccessToken(setup);
  const apiName = templateApiName(name);
  const headerFormat = String(componentSchema.headerFormat || (headerText ? "TEXT" : "NONE")).toUpperCase();
  const mediaHandle = String(componentSchema.headerMediaHandle || "").trim();
  const isAuthentication = category === "AUTHENTICATION";
  const advancedButtons = Array.isArray(componentSchema.buttons) ? componentSchema.buttons : buttons;
  const otpType = String(componentSchema.otpType || "COPY_CODE").toUpperCase();
  if (isAuthentication && !["COPY_CODE", "ONE_TAP"].includes(otpType)) {
    throw new AppError("This OTP action is not supported by the template composer.", 400, "OTP_ACTION_UNSUPPORTED");
  }
  const packageName = String(componentSchema.otpPackageName || "").trim();
  const signatureHash = String(componentSchema.otpSignatureHash || "").trim();
  if (isAuthentication && otpType === "ONE_TAP" &&
    (!/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/.test(packageName) || !/^[A-Za-z0-9+/%=_-]{8,128}$/.test(signatureHash))) {
    throw new AppError("One-tap OTP requires a valid Android package name and app signature hash.", 400, "OTP_ANDROID_DETAILS_REQUIRED");
  }
  const otpButton = {
    type: "OTP",
    otp_type: otpType,
    text: String(componentSchema.otpButtonText || "Copy code").slice(0, 25),
    ...(otpType === "ONE_TAP" ? {
      autofill_text: String(componentSchema.otpAutofillText || "Autofill").slice(0, 25),
      package_name: packageName,
      signature_hash: signatureHash
    } : {})
  };
  const components = componentSchema.kind&&componentSchema.kind!=='STANDARD'?advancedTemplateComponents(componentSchema,body,category):isAuthentication
    ? [
        { type: "BODY", add_security_recommendation: componentSchema.addSecurityRecommendation !== false },
        { type: "FOOTER", code_expiration_minutes: Math.max(1, Math.min(Number(componentSchema.codeExpirationMinutes) || 10, 90)) },
        { type: "BUTTONS", buttons: [otpButton] }
      ]
    : [
        ...(headerFormat === "TEXT" && headerText ? [{ type: "HEADER", format: "TEXT", text: String(headerText) }] : []),
        ...(["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat) && mediaHandle ? [{ type: "HEADER", format: headerFormat, example: { header_handle: [mediaHandle] } }] : []),
        { type: "BODY", text: body },
        ...(footerText ? [{ type: "FOOTER", text: String(footerText) }] : []),
        ...(advancedButtons.length ? [{ type: "BUTTONS", buttons: advancedButtons.slice(0, 10).map((button) => {
          const type = String(button.type || "QUICK_REPLY").toUpperCase();
          if (type === "URL") return { type, text: String(button.text).slice(0, 25), url: String(button.value || button.url || "").slice(0, 2000) };
          if (type === "PHONE_NUMBER") return { type, text: String(button.text).slice(0, 25), phone_number: String(button.value || button.phone_number || "").replace(/[^+\d]/g, "") };
          return { type: "QUICK_REPLY", text: String(button.text).slice(0, 25) };
        }) }] : [])
      ];
  const response = await fetch(graphUrl(`${setup.waba_id}/message_templates`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      name: apiName,
      language,
      category,
      components
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AppError(payload.error?.message || "Meta template submission failed.", response.status, "META_TEMPLATE_FAILED");
  }
  return { id: payload.id || "", name: apiName, status: payload.status || "PENDING" };
}

export async function listWhatsAppTemplates({ setup, fetcher = fetch }) {
  const token = accountAccessToken(setup);
  const base = new URL(graphUrl(`${setup.waba_id}/message_templates?fields=id,name,status,category,language,components&limit=100`));
  let next = base;
  const seen = new Set();
  const templates = [];
  while (next) {
    if (seen.size >= 100 || seen.has(next.href)) throw new AppError('Meta template pagination did not complete.', 502, 'META_TEMPLATE_PAGING_INVALID');
    seen.add(next.href);
    const response = await fetcher(next, {headers: {Authorization: `Bearer ${token}`}, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000)});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new AppError(payload.error?.message || 'Meta template sync failed.', response.status, 'META_TEMPLATE_SYNC_FAILED');
    if (!Array.isArray(payload.data)) throw new AppError('Meta template response was invalid.', 502, 'META_TEMPLATE_SYNC_INVALID');
    templates.push(...payload.data);
    const cursor = payload.paging?.next;
    if (!cursor) { next = null; continue; }
    let candidate;
    try { candidate = new URL(cursor); } catch { throw new AppError('Meta returned an invalid template page.', 502, 'META_TEMPLATE_PAGING_INVALID'); }
    if (candidate.protocol !== 'https:' || candidate.hostname !== base.hostname || candidate.pathname !== base.pathname || candidate.username || candidate.password || candidate.port) {
      throw new AppError('Meta returned an unexpected template page.', 502, 'META_TEMPLATE_PAGING_INVALID');
    }
    candidate.searchParams.delete('access_token');
    next = candidate;
  }
  return templates;
}

export async function sendTextMessage({ setup, to, body }) {
  const token = accessToken(setup);
  return postMetaMessage(setup, token, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: String(to).replace(/\D/g, ""),
      type: "text",
      text: { preview_url: false, body: String(body || "") }
    }, "Meta text message send failed.");
}

/** Send image/video/document by public HTTPS link (Dialogflow Basic Card / media payloads). */
export async function sendMediaLinkMessage({ setup, to, type = 'image', link, caption = '', filename = '' }) {
  const mediaType = ['image', 'video', 'document', 'audio'].includes(type) ? type : 'image';
  let target;
  try { target = new URL(String(link || '').trim()); } catch { throw new AppError('Media link is invalid.', 400, 'MEDIA_LINK_INVALID'); }
  if (target.protocol !== 'https:' || target.username || target.password || target.hash) {
    throw new AppError('Media links require a public HTTPS URL.', 400, 'MEDIA_LINK_INVALID');
  }
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to).replace(/\D/g, ''),
    type: mediaType,
    [mediaType]: {
      link: target.href,
      ...(caption && mediaType !== 'audio' ? { caption: String(caption).slice(0, 1024) } : {}),
      ...(mediaType === 'document' && filename ? { filename: String(filename).slice(0, 240) } : {})
    }
  };
  return postMetaMessage(setup, accessToken(setup), payload, 'Meta media message send failed.');
}


export async function sendInteractiveMessage({ setup, to, body, options = [], mode = "buttons", buttonText = "Choose", sectionTitle = "Options" }) {
  const cleanOptions = options.map((option, index) => ({
    id: String(option.id || option.value || `option_${index + 1}`).slice(0, 256),
    title: String(option.label || option.title || option.id || `Option ${index + 1}`).slice(0, 20),
    description: String(option.description || "").slice(0, 72),
    section: String(option.section || sectionTitle || 'Options').slice(0, 24)
  })).filter((option) => option.id && option.title);

  if (!cleanOptions.length) return sendTextMessage({ setup, to, body });

  const useButtons = mode !== "list" && cleanOptions.length <= 3;
  const interactive = useButtons
    ? {
        type: "button",
        body: { text: String(body || "") },
        action: {
          buttons: cleanOptions.map((option) => ({
            type: "reply",
            reply: { id: option.id, title: option.title }
          }))
        }
      }
    : {
        type: "list",
        body: { text: String(body || "") },
        action: {
          button: String(buttonText || "Choose").slice(0, 20),
          sections: [...new Set(cleanOptions.map(option => option.section))].map(title => ({
            title,
            rows: cleanOptions.filter(option => option.section === title).map((option) => ({
              id: option.id,
              title: option.title,
              description: option.description || undefined
            }))
          }))
        }
      };

  const token = accessToken(setup);
  return postMetaMessage(setup, token, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: String(to).replace(/\D/g, ""),
      type: "interactive",
      interactive
    }, "Meta interactive message send failed.");
}

export async function sendProductMessage({ setup, to, body = '', catalogId, retailerId }) {
  const interactive = {
    type: 'product',
    ...(body ? { body: { text: String(body).slice(0, 1024) } } : {}),
    action: { catalog_id: catalogId, product_retailer_id: retailerId }
  };
  return postMetaMessage(setup, accessToken(setup), {
    messaging_product: 'whatsapp', recipient_type: 'individual',
    to: String(to).replace(/\D/g, ''), type: 'interactive', interactive
  }, 'Meta product message send failed.');
}

export async function sendProductListMessage({ setup, to, body, catalogId, sections, buttonText = 'View products' }) {
  const interactive = {
    type: 'product_list',
    body: { text: String(body).slice(0, 1024) },
    action: {
      catalog_id: catalogId,
      button: String(buttonText).slice(0, 20),
      sections: sections.map(section => ({
        title: section.title,
        product_items: section.retailerIds.map(product_retailer_id => ({ product_retailer_id }))
      }))
    }
  };
  return postMetaMessage(setup, accessToken(setup), {
    messaging_product: 'whatsapp', recipient_type: 'individual',
    to: String(to).replace(/\D/g, ''), type: 'interactive', interactive
  }, 'Meta product list send failed.');
}

export async function sendTemplateMessage({ setup, to, templateName, language = "en_US", variables = [], parameters = {} }) {
  const token = accessToken(setup);
  await verifyCarouselProducts(setup,token,parameters);
  return postMetaMessage(setup, token, {
      messaging_product: "whatsapp",
      to: String(to).replace(/\D/g, ""),
      type: "template",
      template: {
        name: templateName,
        language: { code: String(language || "en_US") },
        components: templateSendComponents(variables, parameters)
      }
    }, "Meta template message send failed.");
}
export async function sendMarketingTemplateMessage({ setup, to, templateName, language = 'en_US', variables = [], parameters = {} }) {
  await verifyCarouselProducts(setup,accessToken(setup),parameters);
  return postMetaMessage(setup, accessToken(setup), {
    messaging_product: 'whatsapp',
    to: String(to).replace(/\D/g, ''),
    type: 'template',
    template: {
      name: templateName,
      language: { code: String(language || 'en_US') },
      components: templateSendComponents(variables, parameters)
    },
    product_policy: 'STRICT'
  }, 'Meta Marketing Messages API send failed.', 'marketing_messages');
}

async function verifyCarouselProducts(setup,token,parameters){
  const products=(parameters.carousel||[]).filter(card=>card.header?.type==='product').map(card=>card.header);
  if(!products.length)return;
  templateSendComponents([],parameters);
  const catalogs=new Set(products.map(product=>product.catalogId));
  if(catalogs.size!==1||new Set(products.map(product=>product.retailerId)).size!==products.length)throw new AppError('Use unique products from one connected catalog.',400,'CAROUSEL_PRODUCTS_INVALID');
  const read=async path=>{
    const response=await fetch(graphUrl(path),{headers:{Authorization:'Bearer '+token},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
    const payload=await response.json();
    if(!response.ok||!Array.isArray(payload.data))throw new AppError('Unable to verify connected catalog assets.',409,'CAROUSEL_CATALOG_UNVERIFIED');
    return payload;
  };
  const linked=await read(encodeURIComponent(setup.waba_id)+'/product_catalogs?fields=id&limit=100');
  const catalogId=products[0].catalogId;
  if(!linked.data.some(catalog=>catalog.id===catalogId))throw new AppError('Catalog is not connected to this WhatsApp account.',403,'CAROUSEL_CATALOG_DENIED');
  const needed=new Set(products.map(product=>product.retailerId));let after='';
  for(let page=0;page<20;page++){
    const payload=await read(catalogId+'/products?fields=retailer_id&limit=100'+(after?'&after='+encodeURIComponent(after):''));
    for(const product of payload.data)needed.delete(product.retailer_id);
    if(!needed.size)return;
    after=payload.paging?.next?payload.paging?.cursors?.after||'':'';
    if(!after)break;
  }
  throw new AppError('Selected products could not be verified in the connected catalog.',403,'CAROUSEL_PRODUCT_DENIED');
}

export async function fetchWhatsAppMedia({ setup, mediaId }) {
  const token = accessToken(setup);
  const metadataUrl = new URL(graphUrl(encodeURIComponent(String(mediaId || ""))));
  metadataUrl.searchParams.set("phone_number_id", setup.phone_number_id);
  const metadataResponse = await fetch(metadataUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000)
  });
  const metadata = await metadataResponse.json().catch(() => ({}));
  if (!metadataResponse.ok || !metadata.url) {
    throw new AppError(metadata.error?.message || "WhatsApp media is unavailable.", metadataResponse.status || 404, "META_MEDIA_FAILED");
  }
  const mediaUrl = validateMetaMediaUrl(metadata.url);
  const mediaResponse = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(60000)
  });
  if (!mediaResponse.ok) throw new AppError("WhatsApp media download failed.", mediaResponse.status, "META_MEDIA_FAILED");
  return {
    bytes: await readMetaMediaLimited(mediaResponse),
    contentType: mediaResponse.headers.get("content-type") || metadata.mime_type || "application/octet-stream"
  };
}

const maxMetaMediaBytes = 100 * 1024 * 1024;
const metaMediaHosts = new Set(["lookaside.fbsbx.com", "graph.facebook.com"]);

export function validateMetaMediaUrl(value) {
  let url;
  try { url = new URL(String(value || "")); }
  catch { throw new AppError("Meta returned an invalid media URL.", 502, "META_MEDIA_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !metaMediaHosts.has(url.hostname.toLowerCase())) {
    throw new AppError("Meta returned an untrusted media URL.", 502, "META_MEDIA_URL_INVALID");
  }
  return url.toString();
}

async function readMetaMediaLimited(response) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxMetaMediaBytes) {
    throw new AppError("WhatsApp media exceeds the supported size.", 413, "META_MEDIA_TOO_LARGE");
  }
  if (!response.body) throw new AppError("WhatsApp media response is empty.", 502, "META_MEDIA_FAILED");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxMetaMediaBytes) throw new AppError("WhatsApp media exceeds the supported size.", 413, "META_MEDIA_TOO_LARGE");
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}
