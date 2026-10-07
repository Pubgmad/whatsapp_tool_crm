'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Check,RefreshCcw} from 'lucide-react';
import styles from '../app/w/[viewId]/page.module.css';

const sessionKey=viewId=>`wcrm_view_${viewId}`;
const money=(value,currency)=>{
  try{return new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:2}).format(Number(value));}
  catch{return `${value} ${currency}`;}
};

export default function TransactionalWebview({viewId,title,businessName}){
  const [data,setData]=useState(null),[selected,setSelected]=useState(''),[quantity,setQuantity]=useState(1),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const token=useRef(''),pending=useRef(null);
  async function exchange(action,extra={}){
    if(!token.current){setError('This invitation is unavailable or expired. Ask the business for a new one.');return;}
    let operation=pending.current;
    if(action!=='load'&&(!operation||operation.action!==action||JSON.stringify(operation.extra)!==JSON.stringify(extra))){operation={action,extra,requestId:crypto.randomUUID()};pending.current=operation;}
    setBusy(true);setError('');
    try{
      const response=await fetch(`/api/public/webviews/${encodeURIComponent(viewId)}`,{method:'POST',credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',headers:{'content-type':'application/json'},body:JSON.stringify({session:token.current,action,...extra,...(action==='load'?{}:{requestId:operation.requestId})})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'The request could not be completed.');
      pending.current=null;setData(result);
      if(result.state==='choose'&&result.resources?.length&&!result.resources.some(resource=>resource.id===selected))setSelected(result.resources[0].id);
    }catch(cause){setError(cause.message);}finally{setBusy(false);}
  }
  useEffect(()=>{
    const url=new URL(window.location.href);
    const fromUrl=url.searchParams.get('session');
    if(fromUrl){sessionStorage.setItem(sessionKey(viewId),fromUrl);url.searchParams.delete('session');window.history.replaceState(null,'',url.pathname+url.search+url.hash);}
    token.current=fromUrl||sessionStorage.getItem(sessionKey(viewId))||'';
    exchange('load');
  },[viewId]);
  const resources=data?.resources||[];
  const chosen=resources.find(item=>item.id===selected);
  const reservation=data?.reservation;
  return <main className={styles.transactionPage}><header className={styles.transactionHeader}><div><small>{businessName}</small><h1>{data?.title||title}</h1><p>{data?.description}</p></div><button type="button" title="Refresh availability" aria-label="Refresh availability" disabled={busy||data?.state!=='choose'} onClick={()=>exchange('load')}><RefreshCcw size={18}/></button></header>
    {error&&<p className={styles.error} role="alert">{error}</p>}
    {!data&&!error&&<p role="status">Loading availability...</p>}
    {data?.state==='choose'&&<section className={styles.transactionBody} aria-label={data.mode==='booking'?'Available appointments':'Available products'}>
      {!resources.length?<p>No availability right now.</p>:<><div className={styles.resourceList}>{resources.map(item=><label key={item.id} className={styles.resource}><input type="radio" name="resource" value={item.id} checked={selected===item.id} onChange={()=>setSelected(item.id)}/><span><strong>{item.title}</strong>{item.starts_at&&<small>{new Date(item.starts_at).toLocaleString()}</small>}</span><span className={styles.price}>{money(item.unit_price,item.currency)}<small>{item.available} available</small></span></label>)}</div><div className={styles.transactionFooter}><label>Quantity<input type="number" min="1" max={chosen?.available||1} value={quantity} onChange={event=>setQuantity(Number(event.target.value))}/></label><button type="button" disabled={busy||!chosen||!Number.isInteger(quantity)||quantity<1||quantity>chosen.available} onClick={()=>exchange('reserve',{resourceId:chosen.id,quantity})}>Continue</button></div></>}
    </section>}
    {data?.state==='review'&&reservation&&<section className={styles.transactionBody}><h2>Review {data.mode==='booking'?'appointment':'order'}</h2><dl><div><dt>Selection</dt><dd>{reservation.title}</dd></div><div><dt>Quantity</dt><dd>{reservation.quantity}</dd></div><div><dt>Total</dt><dd>{money(Number(reservation.unit_price)*reservation.quantity,reservation.currency)}</dd></div>{reservation.starts_at&&<div><dt>Time</dt><dd>{new Date(reservation.starts_at).toLocaleString()}</dd></div>}</dl><p>Held until {new Date(reservation.expiresAt).toLocaleString()}.</p><div className={styles.transactionFooter}><button type="button" className={styles.secondary} disabled={busy} onClick={()=>exchange('cancel')}><ArrowLeft size={17}/>Change</button><button type="button" disabled={busy} onClick={()=>exchange('confirm')}>Confirm</button></div></section>}
    {data?.state==='complete'&&<section className={styles.transactionBody} role="status"><div className={styles.completeIcon}><Check size={26}/></div><h2>{data.mode==='booking'?'Appointment request received':'Order recorded'}</h2><p>{data.outcome?.status==='pending_external'?'Awaiting provider confirmation.':data.mode==='order'?'Payment status is not confirmed here.':'Your booking was recorded.'}</p>{data.outcome?.orderId&&<p>Order reference: {data.outcome.orderId}</p>}{data.outcome?.reservationId&&<p>Reservation reference: {data.outcome.reservationId}</p>}</section>}
  </main>;
}
