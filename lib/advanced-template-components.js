import {AppError} from './db.js';
import {flowCreationButton} from './flow-template-components.js';
const fail=()=>{throw new AppError('Invalid advanced template components.',400,'ADVANCED_TEMPLATE_INVALID');};
const clean=value=>String(value||'').trim();
export function variableCount(text){
  const matches=[...String(text||'').matchAll(/{{\s*(\d+)\s*}}/g)].map(match=>Number(match[1]));
  const unique=[...new Set(matches)].sort((a,b)=>a-b);
  if(unique.some((value,index)=>value!==index+1)||/{{[^}]*[A-Za-z][^}]*}}/.test(text||''))fail();
  return unique.length;
}
function bodyComponent(text,examples,max=1024){
  text=clean(text);if(!text||text.length>max)fail();
  const count=variableCount(text);
  if(count&&(!Array.isArray(examples)||examples.length!==count||examples.some(value=>!clean(value)||clean(value).length>1024)))fail();
  return {type:'BODY',text,...(count?{example:{body_text:[examples.map(clean)]}}:{})};
}
export function advancedTemplateComponents(schema,body,category){
  if(schema?.kind==='FLOW'){
    if(!['MARKETING','UTILITY'].includes(category))fail();
    return [bodyComponent(body,schema.bodyExamples),{type:'BUTTONS',buttons:[flowCreationButton(schema)]}];
  }
  if(!['CAROUSEL','PRODUCT_CAROUSEL','CATALOG','COUPON','LIMITED_TIME_OFFER'].includes(schema.kind)||category!=='MARKETING')fail();
  const components=[bodyComponent(body,schema.bodyExamples)];
  if(['COUPON','LIMITED_TIME_OFFER'].includes(schema.kind)){
    const example=clean(schema.couponExample);
    if(!example||example.length>15)fail();
    const buttons=[{type:'COPY_CODE',example}];
    if(schema.offerUrl){
      const text=clean(schema.offerButtonText),url=clean(schema.offerUrl);
      let parsed;try{parsed=new URL(url.replace('{{1}}','example'));}catch{fail();}
      if(!text||text.length>25||parsed.protocol!=='https:'||parsed.username||parsed.password||url.length>2000)fail();
      const count=variableCount(url);if(count>1||(count===1&&!url.endsWith('{{1}}')))fail();
      const button={type:'URL',text,url};
      if(count){let exampleUrl;try{exampleUrl=new URL(schema.offerUrlExample);}catch{fail();}if(exampleUrl.protocol!=='https:'||exampleUrl.username||exampleUrl.password||exampleUrl.origin!==parsed.origin||exampleUrl.href.length>2000)fail();button.example=[exampleUrl.href];}
      buttons.push(button);
    }
    const header=[];
    if(schema.headerFormat&&schema.headerFormat!=='NONE'){
      if(!['IMAGE','VIDEO'].includes(schema.headerFormat)||!clean(schema.headerMediaHandle)||schema.headerMediaHandle.length>4096)fail();
      header.push({type:'HEADER',format:schema.headerFormat,example:{header_handle:[schema.headerMediaHandle]}});
    }
    if(schema.kind==='LIMITED_TIME_OFFER'){
      if(!clean(schema.offerText)||schema.offerText.length>16||typeof schema.hasExpiration!=='boolean'||body.length>600)fail();
      return [...header,{type:'LIMITED_TIME_OFFER',limited_time_offer:{text:schema.offerText.trim(),has_expiration:schema.hasExpiration}},...components,{type:'BUTTONS',buttons}];
    }
    return [...header,...components,{type:'BUTTONS',buttons}];
  }
  if(schema.kind==='CATALOG'){
    if(!clean(schema.catalogButtonText)||clean(schema.catalogButtonText).length>25)fail();
    return [...components,{type:'BUTTONS',buttons:[{type:'CATALOG',text:clean(schema.catalogButtonText)}]}];
  }
  if(!Array.isArray(schema.cards)||schema.cards.length<2||schema.cards.length>10)fail();
  if(schema.kind==='PRODUCT_CAROUSEL'){
    const cards=schema.cards.map(card=>{
      if(!card||!clean(card.buttonText)||clean(card.buttonText).length>25)fail();
      return {components:[{type:'HEADER',format:'PRODUCT'},{type:'BUTTONS',buttons:[{type:'SPM',text:clean(card.buttonText)}]}]};
    });
    return [...components,{type:'CAROUSEL',cards}];
  }
  let shape='';
  const cards=schema.cards.map(card=>{
    const format=clean(card.format).toUpperCase();
    if(!['IMAGE','VIDEO'].includes(format)||!clean(card.mediaHandle)||clean(card.mediaHandle).length>4096||!Array.isArray(card.buttons)||card.buttons.length<1||card.buttons.length>2)fail();
    const buttons=card.buttons.map(button=>{
      const type=clean(button.type).toUpperCase(),text=clean(button.text);
      if(!text||text.length>25||!['URL','QUICK_REPLY'].includes(type))fail();
      if(type==='QUICK_REPLY')return {type,text};
      let url;try{url=new URL(button.url);}catch{fail();}
      if(url.protocol!=='https:'||url.username||url.password||String(button.url).length>2000)fail();
      if(/{{/.test(button.url)&&(!String(button.url).endsWith('{{1}}')||String(button.url).split('{{').length!==2))fail();
      if(String(button.url).includes('{{1}}')){let example;try{example=new URL(button.example);}catch{fail();}if(example.protocol!=='https:'||example.username||example.password||example.href.length>2000||example.origin!==url.origin)fail();}
      return {type,text,url:String(button.url),...(String(button.url).includes('{{1}}')?{example:[clean(button.example)||fail()]}:{})};
    });
    const nextShape=JSON.stringify([format,buttons.map(button=>button.type)]);
    if(shape&&shape!==nextShape)fail();shape=nextShape;
    return {components:[{type:'HEADER',format,example:{header_handle:[clean(card.mediaHandle)]}},bodyComponent(card.body,card.examples,160),{type:'BUTTONS',buttons}]};
  });
  return [...components,{type:'CAROUSEL',cards}];
}
export function carouselCardSchema(card){
  const find=type=>(card.components||[]).find(component=>String(component.type).toUpperCase()===type)||{};
  return {headerFormat:find('HEADER').format,body:find('BODY').text||'',buttons:find('BUTTONS').buttons||[]};
}
