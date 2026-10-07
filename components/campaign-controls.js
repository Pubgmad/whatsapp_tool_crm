'use client';
import {useEffect,useRef,useState} from 'react';
import {Copy, Send, ShieldCheck, Save, X} from 'lucide-react';
import './campaign-controls.css';

export function CampaignPolicy({role,businessId,api,postJson}) {
  const [policy,setPolicy]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const mounted=useRef(false);
  useEffect(()=>{
    let stopped=false;mounted.current=true;setPolicy(null);setError('');
    if(['Owner','Manager'].includes(role))api('/api/campaigns/policy').then(value=>{if(!stopped)setPolicy(value);}).catch(failure=>{if(!stopped)setError(failure.message);});
    return ()=>{stopped=true;mounted.current=false;};
  },[businessId,role,api]);
  if(!['Owner','Manager'].includes(role))return null;
  const save=async event=>{
    event.preventDefault();if(busy||!policy)return;setBusy(true);setError('');
    try{const result=await postJson('/api/campaigns/policy',policy,'PUT');if(mounted.current)setPolicy(result);}
    catch(failure){if(mounted.current)setError(failure.message);}
    finally{if(mounted.current)setBusy(false);}
  };
  return <section className='campaignPolicy'>
    <h3>Campaign policy</h3>
    {!policy&&!error&&<p>Loading policy...</p>}
    {policy&&<form className='campaignControlForm' onSubmit={save}>
      <label className='checkboxLabel'><input type='checkbox' checked={policy.approvalRequired} disabled={busy||role!=='Owner'} onChange={event=>setPolicy({...policy,approvalRequired:event.target.checked})}/>Owner review for new campaigns</label>
      <label>Minimum marketing interval (hours)<input type='number' min='0' max='8760' step='1' required value={policy.minMarketingIntervalHours} disabled={busy||role!=='Owner'} onChange={event=>setPolicy({...policy,minMarketingIntervalHours:event.target.value})}/></label>
      {role==='Owner'&&<button type='submit' className='secondaryAction' disabled={busy}><Save size={16}/>Save policy</button>}
    </form>}
    {error&&<p role='alert' className='errorLine'>{error}</p>}
  </section>;
}

export default function CampaignControls({campaign,role,submit}) {
  const [mode,setMode] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  if (!['Owner','Manager'].includes(role)) return <CampaignRecipientBrowser campaign={campaign}/>;
  const execute = async (action,values={}) => {
    if (busy) return;
    setBusy(true);setError('');
    try {await submit(campaign,action,values);setMode('');}
    catch (failure) {setError(failure.message);}
    finally {setBusy(false);}
  };
  const save = event => {
    event.preventDefault();const values=new FormData(event.currentTarget);
    execute(mode,{name:values.get('name'),note:values.get('note'),frequencyHours:values.get('frequencyHours')??campaign.frequencyHours,scheduledAt:values.get('scheduledAt')?new Date(values.get('scheduledAt')).toISOString():''});
  };
  return <div className='campaignControls'>
    <div className='campaignControlButtons'>
      <button type='button' className='secondaryAction compactAction' disabled={busy} onClick={()=>setMode('duplicate')}><Copy size={15}/>Duplicate</button>
      {campaign.status==='draft'&&<button type='button' className='secondaryAction compactAction' disabled={busy} onClick={()=>setMode('submit')}><Send size={15}/>Submit for review</button>}
      {role==='Owner'&&campaign.approvalStatus==='pending'&&<>
        <button type='button' className='secondaryAction compactAction' disabled={busy} onClick={()=>execute('approve')}><ShieldCheck size={15}/>Approve</button>
        <button type='button' className='secondaryAction compactAction dangerSoft' disabled={busy} onClick={()=>setMode('reject')}><X size={15}/>Reject</button>
      </>}
      {(campaign.stats?.failed||0)>0&&<button type='button' className='secondaryAction compactAction' disabled={busy} onClick={()=>execute('retry_failed')} title='Re-queue failed recipients that are still eligible'>Retry failed ({campaign.stats.failed})</button>}
      {campaign.frequencyHours>0&&<span className='muted'>Marketing interval: {campaign.frequencyHours}h</span>}
    </div>
    {campaign.reviewNote&&<p className='muted'>{campaign.reviewNote}</p>}
    {mode&&<form className='campaignControlForm' onSubmit={save}>
      {mode==='duplicate'&&<label>New campaign name<input name='name' required maxLength={255} defaultValue={campaign.name}/></label>}
      {mode==='submit'&&<>
        <label>Schedule<input name='scheduledAt' type='datetime-local'/></label>
        <label>Marketing interval (hours)<input name='frequencyHours' type='number' min='0' max='8760' step='1' defaultValue={campaign.frequencyHours??0} required/></label>
      </>}
      {mode!=='duplicate'&&<label>Review note<textarea name='note' maxLength={2000} required={mode==='reject'}/></label>}
      <button type='submit' className='primaryAction compactAction' disabled={busy}><Send size={15}/>{mode==='duplicate'?'Save draft':mode==='reject'?'Reject':'Submit'}</button>
      <button type='button' className='iconButton' title='Close' aria-label='Close campaign form' disabled={busy} onClick={()=>setMode('')}><X size={16}/></button>
    </form>}
    {error&&<p role='alert' className='errorLine'>{error}</p>}
    <CampaignRecipientBrowser campaign={campaign}/>
  </div>;
}

function CampaignRecipientBrowser({campaign}) {
  const [open,setOpen]=useState(false),[page,setPage]=useState(1),[data,setData]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();
    setData(null);
    setError('');
    fetch(`/api/campaigns/${encodeURIComponent(campaign.id)}/recipients?page=${page}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal})
      .then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error||'Recipients could not be loaded.');return result;})
      .then(result=>{if(!controller.signal.aborted){setData(result);if(result.pagination.page!==page)setPage(result.pagination.page);}}).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);});
    return()=>controller.abort();
  },[campaign.id,open,page,campaign.stats?.total]);
  if(!campaign.stats?.total)return null;
  return <details className='campaignRecipients' open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>All recipients ({campaign.stats.total})</summary>
    {error&&<p role='alert' className='errorLine'>{error}</p>}
    {open&&!data&&!error&&<p>Loading recipients...</p>}
    {open&&data&&<><div className='campaignRecipientsTable'><table><thead><tr><th>Contact</th><th>Status</th><th>Message</th><th>Delivery</th></tr></thead><tbody>{data.recipients.map(recipient=><tr key={recipient.id}><td>{recipient.contactName}<small>{recipient.contactPhone}</small></td><td>{recipient.status}{recipient.replied?' / replied':''}</td><td>{recipient.message}</td><td>{recipient.jobStatus||'-'}{recipient.errorMessage&&<small role='alert'>{recipient.errorMessage}</small>}{recipient.jobError&&<small>{recipient.jobError}</small>}</td></tr>)}</tbody></table></div><nav className='campaignRecipientPages' aria-label='Campaign recipients'><button type='button' disabled={page<=1} onClick={()=>setPage(page-1)}>Previous</button><span>Page {data.pagination.page} of {data.pagination.pages}</span><button type='button' disabled={page>=data.pagination.pages} onClick={()=>setPage(page+1)}>Next</button></nav></>}
  </details>;
}
