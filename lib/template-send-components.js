import { AppError } from './db.js';
import {carouselCardSchema,variableCount} from './advanced-template-components.js';
import {flowSendParameter,flowTemplateButton,templateButtons} from './flow-template-components.js';

function invalid() {
  throw new AppError('Template parameters are invalid or unsupported.', 400, 'TEMPLATE_PARAMETERS_INVALID');
}

export function validateTemplateParameters(template, input = {}, {allowFlow = false} = {}) {
  templateSendComponents([], input);
  const schema=template?.component_schema||{};
  const offer=schema.components?.find(component=>String(component.type).toUpperCase()==='LIMITED_TIME_OFFER');
  if(input.limitedTimeOffer&&!offer)invalid();
  if(offer?.limited_time_offer?.has_expiration===true&&!input.limitedTimeOffer)throw new AppError('Provide this offer expiration time.',400,'TEMPLATE_EXPIRATION_REQUIRED');
  const catalog=(schema.buttons||template?.buttons||[]).some(button=>String(button.type).toUpperCase()==='CATALOG')||schema.components?.some(component=>String(component.type).toUpperCase()==='BUTTONS'&&component.buttons?.some(button=>String(button.type).toUpperCase()==='CATALOG'));
  if(input.catalog&&!catalog)invalid();
  const definitions=schema.components?.find(component=>String(component.type).toUpperCase()==='CAROUSEL')?.cards;
  if(definitions){
    if(!Array.isArray(input.carousel)||input.carousel.length!==definitions.length)invalid();
    for(const [index,definition] of definitions.entries()){
      const card=carouselCardSchema(definition),values=input.carousel[index];
      if(!Array.isArray(values.variables)||values.variables.length!==variableCount(card.body))invalid();
      validateTemplateParameters({component_schema:card},{header:values.header,buttons:values.buttons});
    }
  }else if(input.carousel)invalid();
  const format = String(template?.component_schema?.headerFormat || 'NONE').toLowerCase();
  if(input.header?.type==='product'&&format!=='product')invalid();
  if (['image', 'video', 'document','product'].includes(format) && input.header?.type !== format) {
    throw new AppError('This template requires a matching media header.', 400, 'TEMPLATE_HEADER_REQUIRED');
  }
  const buttons = templateButtons(template);
  const flowButton = flowTemplateButton(template);
  if(flowButton&&!allowFlow)throw new AppError('Send Flow templates through a tracked Flow invitation.',400,'TEMPLATE_FLOW_INVITE_REQUIRED');
  if(flowButton&&!input.buttons?.some(button=>button.index===flowButton.index&&button.type==='flow'))throw new AppError('Generate a tracked Flow invitation before sending this template.',400,'TEMPLATE_FLOW_INVITE_REQUIRED');
  for (const button of input.buttons || []) {
    const definition = buttons[button.index];
    if (!definition || String(definition.type).toLowerCase() !== button.type) invalid();
  }
  for (const [index, button] of buttons.entries()) {
    if(String(button.type).toUpperCase()==='COPY_CODE'&&!input.buttons?.some(item=>item.index===index&&item.type==='copy_code'))throw new AppError('Provide this template coupon code.',400,'TEMPLATE_BUTTON_REQUIRED');
    if (String(button.type).toUpperCase() === 'URL' && /{{\s*\d+\s*}}/.test(button.value || button.url || '') && !input.buttons?.some((item) => item.index === index && item.type === 'url')) {
      throw new AppError('Provide the dynamic URL button value.', 400, 'TEMPLATE_BUTTON_REQUIRED');
    }
  }
  return input;
}

export function templateSendComponents(variables = [], input = {}) {
  if (!Array.isArray(variables) || !input || typeof input !== 'object' || Array.isArray(input)) invalid();
  if (Object.keys(input).some((key) => !['header', 'buttons','carousel','catalog','limitedTimeOffer'].includes(key))) invalid();
  const components = [];
  if (input.header) {
    const header = input.header;
    if (!header || typeof header !== 'object' || Array.isArray(header)) invalid();
    const type = String(header.type || '').toLowerCase();
    let parameter;
    if (type === 'text') {
      if (typeof header.text !== 'string' || !header.text.trim() || header.text.length > 1024) invalid();
      parameter = { type, text: header.text };
    } else if (['image', 'video', 'document'].includes(type)) {
      if (Boolean(header.id) === Boolean(header.link)) invalid();
      const media = {};
      if (header.id) {
        if (!/^\d+$/.test(String(header.id))) invalid();
        media.id = String(header.id);
      } else {
        let url;
        try { url = new URL(header.link); } catch { invalid(); }
        if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2000) invalid();
        media.link = url.href;
      }
      if (type === 'document' && header.filename) {
        if (typeof header.filename !== 'string' || header.filename.length > 255 || /[\r\n]/.test(header.filename)) invalid();
        media.filename = header.filename;
      }
      parameter = { type, [type]: media };
    } else if(type==='product'){
      if(!/^[0-9]{1,32}$/.test(header.catalogId||'')||typeof header.retailerId!=='string'||!header.retailerId.trim()||header.retailerId.length>256||Object.keys(header).some(key=>!['type','catalogId','retailerId'].includes(key)))invalid();
      parameter={type:'product',product:{catalog_id:header.catalogId,product_retailer_id:header.retailerId.trim()}};
    } else invalid();
    components.push({ type: 'header', parameters: [parameter] });
  }
  if (variables.length) {
    if (variables.length > 100 || variables.some((value) => !['string', 'number'].includes(typeof value) || String(value).length > 32768)) invalid();
    components.push({ type: 'body', parameters: variables.map((value) => ({ type: 'text', text: String(value) })) });
  }
  if (input.buttons !== undefined) {
    if (!Array.isArray(input.buttons) || input.buttons.length > 10) invalid();
    const indices = new Set();
    for (const button of input.buttons) {
      if (!button || typeof button !== 'object' || !Number.isInteger(button.index) || button.index < 0 || button.index > 9 || indices.has(button.index)) invalid();
      indices.add(button.index);
      const subtype = String(button.type || '').toLowerCase();
      if(subtype==='flow'){
        components.push({type:'button',sub_type:'flow',index:String(button.index),parameters:[flowSendParameter(button)]});
        continue;
      }
      if(subtype==='copy_code'&&typeof button.value==='string'&&button.value.length>15)invalid();
      if (!['url', 'quick_reply', 'copy_code'].includes(subtype) || typeof button.value !== 'string' || !button.value.trim() || button.value.length > 2000) invalid();
      const parameter = subtype === 'quick_reply' ? { type: 'payload', payload: button.value }
        : subtype === 'copy_code' ? { type: 'coupon_code', coupon_code: button.value }
          : { type: 'text', text: button.value };
      components.push({ type: 'button', sub_type: subtype, index: String(button.index), parameters: [parameter] });
    }
  }
  if(input.carousel!==undefined){
    if(!Array.isArray(input.carousel)||input.carousel.length<2||input.carousel.length>10)invalid();
    const cards=input.carousel.map((card,index)=>{
      if(!card||typeof card!=='object'||Object.keys(card).some(key=>!['header','buttons','variables'].includes(key)))invalid();
      return {card_index:index,components:templateSendComponents(card.variables||[],{header:card.header,buttons:card.buttons})};
    });
    components.push({type:'carousel',cards});
  }
  if(input.catalog!==undefined){
    if(!input.catalog||typeof input.catalog!=='object'||Array.isArray(input.catalog)||Object.keys(input.catalog).some(key=>key!=='thumbnailRetailerId')||typeof input.catalog.thumbnailRetailerId!=='string'||!input.catalog.thumbnailRetailerId.trim()||input.catalog.thumbnailRetailerId.length>256)invalid();
    components.push({type:'button',sub_type:'CATALOG',index:0,parameters:[{type:'action',action:{thumbnail_product_retailer_id:input.catalog.thumbnailRetailerId}}]});
  }
  if(input.limitedTimeOffer!==undefined){
    const offer=input.limitedTimeOffer;
    if(!offer||typeof offer!=='object'||Array.isArray(offer)||Object.keys(offer).some(key=>key!=='expirationTimeMs')||!Number.isSafeInteger(offer.expirationTimeMs)||offer.expirationTimeMs<=Date.now())invalid();
    components.push({type:'limited_time_offer',parameters:[{type:'limited_time_offer',limited_time_offer:{expiration_time_ms:offer.expirationTimeMs}}]});
  }
  return components;
}
