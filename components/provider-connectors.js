'use client';
import {useEffect,useState} from 'react';
import {Plus,RefreshCcw,Copy,KeyRound,Download,Save} from 'lucide-react';
import './whatsapp-modules.css';

export default function ProviderConnectors({ api, postJson, canEdit = true }) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [name,setName]=useState(''),[provider,setProvider]=useState('shopify'),[source,setSource]=useState(''),[secret,setSecret]=useState(''),[flowId,setFlowId]=useState('');
  const load=async()=>setData(await api('/api/connectors'));
  useEffect(()=>{let active=true;api('/api/connectors').then(value=>{if(active)setData(value);}).catch(cause=>{if(active)setError(cause.message);});return()=>{active=false;};},[api]);
  async function run(task){setBusy(true);setError('');try{await task();await load();}catch(cause){setError(cause.message);}finally{setBusy(false);}}
  const endpoint=connector=>typeof window==='undefined'?'':window.location.origin+'/api/connectors/events/'+connector.id;
  return <section className="wa-module"><header className="wa-module-heading"><h2>Provider connectors</h2><button type="button" title="Refresh connectors" aria-label="Refresh connectors" disabled={busy} onClick={()=>run(load)}><RefreshCcw size={18}/></button></header>
    {error&&<p role="alert" className="wa-module-error">{error}</p>}
    {canEdit && <form onSubmit={event=>{event.preventDefault();run(async()=>{await postJson('/api/connectors',{action:'create',name,provider,source,secret,flowId});setName('');setSource('');setSecret('');setFlowId('');});}}>
      <div className="wa-module-controls"><label>Name<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label>
        <label>Provider<select value={provider} onChange={event=>{setProvider(event.target.value);setSource('');}}><option value="shopify">Shopify</option><option value="woocommerce">WooCommerce</option></select></label>
        <label>{provider==='shopify'?'Shop hostname':'Store HTTPS URL'}<input required maxLength={1000} type={provider==='shopify'?'text':'url'} value={source} onChange={event=>setSource(event.target.value)}/></label>
        <label>Webhook signing secret<input required type="password" autoComplete="new-password" minLength={16} maxLength={512} value={secret} onChange={event=>setSecret(event.target.value)}/></label>
        <label>Order confirmation workflow<select value={flowId} onChange={event=>setFlowId(event.target.value)}><option value="">Store events only</option>{data?.flows.map(flow=><option key={flow.id} value={flow.id}>{flow.name}</option>)}</select></label>
        <button disabled={busy}><Plus size={16}/>Add connector</button></div>
    </form>}
    {!canEdit && <p className="wa-module-note">Connector changes are limited to the workspace owner. Managers can review status and delivery URLs.</p>}
    {!data&&!error&&<p role="status">Loading connectors...</p>}
    {data&&!data.connectors.length&&<p>No connectors configured.</p>}
    <div className="wa-module-table"><table><thead><tr><th>Name</th><th>Provider</th><th>Source</th><th>Delivery URL</th><th>Status</th><th>Checkout recovery</th><th>Credentials</th></tr></thead><tbody>{data?.connectors.map(connector=><tr key={connector.id}>
      <td>{connector.name}</td><td>{connector.provider}</td><td style={{overflowWrap:'anywhere'}}>{connector.source}</td>
      <td><input readOnly aria-label={'Delivery URL for '+connector.name} value={endpoint(connector)}/><button type="button" title="Copy delivery URL" aria-label="Copy delivery URL" onClick={()=>navigator.clipboard.writeText(endpoint(connector)).catch(cause=>setError(cause.message))}><Copy size={16}/></button></td>
      <td><label><input type="checkbox" checked={connector.enabled} disabled={busy||!canEdit||connector.oauth_managed} onChange={event=>run(()=>postJson('/api/connectors',{action:'toggle',id:connector.id,enabled:event.target.checked}))}/>Enabled{connector.oauth_managed?' (managed by OAuth)':''}</label></td>
      <td>{connector.provider==='shopify'?<RecoverySettings connector={connector} flows={data.flows} disabled={busy||!canEdit} onSave={settings=>run(()=>postJson('/api/connectors',{action:'recovery_settings',id:connector.id,...settings}))}/>:null}</td>
      <td>{connector.oauth_managed?'Managed by Shopify OAuth':canEdit ? <RotateCredential disabled={busy} onSave={value=>run(()=>postJson('/api/connectors',{action:'rotate',id:connector.id,secret:value}))}/> : '—'}</td>
    </tr>)}</tbody></table></div>
    <h3>Checkout recovery</h3>
    <div className="wa-module-table"><table><thead><tr><th>Store</th><th>Checkout</th><th>Customer phone</th><th>Value</th><th>Last update</th><th>Status</th><th>Action</th></tr></thead><tbody>{data?.recoveryCandidates?.map(candidate=><tr key={candidate.connector_id+':'+candidate.external_id}><td>{data.connectors.find(item=>item.id===candidate.connector_id)?.name||candidate.connector_id}</td><td>{candidate.external_id}</td><td>{candidate.data.phone||'Unavailable'}</td><td>{candidate.data.amount} {candidate.data.currency}</td><td>{new Date(candidate.occurred_at).toLocaleString()}</td><td>{candidate.recovery_reason||candidate.session_status||candidate.recovery_status}</td><td>{candidate.recovery_status==='skipped'&&<button type="button" disabled={busy} onClick={()=>run(()=>postJson('/api/connectors',{action:'retry_recovery',id:candidate.connector_id,checkoutId:candidate.external_id}))}>Retry</button>}</td></tr>)}</tbody></table></div>
    {data?.recoveryCandidates?.length===0&&<p>No open checkouts are due for review.</p>}
    <a href="/api/connectors/calendar"><Download size={16}/>Order calendar (.ics)</a>
    <h3>Recent provider events</h3><div className="wa-module-table"><table><thead><tr><th>Connector</th><th>Event</th><th>Status</th><th>Result</th><th>Received</th></tr></thead><tbody>{data?.events.map(event=><tr key={event.id}><td>{data.connectors.find(connector=>connector.id===event.connector_id)?.name||event.connector_id}</td><td>{event.topic}</td><td>{event.status}</td><td>{event.error_code||event.session_id||''}</td><td>{new Date(event.received_at).toLocaleString()}</td></tr>)}</tbody></table></div>
  </section>;
}

function RecoverySettings({connector,flows,disabled,onSave}){
  const [minutes,setMinutes]=useState(connector.recovery_after_minutes);
  const [enabled,setEnabled]=useState(connector.recovery_enabled),[flowId,setFlowId]=useState(connector.recovery_flow_id||'');
  useEffect(()=>{setMinutes(connector.recovery_after_minutes);setEnabled(connector.recovery_enabled);setFlowId(connector.recovery_flow_id||'');},[connector.recovery_after_minutes,connector.recovery_enabled,connector.recovery_flow_id]);
  return <form onSubmit={event=>{event.preventDefault();onSave({minutes:Number(minutes),enabled,flowId});}}>
    <label><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/>Send recovery</label>
    <label>Approved marketing workflow<select aria-label={'Recovery workflow for '+connector.name} value={flowId} onChange={event=>setFlowId(event.target.value)} required={enabled}><option value="">Choose workflow</option>{flows.map(flow=><option key={flow.id} value={flow.id}>{flow.name}</option>)}</select></label>
    <label>Delay (minutes)<input aria-label={'Recovery delay for '+connector.name} type="number" min="15" max="10080" required value={minutes} onChange={event=>setMinutes(event.target.value)}/></label>
    <button disabled={disabled} title="Save checkout recovery" aria-label={'Save checkout recovery for '+connector.name}><Save size={16}/></button>
  </form>;
}

function RotateCredential({disabled,onSave}){
  const [value,setValue]=useState('');
  return <form onSubmit={event=>{event.preventDefault();onSave(value);setValue('');}}><input aria-label="Replacement signing secret" type="password" autoComplete="new-password" required minLength={16} maxLength={512} value={value} onChange={event=>setValue(event.target.value)}/><button disabled={disabled} title="Rotate signing secret" aria-label="Rotate signing secret"><KeyRound size={16}/></button></form>;
}
