'use client';
import {useEffect,useState} from 'react';
import {Copy,RefreshCcw,Trash2,Save,Plus,ChevronRight} from 'lucide-react';
import './whatsapp-modules.css';
import EntryPointRule from './entry-point-rule';
import WhatsAppWebsiteWidget from './whatsapp-website-widget';
export default function WhatsAppEntryPoints({phone,api,postJson,role}){
  const [data,setData]=useState(null),[message,setMessage]=useState(''),[editing,setEditing]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load(after=''){const result=await api('/api/whatsapp/entry-points?phoneId='+encodeURIComponent(phone.id)+(after?'&after='+encodeURIComponent(after):''));setData(result);}
  useEffect(()=>{let active=true;setData(null);setEditing('');setMessage('');setError('');if(phone?.id)api('/api/whatsapp/entry-points?phoneId='+encodeURIComponent(phone.id)).then(result=>{if(active)setData(result);}).catch(cause=>{if(active)setError(cause.message);});return()=>{active=false;};},[phone?.id,api]);
  async function run(task){setBusy(true);setError('');try{await task();}catch(cause){setError(cause.message);}finally{setBusy(false);}}
  async function mutate(action,code='',text=message){await postJson('/api/whatsapp/entry-points',{action,phoneId:phone.id,requestId:crypto.randomUUID(),code,message:text});setEditing('');setMessage('');await load();}
  if(!phone)return <p>No connected phone number selected.</p>;
  const safeLink=(url)=>{
    try{
      const parsed=new URL(String(url||''));
      if(parsed.protocol!=='https:')return '';
      const host=parsed.hostname.toLowerCase();
      if(host==='wa.me'||host.endsWith('.wa.me')||host==='api.whatsapp.com'||host==='www.whatsapp.com'||host==='whatsapp.com')return parsed.href;
    }catch{/* ignore */}
    return '';
  };
  return <section className="wa-module entryPointsWorkspace"><header className="wa-module-heading saasPageHeadToolbar"><div><strong className="wa-module-toolbarLabel">Entry points</strong><span className="wa-module-subhead">QR codes, deep links, and website widgets for this number</span></div><button type="button" aria-label="Refresh entry points" title="Refresh entry points" disabled={busy} onClick={()=>run(()=>load())}><RefreshCcw size={18}/></button></header>{error&&<p role="alert" className="wa-module-error">{error}</p>}
    <form onSubmit={event=>{event.preventDefault();run(()=>mutate(editing?'update':'create',editing));}}><label>Prefilled message<textarea required maxLength={512} value={message} onChange={event=>setMessage(event.target.value)}/></label><div className="wa-module-controls"><button disabled={busy}><Save size={16}/>{editing?'Save changes':'Create QR code'}</button>{editing&&<button type="button" disabled={busy} onClick={()=>{setEditing('');setMessage('');}}><Plus size={16}/>New entry point</button>}</div></form>
    {data?.pending.map(operation=><p key={operation.id} role="status">{operation.action}: {operation.status} ({operation.id}). Check the current Meta list before creating another entry.</p>)}
    <div className="wa-module-table"><table><thead><tr><th>QR code</th><th>Message</th><th>Link</th><th>Actions</th></tr></thead><tbody>{data?.entries.map(entry=>{const href=safeLink(entry.deep_link_url);return <tr key={entry.code}><td>{entry.qr_image_url&&<img src={entry.qr_image_url} alt={'WhatsApp QR code '+entry.code} width={112} height={112} referrerPolicy="no-referrer"/>}<small>{entry.code}</small></td><td>{entry.prefilled_message}{role==='Owner'&&<EntryPointRule key={entry.code+String(data.rules.find(rule=>rule.code===entry.code)?.enabled)} entry={entry} rule={data.rules.find(rule=>rule.code===entry.code)} workflows={data.workflows} phoneId={phone.id} postJson={postJson} onSaved={()=>load()}/>}</td><td>{href?<a href={href} target="_blank" rel="noopener noreferrer">{entry.deep_link_url}</a>:<span>{entry.deep_link_url||'—'}</span>}</td><td><div className="wa-module-controls"><button type="button" title="Copy WhatsApp link" aria-label="Copy WhatsApp link" disabled={busy||!entry.deep_link_url} onClick={()=>run(()=>navigator.clipboard.writeText(entry.deep_link_url))}><Copy size={16}/></button><button type="button" disabled={busy} onClick={()=>{setEditing(entry.code);setMessage(entry.prefilled_message);}}>Edit</button><button type="button" title="Delete QR code" aria-label="Delete QR code" disabled={busy} onClick={()=>{if(window.confirm('Delete this WhatsApp entry point?'))run(()=>mutate('delete',entry.code,entry.prefilled_message));}}><Trash2 size={16}/></button></div></td></tr>;})}</tbody></table>{data&&!data.entries.length&&<div className="wa-module-empty" role="status"><strong>No QR codes yet</strong><p>Create a prefilled message to generate a Meta QR code and deep link for this number.</p></div>}</div><button type="button" disabled={busy||!data?.after} onClick={()=>run(()=>load(data.after))}><ChevronRight size={16}/>Next entries</button>
    <h3>Prefilled-message attribution</h3>
    <p className="wa-module-note">Matches inbound WhatsApp text to the prefilled message on an enabled entry rule. This is not the same as Meta Click-to-WhatsApp ad referrals or website widget click counts.</p>
    <div className="wa-module-table"><table><thead><tr><th>Source</th><th>Contact</th><th>Workflow</th><th>Matched</th></tr></thead><tbody>{data?.attributions.map(item=><tr key={item.id}><td>{item.source_name}</td><td>{item.contact_name}</td><td>{item.workflow_status}</td><td>{new Date(item.matched_at).toLocaleString()}</td></tr>)}</tbody></table>{data&&!data.attributions?.length&&<p className="wa-module-note">No matched attributions yet.</p>}</div>
    <WhatsAppWebsiteWidget phoneId={phone.id} role={role} api={api} postJson={postJson}/>
  </section>;
}
