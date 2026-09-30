'use client';
import {useCallback,useEffect,useState} from 'react';
import {ChevronLeft,ChevronRight,RefreshCcw,Save,Send,Plus,PowerOff,ExternalLink} from 'lucide-react';
import TemplateParameterFields from './template-parameter-fields';

export default function MerchantPayments({api,postJson,role,orders}) {
  const [data,setData]=useState({settings:null,checkouts:[],templates:[],page:1,hasMore:false});
  const [page,setPage]=useState(1),[pending,setPending]=useState(false),[error,setError]=useState(''),[result,setResult]=useState('');
  const [sendId,setSendId]=useState(''),[templateId,setTemplateId]=useState(''),[parameters,setParameters]=useState({});
  const template=data.templates.find(item=>item.id===templateId);
  const load=useCallback(async()=>setData(await api('/api/whatsapp/payments?page='+page)),[api,page]);
  useEffect(()=>{let active=true;api('/api/whatsapp/payments?page='+page).then(value=>{if(active)setData(value);}).catch(cause=>{if(active)setError(cause.message);});return()=>{active=false;};},[api,page]);
  const act=async(body)=>{
    setPending(true);setError('');setResult('');
    try {const value=await postJson('/api/whatsapp/payments',body);await load();setResult(value.status?'Payment: '+value.status:'Saved');return value;}
    catch(cause){setError(cause.message);return null;}finally{setPending(false);}
  };
  const configure=async(event)=>{
    event.preventDefault();const form=event.currentTarget,values=new FormData(form);
    const saved=await act({action:'configure',keyId:values.get('keyId'),keySecret:values.get('keySecret'),webhookSecret:values.get('webhookSecret'),enabled:values.get('enabled')==='on'});
    if(saved){form.elements.keyId.value='';form.elements.keySecret.value='';form.elements.webhookSecret.value='';}
  };
  const send=async(event)=>{
    event.preventDefault();const values=new FormData(event.currentTarget);
    const saved=await act({action:'send',checkoutId:sendId,message:values.get('message'),...(template?{templateId,linkVariable:Number(values.get('linkVariable')),variables:template.variables.map((_,index)=>values.get('variable_'+index)||''),parameters}:{})});
    if(saved)setSendId('');
  };
  return <section>
    <header className='commerceToolbar'><h3>Razorpay customer payments</h3><button type='button' className='iconButton' title='Refresh payments' aria-label='Refresh payments' disabled={pending} onClick={()=>load().catch(cause=>setError(cause.message))}><RefreshCcw size={18}/></button></header>
    {error&&<p className='formError' role='alert'>{error}</p>}{result&&<p role='status'>{result}</p>}
    {role==='Owner'&&<form className='formGrid' onSubmit={configure} key={String(data.settings?.updated_at||'new')}>
      <label>Company Razorpay key ID<input name='keyId' autoComplete='off' required={!data.settings}/></label>
      <label>Company Razorpay key secret<input name='keySecret' type='password' autoComplete='new-password' required={!data.settings}/></label>
      <label>Merchant webhook secret<input name='webhookSecret' type='password' minLength={32} autoComplete='new-password' required={!data.settings}/></label>
      <label className='checkRow'><input name='enabled' type='checkbox' defaultChecked={data.settings?.enabled}/> Enable customer payments</label>
      <div className='formActions'><button type='submit' className='primaryAction' disabled={pending}><Save size={18}/> Save credentials</button>{data.settings?.enabled&&<button type='button' className='secondaryAction' disabled={pending} onClick={()=>act({action:'disable'})}><PowerOff size={18}/> Disable</button>}</div>
    </form>}
    {data.webhookUrl&&<label className='fieldGroup'>Merchant webhook URL<input readOnly value={data.webhookUrl}/></label>}
    <form className='formGrid' onSubmit={event=>{event.preventDefault();act({action:'create',orderId:new FormData(event.currentTarget).get('orderId')});}}>
      <label>Unpaid order<select name='orderId' required><option value=''>Select order</option>{orders.filter(order=>order.payment_status!=='captured'&&order.fulfillment_status!=='cancelled').map(order=><option key={order.id} value={order.id}>{order.id} ({order.total_amount} {order.currency})</option>)}</select></label>
      <button type='submit' className='primaryAction' disabled={pending||!data.settings?.enabled}><Plus size={18}/> Create checkout</button>
    </form>
    <div className='commerceTable'><table><thead><tr><th>Order</th><th>Payment</th><th>Message</th><th>Actions</th></tr></thead><tbody>{data.checkouts.map(checkout=><tr key={checkout.id}><td>{checkout.order_id}<small>{checkout.provider_link_id||checkout.id}</small></td><td>{checkout.status}<small>{checkout.error_code}</small></td><td>{checkout.message_state}</td><td><div className='rowActions'>
      <button type='button' title='Reconcile with Razorpay' aria-label='Reconcile with Razorpay' disabled={pending} onClick={()=>act({action:'reconcile',checkoutId:checkout.id})}><RefreshCcw size={16}/></button>
      {checkout.checkout_url&&<a className='iconButton' href={checkout.checkout_url} target='_blank' rel='noopener noreferrer' title='Open checkout' aria-label='Open checkout'><ExternalLink size={16}/></a>}
      <button type='button' title='Send payment request' aria-label='Send payment request' disabled={pending||checkout.status!=='pending'||!['none','failed'].includes(checkout.message_state)} onClick={()=>{setSendId(checkout.id);setTemplateId('');setParameters({});}}><Send size={16}/></button>
    </div></td></tr>)}{!data.checkouts.length&&<tr><td colSpan={4}>No customer checkouts</td></tr>}</tbody></table></div>
    {sendId&&<form className='formGrid' onSubmit={send}>
      <h3>Send payment request</h3><label>Delivery<select value={templateId} onChange={event=>{setTemplateId(event.target.value);setParameters({});}}><option value=''>Service-window text</option>{data.templates.filter(item=>item.variables.length).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      {!template&&<label>Message<textarea name='message' required maxLength={2000}/></label>}
      {template&&<><label>Payment-link variable<select name='linkVariable' required>{template.variables.map((variable,index)=><option key={index} value={index}>{variable}</option>)}</select></label>{template.variables.map((variable,index)=><label key={index}>{variable}<input name={'variable_'+index}/></label>)}<TemplateParameterFields template={{componentSchema:template.component_schema}} value={parameters} onChange={setParameters}/></>}
      <div className='formActions'><button type='submit' className='primaryAction' disabled={pending}><Send size={18}/> Send request</button><button type='button' className='secondaryAction' onClick={()=>setSendId('')}>Cancel</button></div>
    </form>}
    <footer className='commercePagination'><button className='iconButton' aria-label='Previous payments' title='Previous payments' disabled={page===1||pending} onClick={()=>setPage(value=>value-1)}><ChevronLeft size={18}/></button><span>Page {data.page}</span><button className='iconButton' aria-label='Next payments' title='Next payments' disabled={!data.hasMore||pending} onClick={()=>setPage(value=>value+1)}><ChevronRight size={18}/></button></footer>
  </section>;
}
