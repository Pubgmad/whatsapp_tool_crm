'use client';
import {useEffect,useState} from 'react';
import {Save,RefreshCcw} from 'lucide-react';
import '../app/support-policy.css';

export default function SupportPolicy({endpoint,canEdit,api,postJson}) {
  const [data,setData]=useState(null),[policy,setPolicy]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;setData(null);setPolicy(null);api(endpoint).then(result=>{if(active){setData(result);setPolicy(result.policy);}}).catch(cause=>{if(active)setError(cause.message);});return()=>{active=false;};},[endpoint,api]);
  function change(key,value){setPolicy(current=>({...current,[key]:value}));}
  async function reload(){setBusy(true);setError('');try{const result=await api(endpoint);setData(result);setPolicy(result.policy);}catch(cause){setError(cause.message);}finally{setBusy(false);}}
  async function save(event){event.preventDefault();setBusy(true);setError('');try{const result=await postJson(endpoint,{policy,revision:data.revision});setData(result);setPolicy(result.policy);}catch(cause){setError(cause.message);}finally{setBusy(false);}}
  function configure(){setPolicy({enabled:false,mode:'manual',scope:'handoff',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,alwaysOpen:false,agentIds:[],maxOpen:'',slaMinutes:'',escalationUserId:null,hours:[]});}
  return <section className="supportPolicy">
    <header className="wa-module-heading"><h3>Support routing and response SLA</h3><button type="button" title="Reload support queue" aria-label="Reload support queue" disabled={busy} onClick={reload}><RefreshCcw size={18}/></button></header>
    {error&&<p role="alert">{error}</p>}
    {!data&&!error&&<p>Loading support policy...</p>}
    {data&&!policy&&<div><p>No support policy configured.</p>{canEdit&&<button type="button" onClick={configure}>Configure policy</button>}</div>}
    {policy&&<form onSubmit={save}><fieldset disabled={!canEdit||busy} style={{border:0,padding:0,minWidth:0}}>
      <div className="supportPolicyGrid">
        <label className="checkRow"><input type="checkbox" checked={policy.enabled} onChange={event=>change('enabled',event.target.checked)}/>Enabled</label>
        <label>Assignment<select value={policy.mode} onChange={event=>change('mode',event.target.value)}><option value="manual">Manual</option><option value="round_robin">Round robin</option><option value="least_loaded">Least loaded</option></select></label>
        <label>Routing scope<select value={policy.scope} onChange={event=>change('scope',event.target.value)}><option value="handoff">Human handoff conversations</option><option value="unassigned">All open waiting conversations</option></select></label>
        <label>Time zone<input required value={policy.timezone} onChange={event=>change('timezone',event.target.value)}/></label>
        <label>Open conversation capacity per agent<input type="number" required min="1" max="10000" value={policy.maxOpen} onChange={event=>change('maxOpen',event.target.value===''?'':Number(event.target.value))}/></label>
        <label>Human response SLA (elapsed minutes)<input type="number" required min="1" max="10080" value={policy.slaMinutes} onChange={event=>change('slaMinutes',event.target.value===''?'':Number(event.target.value))}/></label>
        <label>Escalation manager<select value={policy.escalationUserId||''} onChange={event=>change('escalationUserId',event.target.value||null)}><option value="">No reassignment</option>{data.members.filter(member=>['Owner','Manager'].includes(member.role)).map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label className="checkRow"><input type="checkbox" checked={policy.alwaysOpen} onChange={event=>change('alwaysOpen',event.target.checked)}/>Open at all times</label>
      </div>
      <h4>Eligible agents</h4><div className="supportPolicyGrid">{data.members.map(member=><label className="checkRow" key={member.id}><input type="checkbox" checked={policy.agentIds.includes(member.id)} onChange={event=>change('agentIds',event.target.checked?[...policy.agentIds,member.id]:policy.agentIds.filter(id=>id!==member.id))}/>{member.name} ({member.availability})</label>)}</div>
      {!policy.alwaysOpen&&<><h4>Business hours</h4>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day,index)=>{const hours=policy.hours.find(row=>row.day===index);return <div key={day} className="supportHours"><label className="checkRow"><input type="checkbox" checked={Boolean(hours)} onChange={event=>change('hours',event.target.checked?[...policy.hours,{day:index,start:'',end:''}]:policy.hours.filter(row=>row.day!==index))}/>{day}</label>{hours&&<><label>Opens<input aria-label={day+' opens'} type="time" required value={hours.start} onChange={event=>change('hours',policy.hours.map(row=>row.day===index?{...row,start:event.target.value}:row))}/></label><label>Closes<input aria-label={day+' closes'} type="time" required value={hours.end} onChange={event=>change('hours',policy.hours.map(row=>row.day===index?{...row,end:event.target.value}:row))}/></label></>}</div>;})}</>}
      {canEdit&&<button type="submit" disabled={busy}><Save size={16}/> Save policy</button>}
    </fieldset></form>}
    {data&&<><h4>Oldest waiting conversations</h4><div className="wa-module-table"><table><thead><tr><th>Contact</th><th>Waiting since</th><th>Assignee</th><th>SLA</th></tr></thead><tbody>{data.waiting.map(item=><tr key={item.conversation_id}><td>{item.contact_name}</td><td>{new Date(item.waiting_since).toLocaleString()}</td><td>{data.members.find(member=>member.id===item.assigned_user_id)?.name||'Unassigned'}</td><td>{item.breached_at?'Breached':'Waiting'}</td></tr>)}</tbody></table></div>{!data.waiting.length&&<p>No waiting conversations.</p>}</>}
  </section>;
}
