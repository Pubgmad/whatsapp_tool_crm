'use client';
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCcw, Save, Send, PowerOff } from 'lucide-react';

export default function WhatsAppConversions({ api, postJson, role }) {
  const [data,setData] = useState({ accounts:[],events:[],conversations:[],page:1,hasMore:false });
  const [page,setPage] = useState(1);
  const [pending,setPending] = useState(false);
  const [error,setError] = useState('');
  const [result,setResult] = useState('');
  const [name,setName] = useState('Lead');
  const load = useCallback(async () => setData(await api(`/api/whatsapp/conversions?page=${page}`)), [api,page]);
  useEffect(() => { let active=true; api(`/api/whatsapp/conversions?page=${page}`).then((value) => { if(active) setData(value); }).catch((reason) => { if(active) setError(reason.message); }); return () => { active=false; }; }, [api,page]);
  const configure = async (event) => {
    event.preventDefault(); const form=event.currentTarget; const values=new FormData(form);
    setPending(true);setError('');setResult('');
    try {
      await postJson('/api/whatsapp/conversions',{ action:'configure',accountId:values.get('accountId'),datasetId:values.get('datasetId'),pageId:values.get('pageId'),accessToken:values.get('accessToken'),enabled:values.get('enabled')==='on' });
      form.elements.accessToken.value=''; await load();setResult('Measurement configuration saved');
    } catch(reason) { setError(reason.message); } finally { setPending(false); }
  };
  const report = async (event) => {
    event.preventDefault();const values=new FormData(event.currentTarget);
    setPending(true);setError('');setResult('');
    try {
      const response=await postJson('/api/whatsapp/conversions',{ action:'report',eventId:values.get('eventId'),conversationId:values.get('conversationId'),eventName:name,consentConfirmed:values.get('consentConfirmed')==='on',...(name==='Purchase'?{value:values.get('value'),currency:values.get('currency')}: {}) });
      setResult(`${response.duplicate?'Existing event':'Event'}: ${response.status}`);await load();
    } catch(reason) { setError(reason.message); } finally { setPending(false); }
  };
  const disable = async () => {
    setPending(true);setError('');setResult('');
    try { await postJson('/api/whatsapp/conversions',{action:'disable'});await load();setResult('Measurement disabled'); }
    catch(reason) { setError(reason.message); } finally { setPending(false); }
  };
  return <section className='commerceScreen'>
    <header className='commerceToolbar'><h2>WhatsApp conversions</h2><button className='iconButton' type='button' aria-label='Refresh conversions' title='Refresh conversions' disabled={pending} onClick={() => { setError('');load().catch((reason) => setError(reason.message)); }}><RefreshCcw size={18}/></button></header>
    {error&&<div className='formError' role='alert'>{error}</div>}{result&&<div className='formSuccess' role='status'>{result}</div>}
    {role==='Owner'&&<section><h3>Measurement settings</h3><form key={`${data.settings?.updated_at || 'new'}-${data.accounts.length}`} className='formGrid' onSubmit={configure}>
      <label>WhatsApp account<select name='accountId' defaultValue={data.settings?.whatsapp_account_id || ''} required><option value=''>Select account</option>{data.accounts.map((account)=><option key={account.id} value={account.id}>{account.name||account.waba_id}</option>)}</select></label>
      <label>Dataset ID<input name='datasetId' defaultValue={data.settings?.dataset_id||''} pattern='[0-9]{1,32}' required/></label><label>Facebook Page ID<input name='pageId' defaultValue={data.settings?.page_id||''} pattern='[0-9]{1,32}' required/></label>
      <label>Measurement access token<input name='accessToken' type='password' autoComplete='new-password' required={!data.settings}/></label><label className='checkRow'><input type='checkbox' name='enabled' defaultChecked={Boolean(data.settings?.enabled)}/> Enable measurement</label>
      <button className='primaryAction' disabled={pending} type='submit'><Save size={18}/> Save settings</button>
      {data.settings?.enabled&&<button type='button' disabled={pending} onClick={disable}><PowerOff size={18}/> Disable measurement</button>}
    </form></section>}
    <section><h3>Report business outcome</h3><form className='formGrid' onSubmit={report}>
      <label>Attributed conversation<select name='conversationId' required><option value=''>Select conversation</option>{data.conversations.map((conversation)=><option key={conversation.id} value={conversation.id}>{conversation.name||conversation.phone} ({conversation.phone})</option>)}</select></label>
      <label>Event<select value={name} onChange={(event)=>setName(event.target.value)}><option value='Lead'>Lead</option><option value='Purchase'>Purchase</option></select></label><label>Business-event reference<input name='eventId' maxLength={128} pattern='[A-Za-z0-9_.:-]+' required/></label>
      {name==='Purchase'&&<><label>Purchase value<input name='value' type='number' step='any' min='0' required/></label><label>Currency<input name='currency' pattern='[A-Z]{3}' maxLength={3} required/></label></>}
      <label className='checkRow'><input type='checkbox' name='consentConfirmed' required/> Customer measurement consent confirmed</label><button className='primaryAction' type='submit' disabled={pending||!data.settings?.enabled||!data.conversations.length}><Send size={18}/> Report event</button>
    </form></section>
    <div className='commerceTable'><table><thead><tr><th>Reference</th><th>Event</th><th>Status</th><th>Submitted</th></tr></thead><tbody>{data.events.map((event)=><tr key={event.id}><td>{event.event_id}</td><td>{event.event_name}</td><td>{event.status}{event.error_code&&<small>{event.error_code}</small>}</td><td>{new Date(event.created_at).toLocaleString()}</td></tr>)}{!data.events.length&&<tr><td colSpan={4}>No conversion events</td></tr>}</tbody></table></div>
    <footer className='commercePagination'><button className='iconButton' type='button' title='Previous events' aria-label='Previous events' disabled={page===1||pending} onClick={()=>setPage((value)=>value-1)}><ChevronLeft size={18}/></button><span>Page {data.page}</span><button className='iconButton' type='button' title='Next events' aria-label='Next events' disabled={!data.hasMore||pending} onClick={()=>setPage((value)=>value+1)}><ChevronRight size={18}/></button></footer>
  </section>;
}
