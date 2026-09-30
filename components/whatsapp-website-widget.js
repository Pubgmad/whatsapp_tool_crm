'use client';
import { useEffect,useRef,useState } from 'react';
import { Copy,Plus,Save,Trash2,Pencil } from 'lucide-react';
export default function WhatsAppWebsiteWidget({phoneId,role,api,postJson}) {
  const [widgets,setWidgets]=useState([]),[editing,setEditing]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const phone=useRef(phoneId);phone.current=phoneId;
  async function load(){const result=await api('/api/whatsapp/widgets?phoneId='+encodeURIComponent(phoneId));if(phone.current===phoneId)setWidgets(result.widgets);}
  useEffect(()=>{let active=true;setWidgets([]);setEditing(null);setError('');api('/api/whatsapp/widgets?phoneId='+encodeURIComponent(phoneId)).then(result=>{if(active)setWidgets(result.widgets);}).catch(cause=>{if(active)setError(cause.message);});return()=>{active=false;};},[phoneId,api]);
  async function run(task){setBusy(true);setError('');try{await task();}catch(cause){setError(cause.message);}finally{setBusy(false);}}
  function save(event){event.preventDefault();const form=new FormData(event.currentTarget);run(async()=>{await postJson('/api/whatsapp/widgets',{action:'save',id:editing?.id,phoneId,label:form.get('label'),message:form.get('message'),origins:String(form.get('origins')).split(/\r?\n/).map(value=>value.trim()).filter(Boolean),position:form.get('position'),color:form.get('color'),enabled:form.get('enabled')==='on'});setEditing(null);await load();});}
  return <div className="wa-widget-settings"><header className="wa-module-heading"><h3>Website widgets</h3>{role==='Owner'&&<button type="button" title="New website widget" aria-label="New website widget" disabled={busy} onClick={()=>setEditing({})}><Plus size={18}/></button>}</header>
    {editing&&role==='Owner'&&<form key={editing.id||'new'} onSubmit={save}><fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}><div className="wa-ad-grid">
      <label>Button label<input name="label" required maxLength={40} defaultValue={editing.label||''}/></label>
      <label>Website origins<textarea name="origins" required defaultValue={(editing.origins||[]).join('\n')}/></label>
      <label>Prefilled message<textarea name="message" maxLength={512} defaultValue={editing.message||''}/></label>
      <label>Button color<input name="color" type="color" defaultValue={editing.color||'#168a63'}/></label>
      <label>Position<select name="position" defaultValue={editing.position||'right'}><option value="right">Bottom right</option><option value="left">Bottom left</option></select></label>
      <label className="checkRow"><input name="enabled" type="checkbox" defaultChecked={editing.enabled===true}/>Published</label>
    </div><div className="wa-module-controls"><button><Save size={16}/>Save</button><button type="button" onClick={()=>setEditing(null)}>Cancel</button></div></fieldset></form>}
    {error&&<p className="wa-module-error" role="alert">{error}</p>}<div className="wa-module-table"><table><thead><tr><th>Label</th><th>Websites</th><th>Status</th><th>Actions</th></tr></thead><tbody>{widgets.map(widget=><tr key={widget.id}><td>{widget.label}</td><td>{widget.origins.map(origin=><small key={origin}>{origin}</small>)}</td><td>{widget.enabled?'Published':'Disabled'}</td><td><div className="wa-module-controls"><button type="button" title="Copy widget embed code" aria-label="Copy widget embed code" disabled={busy} onClick={()=>run(()=>navigator.clipboard.writeText('<script async src="'+widget.scriptUrl+'"></script>'))}><Copy size={16}/></button>{role==='Owner'&&<><button type="button" title="Edit widget" aria-label="Edit widget" disabled={busy} onClick={()=>setEditing(widget)}><Pencil size={16}/></button><button type="button" title="Delete widget" aria-label="Delete widget" disabled={busy} onClick={()=>{if(window.confirm('Delete this website widget?'))run(async()=>{await postJson('/api/whatsapp/widgets',{action:'delete',id:widget.id});await load();});}}><Trash2 size={16}/></button></>}</div></td></tr>)}</tbody></table>{!widgets.length&&<p>No website widgets for this number.</p>}</div>
  </div>;
}
