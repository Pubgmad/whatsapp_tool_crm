'use client';
import {useEffect,useState} from 'react';
import {Save,RefreshCcw} from 'lucide-react';
export default function AutomationConnections({api,postJson,role}){
 const [connections,setConnections]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){const result=await api('/api/automation/connections');setConnections(result.connections||[]);}
 useEffect(()=>{let active=true;api('/api/automation/connections').then(result=>{if(active)setConnections(result.connections||[]);}).catch(cause=>{if(active)setError(cause.message);});return()=>{active=false;};},[api]);
 async function run(task){setBusy(true);setError('');try{await task();await load();}catch(cause){setError(cause.message);}finally{setBusy(false);}}
 const save=event=>{event.preventDefault();const form=event.currentTarget,values=new FormData(form);run(async()=>{await postJson('/api/automation/connections',{action:'create',name:values.get('name'),url:values.get('url'),method:values.get('method'),token:values.get('token')});form.reset();});};
 return <section className="wa-module"><header className="wa-module-heading"><h3>Automation API connections</h3><button type="button" title="Refresh connections" aria-label="Refresh connections" disabled={busy} onClick={()=>run(load)}><RefreshCcw size={17}/></button></header>
 {error&&<p role="alert">{error}</p>}{role==='Owner'&&<form onSubmit={save}><fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}><div className="wa-ad-grid"><label>Name<input name="name" required maxLength={120}/></label><label>HTTPS URL<input name="url" required type="url" maxLength={2000}/></label><label>Method<select name="method"><option value="GET">GET</option><option value="POST">POST</option></select></label><label>Bearer token<input name="token" required type="password" autoComplete="new-password"/></label></div><button><Save size={16}/>Save connection</button></fieldset></form>}
 <div className="wa-module-table"><table><thead><tr><th>Name</th><th>Method</th><th>Destination</th><th>Status</th></tr></thead><tbody>{connections.map(item=><tr key={item.id}><td>{item.name}</td><td>{item.method}</td><td style={{overflowWrap:'anywhere'}}>{item.url}</td><td><label className="checkRow"><input type="checkbox" checked={item.enabled} disabled={busy||role!=='Owner'} onChange={event=>run(()=>postJson('/api/automation/connections',{action:'toggle',id:item.id,enabled:event.target.checked}))}/>Enabled</label></td></tr>)}</tbody></table></div>{!connections.length&&<p>No API connections configured.</p>}
 </section>;
}
