import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {compileFlowDesign} from '../lib/flow-design.js';
import {validateFlowMapping,parseFlowReply,flowFieldNames} from '../lib/whatsapp-experiences.js';
import {advancedTemplateComponents} from '../lib/advanced-template-components.js';
import {templateSendComponents,validateTemplateParameters} from '../lib/template-send-components.js';
import {encryptSecret,sendTemplateMessage} from '../lib/meta.js';

test('multi-screen designs carry typed answers and only complete on the terminal screen',()=>{
  const design={version:'7.3',screens:[{id:'DETAILS',title:'Details',submitLabel:'Continue',fields:[{name:'buyer_name',label:'Name',type:'text',required:true}]},{id:'PREFERENCES',title:'Preferences',submitLabel:'Submit',fields:[{name:'interests',label:'Interests',type:'checkbox',required:false,options:[{id:'news',title:'News'}]}]}]};
  const compiled=compileFlowDesign(design);
  assert.equal(compiled.screens[0].terminal,undefined);assert.equal(compiled.screens[1].terminal,true);
  assert.deepEqual(compiled.screens[0].layout.children[0].children.at(-1)['on-click-action'].next,{type:'screen',name:'PREFERENCES'});
  assert.equal(compiled.screens[1].data.buyer_name.type,'string');
  assert.equal(compiled.screens[1].layout.children[0].children.at(-1)['on-click-action'].payload.buyer_name,'${data.buyer_name}');
  assert.deepEqual(flowFieldNames(compiled),['buyer_name','interests']);
  assert.throws(()=>compileFlowDesign({...design,screens:[design.screens[0],design.screens[0]]}),{code:'FLOW_DESIGN_INVALID'});
  assert.throws(()=>compileFlowDesign({...design,screens:[design.screens[0],{...design.screens[1],fields:[design.screens[0].fields[0]]}]}),{code:'FLOW_DESIGN_INVALID'});
});
test('Flow mappings cannot change identity or consent and reject ambiguous destinations',()=>{
  assert.deepEqual(validateFlowMapping([{field:'email',target:'attribute',key:'email',mode:'fill'}],['email']),[{field:'email',target:'attribute',key:'email',mode:'fill'}]);
  for(const mapping of [[{field:'email',target:'marketing_permission',mode:'replace'}],[{field:'missing',target:'name',mode:'fill'}],[{field:'email',target:'attribute',key:'constructor',mode:'fill'}],[{field:'email',target:'name',mode:'fill'},{field:'email',target:'name',mode:'replace'}]])assert.throws(()=>validateFlowMapping(mapping,['email']),{code:'FLOW_MAPPING_INVALID'});
  assert.equal(parseFlowReply('invalid'),null);assert.equal(parseFlowReply(JSON.stringify({flow_token:'short'})),null);assert.equal(parseFlowReply('x'.repeat(33000)),null);
});
test('product carousel creation and sends use catalog product headers, not media placeholders',()=>{
  const components=advancedTemplateComponents({kind:'PRODUCT_CAROUSEL',cards:[{buttonText:'View item'},{buttonText:'View item'}]},'Our products','MARKETING');
  assert.equal(components[1].cards[0].components[0].format,'PRODUCT');
  const schema={components,headerFormat:'NONE'};
  const parameters={carousel:[{variables:[],header:{type:'product',catalogId:'123',retailerId:'sku_a'}},{variables:[],header:{type:'product',catalogId:'123',retailerId:'sku_b'}}]};
  validateTemplateParameters({component_schema:schema},parameters);
  assert.deepEqual(templateSendComponents([],parameters)[0].cards[0].components[0].parameters[0],{type:'product',product:{catalog_id:'123',product_retailer_id:'sku_a'}});
  assert.throws(()=>validateTemplateParameters({component_schema:schema},{carousel:[{variables:[],header:{type:'image',link:'https://example.test/image'}},parameters.carousel[1]]}),{code:'TEMPLATE_HEADER_REQUIRED'});
});
test('product carousel dispatch verifies the WABA catalog before any message send',async()=>{
  const originalFetch=globalThis.fetch,previous=process.env.ENCRYPTION_KEY;process.env.ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');
  let allowed=false,writes=0;
  globalThis.fetch=async url=>{
    if(String(url).includes('/product_catalogs'))return Response.json({data:[{id:allowed?'123':'999'}]});
    if(String(url).includes('/products?'))return Response.json({data:[{retailer_id:'sku_a'},{retailer_id:'sku_b'}]});
    writes++;return Response.json({messages:[{id:'wamid_verified'}]});
  };
  try{
    const args={setup:{phone_number_id:'456',waba_id:'789',access_token_encrypted:encryptSecret('fixture-token')},to:'15550001111',templateName:'catalog',language:'en',parameters:{carousel:[{variables:[],header:{type:'product',catalogId:'123',retailerId:'sku_a'}},{variables:[],header:{type:'product',catalogId:'123',retailerId:'sku_b'}}]}};
    await assert.rejects(sendTemplateMessage(args),{code:'CAROUSEL_CATALOG_DENIED'});assert.equal(writes,0);
    allowed=true;assert.equal((await sendTemplateMessage(args)).metaMessageId,'wamid_verified');assert.equal(writes,1);
  }finally{globalThis.fetch=originalFetch;if(previous===undefined)delete process.env.ENCRYPTION_KEY;else process.env.ENCRYPTION_KEY=previous;}
});
