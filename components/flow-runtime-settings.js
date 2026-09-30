'use client';
import {useEffect,useState} from 'react';
import {RefreshCcw,Save} from 'lucide-react';

const actions=['list','reserve','confirm','cancel'];
const emptyResource={kind:'slot',title:'',capacity:1,enabled:true,startsAt:'',endsAt:'',catalogId:'',retailerId:'',unitPrice:'0',currency:''};
const emptyConfig={enabled:false,mode:'booking',resourceIds:[],initialScreen:'',reviewScreen:'',allowedActions:['list'],holdMinutes:10};
function localInput(value){
  if(!value)return '';
  const date=new Date(value);
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}

export default function FlowRuntimeSettings({flow,api,postJson}){
  const [settings,setSettings]=useState(null),[config,setConfig]=useState(emptyConfig),[resource,setResource]=useState(emptyResource),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function load(){
    const result=await api('/api/whatsapp/flows/runtime?flowId='+encodeURIComponent(flow.id));
    setSettings(result);setConfig(result.config||emptyConfig);
  }
  useEffect(()=>{let active=true;api('/api/whatsapp/flows/runtime?flowId='+encodeURIComponent(flow.id)).then(result=>{if(active){setSettings(result);setConfig(result.config||emptyConfig);}}).catch(cause=>{if(active)setError(cause.message);});return()=>{active=false;};},[api,flow.id]);
  async function run(task){setBusy(true);setError('');setNotice('');try{await task();await load();setNotice('Saved.');}catch(cause){setError(cause.message);}finally{setBusy(false);}}
  const resources=settings?.resources.filter(item=>item.kind===(config.mode==='order'?'product':'slot'))||[];
  const field=(label,key,props={})=><label>{label}<input required value={resource[key]} onChange={event=>setResource({...resource,[key]:event.target.value})} {...props}/></label>;
  return <details><summary>Transactional Flow runtime</summary>
    {error&&<p role="alert" className="wa-module-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!flow.managedEndpoint&&<p role="status">Configure this Flow's managed encrypted Data API endpoint before enabling booking or order actions.</p>}
    <form onSubmit={event=>{event.preventDefault();run(async()=>{
      const payload={...resource,capacity:Number(resource.capacity),...(resource.kind==='slot'?{startsAt:new Date(resource.startsAt).toISOString(),endsAt:new Date(resource.endsAt).toISOString(),catalogId:'',retailerId:''}:{startsAt:'',endsAt:''})};
      await postJson('/api/whatsapp/flows/runtime',{action:'resource',resource:payload});
      setResource(emptyResource);
    });}}>
      <h3>Inventory or booking slot</h3>
      <div className="wa-ad-grid">
        <label>Resource type<select value={resource.kind} onChange={event=>setResource({...emptyResource,kind:event.target.value})}><option value="slot">Booking slot</option><option value="product">Catalog product</option></select></label>
        {field('Title','title',{maxLength:80})}
        {field('Capacity','capacity',{type:'number',min:0,max:1000000})}
        {field('Unit price','unitPrice',{inputMode:'decimal',pattern:'[0-9]+(\\.[0-9]{1,6})?'})}
        {field('Currency','currency',{maxLength:3,pattern:'[A-Z]{3}'})}
        {resource.kind==='slot'?<>{field('Starts at','startsAt',{type:'datetime-local'})}{field('Ends at','endsAt',{type:'datetime-local'})}</>:<>{field('Meta catalog ID','catalogId',{pattern:'[0-9]{1,32}'})}{field('Meta retailer ID','retailerId',{maxLength:256})}</>}
        <label><input type="checkbox" checked={resource.enabled} onChange={event=>setResource({...resource,enabled:event.target.checked})}/>Enabled</label>
      </div>
      <button disabled={busy}><Save size={16}/>Save resource</button>
    </form>
    {settings&&<><h3>Resources</h3><div className="wa-module-table"><table><thead><tr><th>Title</th><th>Type</th><th>Capacity</th><th>Status</th><th>Actions</th></tr></thead><tbody>{settings.resources.map(item=><tr key={item.id}><td>{item.title}</td><td>{item.kind}</td><td>{item.capacity}</td><td>{item.enabled?'Enabled':'Disabled'}</td><td><button type="button" disabled={busy} onClick={()=>setResource({id:item.id,kind:item.kind,title:item.title,capacity:item.capacity,enabled:item.enabled,startsAt:localInput(item.starts_at),endsAt:localInput(item.ends_at),catalogId:item.catalog_id||'',retailerId:item.retailer_id||'',unitPrice:item.unit_price,currency:item.currency})}>Edit</button></td></tr>)}</tbody></table></div></>}
    <form onSubmit={event=>{event.preventDefault();run(()=>postJson('/api/whatsapp/flows/runtime',{action:'config',flowId:flow.id,config:{...config,holdMinutes:Number(config.holdMinutes)}}));}}>
      <h3>Runtime settings</h3><div className="wa-ad-grid">
        <label>Mode<select value={config.mode} onChange={event=>setConfig({...config,mode:event.target.value,resourceIds:[]})}><option value="booking">Booking</option><option value="order">Order</option></select></label>
        <label>Entry screen<select required value={config.initialScreen} onChange={event=>setConfig({...config,initialScreen:event.target.value})}><option value="">Select screen</option>{flow.screens.map(item=><option key={item} value={item}>{item}</option>)}</select></label>
        <label>Review screen<select required value={config.reviewScreen} onChange={event=>setConfig({...config,reviewScreen:event.target.value})}><option value="">Select screen</option>{flow.screens.map(item=><option key={item} value={item}>{item}</option>)}</select></label>
        <label>Reservation hold (minutes)<input required type="number" min={1} max={30} value={config.holdMinutes} onChange={event=>setConfig({...config,holdMinutes:event.target.value})}/></label>
      </div>
      <fieldset><legend>Available resources</legend>{resources.map(item=><label key={item.id}><input type="checkbox" checked={config.resourceIds.includes(item.id)} onChange={event=>setConfig({...config,resourceIds:event.target.checked?[...config.resourceIds,item.id]:config.resourceIds.filter(id=>id!==item.id)})}/>{item.title}</label>)}</fieldset>
      <fieldset><legend>Allowed actions</legend>{actions.map(action=><label key={action}><input type="checkbox" disabled={action==='list'} checked={config.allowedActions.includes(action)} onChange={event=>setConfig({...config,allowedActions:event.target.checked?[...config.allowedActions,action]:config.allowedActions.filter(value=>value!==action)})}/>{action}</label>)}</fieldset>
      <label><input type="checkbox" checked={config.enabled} onChange={event=>setConfig({...config,enabled:event.target.checked})}/>Enable live runtime</label>
      <div className="wa-module-controls"><button disabled={busy||!flow.managedEndpoint}><Save size={16}/>Save runtime</button><button type="button" title="Refresh runtime settings" aria-label="Refresh runtime settings" disabled={busy} onClick={()=>run(load)}><RefreshCcw size={16}/></button></div>
    </form>
    {!!settings?.reservations.length&&<><h3>Recent reservations</h3><div className="wa-module-table"><table><thead><tr><th>Resource</th><th>Quantity</th><th>Status</th><th>Expires</th></tr></thead><tbody>{settings.reservations.map(item=><tr key={item.id}><td>{item.resource_id}</td><td>{item.quantity}</td><td>{item.status}</td><td>{new Date(item.expires_at).toLocaleString()}</td></tr>)}</tbody></table></div></>}
  </details>;
}
