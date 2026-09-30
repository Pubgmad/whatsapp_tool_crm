import test from 'node:test';
import assert from 'node:assert/strict';
import {advancedTemplateComponents} from '../lib/advanced-template-components.js';
import {validateTemplateParameters,templateSendComponents} from '../lib/template-send-components.js';
const card=()=>({format:'IMAGE',mediaHandle:'uploaded-handle',body:'Hello {{1}}',examples:['Buyer'],buttons:[{type:'URL',text:'Open',url:'https://example.com/product'}]});
test('carousel creation preserves card structure and explicit review examples',()=>{
  const components=advancedTemplateComponents({kind:'CAROUSEL',cards:[card(),card()]},'Browse products','MARKETING');
  assert.equal(components[1].cards.length,2);
  assert.equal(components[1].cards[0].components[0].format,'IMAGE');
  assert.throws(()=>advancedTemplateComponents({kind:'CAROUSEL',cards:[card()]},'Browse','MARKETING'));
  assert.throws(()=>advancedTemplateComponents({kind:'CAROUSEL',cards:[card(),{...card(),format:'VIDEO'}]},'Browse','MARKETING'));
  assert.throws(()=>advancedTemplateComponents({kind:'CAROUSEL',cards:[card(),card()]},'Browse','AUTHENTICATION'));
});
test('carousel sends match approved headers, variables and card counts',()=>{
  const components=advancedTemplateComponents({kind:'CAROUSEL',cards:[card(),card()]},'Browse','MARKETING');
  const template={component_schema:{components}};
  const input={carousel:[{header:{type:'image',id:'123'},variables:['Customer']},{header:{type:'image',id:'456'},variables:['Customer']}]};
  assert.doesNotThrow(()=>validateTemplateParameters(template,input));
  assert.equal(templateSendComponents([],input)[0].cards[1].card_index,1);
  assert.throws(()=>validateTemplateParameters(template,{carousel:input.carousel.slice(0,1)}));
  assert.throws(()=>validateTemplateParameters(template,{carousel:input.carousel.map(item=>({...item,header:{type:'video',id:'123'}}))}));
  assert.throws(()=>validateTemplateParameters(template,{carousel:input.carousel.map(item=>({...item,variables:[]}))}));
});
test('catalog templates require explicitly supplied button text',()=>{
  const result=advancedTemplateComponents({kind:'CATALOG',catalogButtonText:'Browse'},'Products','MARKETING');
  assert.equal(result[1].buttons[0].type,'CATALOG');
  assert.throws(()=>advancedTemplateComponents({kind:'CATALOG'},'Products','MARKETING'));
});
test('catalog thumbnail parameters are typed and restricted to catalog templates',()=>{
  const template={component_schema:{components:advancedTemplateComponents({kind:'CATALOG',catalogButtonText:'View catalog'},'Products','MARKETING')}};
  const input={catalog:{thumbnailRetailerId:'actual-sku'}};
  assert.doesNotThrow(()=>validateTemplateParameters(template,input));
  assert.equal(templateSendComponents([],input)[0].parameters[0].action.thumbnail_product_retailer_id,'actual-sku');
  assert.throws(()=>validateTemplateParameters({component_schema:{}},input));
  assert.throws(()=>templateSendComponents([],{catalog:{thumbnailRetailerId:''}}));
});
