'use client';
import {useEffect} from 'react';
import CatalogProductField from './catalog-product-field';

export default function TemplateParameterFields({ template, value, onChange }) {
  const cards=template?.componentSchema?.components?.find(component=>String(component.type).toUpperCase()==='CAROUSEL')?.cards||[];
  const updateCard=(index,change)=>{
    const current=cards.map((_,position)=>value.carousel?.[position]||{variables:[],buttons:[]});
    current[index]={...current[index],...change};onChange({...value,carousel:current});
  };
  const format = String(template?.componentSchema?.headerFormat || 'NONE').toLowerCase();
  const schema=template?.componentSchema||{};
  const originalButtons=schema.components?.find(component=>String(component.type).toUpperCase()==='BUTTONS')?.buttons;
  const flowButtons=originalButtons||schema.buttons||template?.buttons||[];
  const hasFlow=flowButtons.some(button=>String(button.type).toUpperCase()==='FLOW');
  useEffect(()=>{
    if(hasFlow&&!value.flowInvite)onChange({...value,flowInvite:{requestId:crypto.randomUUID(),expiresHours:24}});
  },[hasFlow,value,onChange]);
  const expiration=Number(value.limitedTimeOffer?.expirationTimeMs);
  const expirationDate=Number.isFinite(expiration)&&expiration>0?new Date(expiration):null;
  const expirationValue=expirationDate&&!Number.isNaN(expirationDate.getTime())?new Date(expiration-expirationDate.getTimezoneOffset()*60000).toISOString().slice(0,16):'';
  const buttons = schema.buttons?.length?schema.buttons:schema.components?.find(component=>String(component.type).toUpperCase()==='BUTTONS')?.buttons||template?.buttons||[];
  const updateButton = (index, type, text) => {
    const remaining = (value.buttons || []).filter((button) => button.index !== index);
    onChange({ ...value, buttons: text ? [...remaining, { index, type, value: text }] : remaining });
  };
  return <>
    {hasFlow&&<label>Flow response expiry (hours)<input required type="number" min={1} max={168} value={value.flowInvite?.expiresHours??24} onChange={event=>onChange({...value,flowInvite:{...value.flowInvite,requestId:value.flowInvite?.requestId||crypto.randomUUID(),expiresHours:event.target.value===''?'':Number(event.target.value)}})}/></label>}
    {format==='product'&&<CatalogProductField value={value.header||{}} onChange={header=>onChange({...value,header})}/>}
    {schema.components?.some(component=>String(component.type).toUpperCase()==='LIMITED_TIME_OFFER'&&component.limited_time_offer?.has_expiration)&&<label>Offer expiration<input required type="datetime-local" value={expirationValue} onChange={event=>{const next={...value};const timestamp=new Date(event.target.value).getTime();if(Number.isFinite(timestamp))next.limitedTimeOffer={expirationTimeMs:timestamp};else delete next.limitedTimeOffer;onChange(next);}}/></label>}
    {buttons.some(button=>String(button.type).toUpperCase()==='CATALOG')||template?.componentSchema?.components?.some(component=>String(component.type).toUpperCase()==='BUTTONS'&&component.buttons?.some(button=>String(button.type).toUpperCase()==='CATALOG'))?<label>Catalog thumbnail retailer ID<input maxLength={256} value={value.catalog?.thumbnailRetailerId||''} onChange={event=>{const next={...value};if(event.target.value)next.catalog={thumbnailRetailerId:event.target.value};else delete next.catalog;onChange(next);}}/></label>:null}
    {cards.map((card,index)=>{
      const find=type=>(card.components||[]).find(component=>String(component.type).toUpperCase()===type)||{};
      const body=find('BODY').text||'',count=new Set([...body.matchAll(/{{\s*(\d+)\s*}}/g)].map(match=>match[1])).size;
      const current=value.carousel?.[index]||{variables:[]};
      return <fieldset key={index}><legend>Card {index+1}</legend>
        <TemplateParameterFields template={{componentSchema:{headerFormat:find('HEADER').format,buttons:find('BUTTONS').buttons}}} value={current} onChange={change=>updateCard(index,change)}/>
        {Array.from({length:count},(_,slot)=><label key={slot}>Card variable {slot+1}<input required value={current.variables?.[slot]||''} onChange={event=>{const variables=Array.from({length:count},(_,position)=>current.variables?.[position]||'');variables[slot]=event.target.value;updateCard(index,{variables});}}/></label>)}
      </fieldset>;
    })}
    {['image', 'video', 'document'].includes(format) && <label>{format === 'document' ? 'Document URL' : format === 'video' ? 'Video URL' : 'Image URL'}<input type='url' required value={value.header?.link || ''} onChange={(event) => onChange({ ...value, header: { type: format, link: event.target.value } })} /></label>}
    {buttons.map((button, index) => {
      const type = String(button.type || '').toLowerCase();
      if (type !== 'copy_code' && !(type === 'url' && /{{\s*\d+\s*}}/.test(button.value || button.url || ''))) return null;
      return <label key={index}>{button.text || `Button ${index + 1}`}<input required value={(value.buttons || []).find((item) => item.index === index)?.value || ''} onChange={(event) => updateButton(index, type, event.target.value)} /></label>;
    })}
  </>;
}
