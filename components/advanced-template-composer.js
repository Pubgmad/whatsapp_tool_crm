'use client';
import {useEffect,useState} from 'react';
import {Plus,Trash2,Send} from 'lucide-react';
import './whatsapp-modules.css';
const emptyCard=()=>({id:crypto.randomUUID(),format:'IMAGE',mediaHandle:'',body:'',buttons:[{type:'URL',text:'',url:'',example:''}]});
const slots=text=>[...new Set([...String(text||'').matchAll(/{{\s*(\d+)\s*}}/g)].map(match=>match[1]))].sort((a,b)=>Number(a)-Number(b));
export default function AdvancedTemplateComposer({postJson,onCreated,api,accountId}){
  const [kind,setKind]=useState('CAROUSEL'),[cards,setCards]=useState([]),[body,setBody]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
  const [flows,setFlows]=useState([]),[flowId,setFlowId]=useState(''),[flowScreen,setFlowScreen]=useState(''),[flowAction,setFlowAction]=useState('navigate'),[flowLoading,setFlowLoading]=useState(false),[flowError,setFlowError]=useState('');
  const selectedFlow=flows.find(flow=>flow.id===flowId);
  useEffect(()=>{
    if(kind!=='FLOW')return;
    let active=true;setFlowLoading(true);setFlowError('');
    const load=api?api('/api/whatsapp/flow-templates'):fetch('/api/whatsapp/flow-templates',{credentials:'same-origin',cache:'no-store'}).then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to load Flows.');return result;});
    load.then(result=>{if(active)setFlows(result.flows||[]);}).catch(cause=>{if(active)setFlowError(cause.message);}).finally(()=>{if(active)setFlowLoading(false);});
    return()=>{active=false;};
  },[kind,api]);
  const update=(index,key,value)=>setCards(current=>current.map((card,position)=>position===index?{...card,[key]:value}:card));
  async function submit(event){
    event.preventDefault();const form=event.currentTarget,values=new FormData(form);setPending(true);setError('');
    try{
      if(kind==='FLOW'){
        if(!selectedFlow)throw new Error('Select a published Flow.');
        await postJson('/api/whatsapp/flow-templates',{action:'create',name:values.get('name'),language:values.get('language'),category:values.get('flowCategory'),body,flowId,flowAction,flowScreen:flowAction==='navigate'?flowScreen:undefined,flowButtonText:values.get('flowButtonText'),bodyExamples:slots(body).map(slot=>values.get('body_example_'+slot))});
        setBody('');form.reset();await onCreated();return;
      }
      await postJson('/api/templates',{accountId,name:values.get('name'),language:values.get('language'),category:'MARKETING',kind,body,catalogButtonText:values.get('catalogButtonText'),couponExample:values.get('couponExample'),offerText:values.get('offerText'),hasExpiration:values.get('hasExpiration')==='on',offerUrl:values.get('offerUrl'),offerButtonText:values.get('offerButtonText'),offerUrlExample:values.get('offerUrlExample'),bodyExamples:slots(body).map(slot=>values.get('body_example_'+slot)),cards:cards.map(card=>({...card,examples:slots(card.body).map(slot=>values.get(card.id+'_example_'+slot))})),submitToMeta:true});
      setCards([]);setBody('');form.reset();await onCreated();
    }catch(cause){setError(cause.message);}finally{setPending(false);}
  }
  return <section className="advancedTemplateComposer wa-module"><h2>Advanced templates</h2>
    <form className="formGrid" onSubmit={submit}>
      <label>Format<select value={kind} onChange={event=>setKind(event.target.value)}><option value="CAROUSEL">Media carousel</option><option value="PRODUCT_CAROUSEL">Product-card carousel</option><option value="CATALOG">Catalog</option><option value="COUPON">Coupon code</option><option value="LIMITED_TIME_OFFER">Limited-time offer</option><option value="FLOW">WhatsApp Flow</option></select></label>
      <label>Name<input name="name" pattern="[a-z0-9_]+" maxLength={512} required/></label>
      <label>Language code<input name="language" pattern="[a-z]{2,3}(_[A-Z]{2})?" required/></label>
      <label>Message body<textarea required maxLength={1024} value={body} onChange={event=>setBody(event.target.value)}/></label>
      {slots(body).map(slot=><label key={slot}>Example for variable {slot}<input name={'body_example_'+slot} required/></label>)}
      {kind==='FLOW'?<>
        <label>Category<select name="flowCategory"><option value="MARKETING">Marketing</option><option value="UTILITY">Utility</option></select></label>
        <label>Published Flow<select required disabled={flowLoading} value={flowId} onChange={event=>{const flow=flows.find(item=>item.id===event.target.value);setFlowId(event.target.value);setFlowScreen(flow?.screens[0]?.id||'');setFlowAction('navigate');}}><option value="">{flowLoading?'Loading Flows':flows.length?'Select Flow':'No published Flows'}</option>{flows.map(flow=><option key={flow.id} value={flow.id}>{flow.name}</option>)}</select></label>
        <label>Launch action<select value={flowAction} onChange={event=>setFlowAction(event.target.value)}><option value="navigate">Open screen</option>{selectedFlow?.hasEndpoint&&<option value="data_exchange">Data exchange</option>}</select></label>
        {flowAction==='navigate'&&<label>Entry screen<select required value={flowScreen} onChange={event=>setFlowScreen(event.target.value)}><option value="">Select screen</option>{selectedFlow?.screens.map(screen=><option key={screen.id} value={screen.id}>{screen.title||screen.id}</option>)}</select></label>}
        <label>Flow button text<input name="flowButtonText" required maxLength={25}/></label>
        {flowError&&<div className="formError" role="alert">{flowError}</div>}
      </>:kind==="PRODUCT_CAROUSEL"?<>{cards.map((card,index)=><fieldset key={card.id}><legend>Product card {index+1}</legend><label>Product button label<input required maxLength={25} value={card.buttonText||""} onChange={event=>update(index,"buttonText",event.target.value)}/></label><button type="button" title="Remove product card" aria-label="Remove product card" onClick={()=>setCards(current=>current.filter(item=>item.id!==card.id))}><Trash2 size={16}/></button></fieldset>)}<button type="button" disabled={cards.length>=10} onClick={()=>setCards(current=>[...current,{id:crypto.randomUUID(),buttonText:""}])}><Plus size={16}/>Add product card</button></>:['COUPON','LIMITED_TIME_OFFER'].includes(kind)?<><label>Coupon example<input name="couponExample" required maxLength={15}/></label>{kind==='LIMITED_TIME_OFFER'&&<><label>Offer label<input name="offerText" required maxLength={16}/></label><label><input name="hasExpiration" type="checkbox"/>Expiration countdown</label></>}<label>Offer URL<input name="offerUrl" type="url" maxLength={2000}/></label><label>URL button text<input name="offerButtonText" maxLength={25}/></label><label>Dynamic URL example<input name="offerUrlExample" type="url" maxLength={2000}/></label></>:kind==='CATALOG'?<label>Catalog button text<input name="catalogButtonText" required maxLength={25}/></label>:<>
        {cards.map((card,index)=><fieldset key={card.id}><legend>Card {index+1}</legend>
          <label>Media format<select value={card.format} onChange={event=>update(index,'format',event.target.value)}><option value="IMAGE">Image</option><option value="VIDEO">Video</option></select></label>
          <label>Meta uploaded media handle<input required value={card.mediaHandle} onChange={event=>update(index,'mediaHandle',event.target.value)}/></label>
          <label>Card body<textarea required maxLength={160} value={card.body} onChange={event=>update(index,'body',event.target.value)}/></label>
          {slots(card.body).map(slot=><label key={slot}>Example for card variable {slot}<input name={card.id+'_example_'+slot} required/></label>)}
          {card.buttons.map((button,position)=><div className="formSplit" key={position}>
            <label>Button type<select value={button.type} onChange={event=>update(index,'buttons',card.buttons.map((item,slot)=>slot===position?{...item,type:event.target.value}:item))}><option value="URL">Website</option><option value="QUICK_REPLY">Quick reply</option></select></label>
            <label>Button text<input maxLength={25} required value={button.text} onChange={event=>update(index,'buttons',card.buttons.map((item,slot)=>slot===position?{...item,text:event.target.value}:item))}/></label>
            {button.type==='URL'&&<><label>URL<input type="url" required value={button.url} onChange={event=>update(index,'buttons',card.buttons.map((item,slot)=>slot===position?{...item,url:event.target.value}:item))}/></label>{button.url.includes('{{1}}')&&<label>Example URL<input type="url" required value={button.example} onChange={event=>update(index,'buttons',card.buttons.map((item,slot)=>slot===position?{...item,example:event.target.value}:item))}/></label>}</>}
            {card.buttons.length>1&&<button className="iconButton" type="button" title="Remove button" aria-label="Remove button" onClick={()=>update(index,'buttons',card.buttons.filter((_,slot)=>slot!==position))}><Trash2 size={16}/></button>}
          </div>)}
          <div className="rowActions">{card.buttons.length<2&&<button className="secondaryAction" type="button" onClick={()=>update(index,'buttons',[...card.buttons,{type:'URL',text:'',url:'',example:''}])}><Plus size={16}/> Add button</button>}<button className="iconButton" type="button" title="Remove card" aria-label="Remove card" onClick={()=>setCards(current=>current.filter(item=>item.id!==card.id))}><Trash2 size={16}/></button></div>
        </fieldset>)}
        <button className="secondaryAction" type="button" disabled={cards.length>=10} onClick={()=>setCards(current=>[...current,emptyCard()])}><Plus size={16}/> Add card</button>
      </>}
      {error&&<div className="formError" role="alert">{error}</div>}
      <button className="primaryAction" type="submit" disabled={pending||(['CAROUSEL','PRODUCT_CAROUSEL'].includes(kind)&&cards.length<2)||(kind==='FLOW'&&(flowLoading||!selectedFlow||(flowAction==='navigate'&&!flowScreen)))}><Send size={16}/> Submit to Meta</button>
    </form>
  </section>;
}
