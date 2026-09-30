'use client';
import {useEffect,useRef,useState} from 'react';
import {RefreshCcw,Smartphone} from 'lucide-react';

const format=value=>value?new Date(value).toLocaleString():'Not received';
export default function CoexistenceProgress({phones,api,postJson}) {
  const [rows,setRows]=useState(phones);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState('');
  const mounted=useRef(false);
  useEffect(()=>setRows(phones),[phones]);
  useEffect(()=>{
    mounted.current=true;let stopped=false,pending=false;
    const refresh=async()=>{
      if(stopped||pending||document.visibilityState!=='visible')return;
      pending=true;
      try {const data=await api('/api/meta/coexistence/sync');if(!stopped){setRows(data.phones);setError('');}}
      catch(failure){if(!stopped)setError(failure.message);}
      finally {pending=false;}
    };
    refresh();const interval=setInterval(refresh,5000);
    return ()=>{stopped=true;mounted.current=false;clearInterval(interval);};
  },[api]);
  const request=async(phone,kind)=>{
    if(busy)return;setBusy(phone.id+':'+kind);setError('');
    try {
      await postJson('/api/meta/coexistence/sync',{phoneId:phone.id,kind});
      const result=await api('/api/meta/coexistence/sync');if(mounted.current)setRows(result.phones);
    }catch(failure){if(mounted.current)setError(failure.message);}
    finally{if(mounted.current)setBusy('');}
  };
  return <>
    {rows.map(phone=><section className='coexistenceSummary' key={phone.id}>
      <header><div><h3><Smartphone size={16}/> Business App sync</h3><span>{phone.displayPhoneNumber||phone.phoneNumberId}</span></div><span>Last event: {format(phone.coexistence.lastEventAt)}</span></header>
      <div className='coexistenceMetrics'>
        <div><span>Contacts</span><strong>{phone.coexistence.contactsImported}</strong><small>{phone.coexistence.contactsStatus}</small><small>Requested: {format(phone.coexistence.contactsRequestedAt)}</small></div>
        <div><span>History messages</span><strong>{phone.coexistence.messagesImported}</strong><small>{phone.coexistence.historyStatus}</small><small>Requested: {format(phone.coexistence.historyRequestedAt)}</small></div>
        <div><span>Business App replies</span><strong>{phone.coexistence.echoesImported}</strong></div>
      </div>
      {phone.coexistence.lastError&&<p className='formError' role='alert'>{phone.coexistence.lastError}</p>}
      {['contactsStatus','historyStatus'].some(key=>phone.coexistence[key]==='unconfirmed')&&<p className='formError'>Meta has not confirmed the sync request. Recovery requires checking Meta or reconnecting this number.</p>}
      <div className='connectionActions'>
        {['contacts','history'].map(kind=><button type='button' className='secondaryAction' key={kind} disabled={Boolean(busy)||!['failed','not_requested'].includes(phone.coexistence[kind+'Status'])} onClick={()=>request(phone,kind)}><RefreshCcw size={16}/>Sync {kind}</button>)}
      </div>
    </section>)}
    {error&&<p className='formError' role='alert'>{error}</p>}
  </>;
}
