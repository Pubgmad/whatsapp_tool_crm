'use client';
import {useEffect,useState} from 'react';
import {BarChart3,ChevronLeft,ChevronRight} from 'lucide-react';
import JourneyReportPanel from './journey-report-panel';
import './whatsapp-modules.css';

function defaultRange(){
  const until=new Date();
  const since=new Date(until.getTime()-29*86400000);
  const iso=(value)=>value.toISOString().slice(0,10);
  return {since:iso(since),until:iso(until)};
}

export default function WhatsAppJourneyAnalytics({api}){
  const [range,setRange]=useState(defaultRange),[data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[page,setPage]=useState(1);
  async function load(nextPage=page){
    setBusy(true);setError('');
    try{
      const result=await api('/api/whatsapp/journey-analytics?'+new URLSearchParams({...range,page:String(nextPage)}));
      setData(result);
      setPage(result.page||nextPage);
    }catch(cause){setError(cause.message);}
    finally{setBusy(false);}
  }
  useEffect(()=>{load(1);},[api]);
  const kpis=data?.kpis;
  return <><JourneyReportPanel api={api}/><section className="wa-module"><h2>Customer journey analytics</h2>
    <p className="wa-module-note">Live workspace metrics from campaigns, orders, inbox activity, contacts, and calling — filtered by the date range below.</p>
    <form onSubmit={event=>{event.preventDefault();load(1);}}><div className="wa-module-controls"><label>From<input required type="date" value={range.since} onChange={event=>setRange({...range,since:event.target.value})}/></label><label>Until<input required type="date" value={range.until} onChange={event=>setRange({...range,until:event.target.value})}/></label><button disabled={busy}><BarChart3 size={16}/>Refresh report</button></div></form>
    {error&&<p role="alert" className="wa-module-error">{error}</p>}
    {busy&&!data&&<p role="status">Loading analytics…</p>}
    {data&&<>
    {kpis&&<div className="saasKpiGrid" role="group" aria-label="Analytics summary">
      <article className="saasKpi"><span>Sent</span><strong>{kpis.campaigns}</strong></article>
      <article className="saasKpi"><span>Delivered</span><strong>{kpis.delivered}</strong></article>
      <article className="saasKpi"><span>Replies</span><strong>{kpis.replied}</strong></article>
      <article className="saasKpi"><span>Orders</span><strong>{kpis.orders}</strong></article>
      <article className="saasKpi"><span>Paid orders</span><strong>{kpis.paidOrders}</strong></article>
      <article className="saasKpi"><span>Calls</span><strong>{kpis.calls}</strong></article>
      <article className="saasKpi"><span>Open inbox</span><strong>{kpis.inbox?.open_conversations||0}</strong></article>
      <article className="saasKpi"><span>New contacts</span><strong>{kpis.contacts?.new_in_range||0}</strong></article>
    </div>}
    <h3>Inbox activity</h3><div className="wa-module-table"><table><thead><tr><th>Open</th><th>Closed</th><th>Unassigned open</th><th>Active in range</th></tr></thead><tbody><tr><td>{data.inbox?.open_conversations||0}</td><td>{data.inbox?.closed_conversations||0}</td><td>{data.inbox?.unassigned_open||0}</td><td>{data.inbox?.active_in_range||0}</td></tr></tbody></table></div>
    <h3>Contacts</h3><div className="wa-module-table"><table><thead><tr><th>Total</th><th>New in range</th><th>Unsubscribed</th></tr></thead><tbody><tr><td>{data.contacts?.total||0}</td><td>{data.contacts?.new_in_range||0}</td><td>{data.contacts?.unsubscribed||0}</td></tr></tbody></table></div>
    <h3>Orders and recorded payments</h3><div className="wa-module-table"><table><thead><tr><th>Currency</th><th>Orders</th><th>Order value</th><th>Paid orders</th><th>Captured value</th></tr></thead><tbody>{(data.summary||[]).map(row=><tr key={row.currency}><td>{row.currency}</td><td>{row.orders}</td><td>{row.order_value}</td><td>{row.paid_orders}</td><td>{row.captured_value}</td></tr>)}</tbody></table></div>
    {!data.summary?.length&&<p className="wa-module-note">No orders recorded in this range.</p>}
    {data.marketingMessages&&!data.marketingMessages.ready&&<p role="status" className="wa-module-note">Marketing Messages API: {data.marketingMessages.message}</p>}
    <h3>Delivery API mix</h3><div className="wa-module-table"><table><thead><tr><th>Delivery method</th><th>Campaigns</th><th>Recipients</th></tr></thead><tbody>{(data.deliveryMix||[]).map(row=><tr key={row.delivery_method}><td>{row.delivery_method}</td><td>{row.campaigns}</td><td>{row.recipients}</td></tr>)}</tbody></table></div>
    <h3>Campaign delivery and replies</h3><div className="wa-module-table"><table><thead><tr><th>Campaign</th><th>Recipients</th><th>Sent</th><th>Delivered</th><th>Read</th><th>Clicked</th><th>Replied</th><th>Failed</th></tr></thead><tbody>{data.campaigns.map(row=><tr key={row.id}><td>{row.name}</td><td>{row.recipients}</td><td>{row.sent}</td><td>{row.delivered}</td><td>{row.read}</td><td>{row.clicked}</td><td>{row.replied}</td><td>{row.failed}</td></tr>)}</tbody></table></div>
    {!data.campaigns.length&&<p className="wa-module-note">No campaigns in this range.</p>}
    <h3>Order journeys</h3><div className="wa-module-table"><table><thead><tr><th>Order</th><th>Contact</th><th>Linked campaign</th><th>Attribution</th><th>Payment</th><th>Fulfillment</th><th>Value</th></tr></thead><tbody>{data.orders.map(row=><tr key={row.id}><td>{row.id}<small>{row.conversation_id||'Conversation link unavailable'}</small></td><td>{row.contact_name||row.customer_phone}</td><td>{row.campaign_name||'No recorded campaign link'}</td><td title={row.attributionLabel}>{row.attributionLevel}</td><td>{row.payment_status}</td><td>{row.fulfillment_status}</td><td>{row.currency} {row.total_amount}</td></tr>)}</tbody></table></div>
    <h3>Calling outcomes</h3><div className="wa-module-table"><table><thead><tr><th>Direction</th><th>Status</th><th>Calls</th></tr></thead><tbody>{data.calls.map(row=><tr key={row.direction+row.status}><td>{row.direction}</td><td>{row.status}</td><td>{row.count}</td></tr>)}</tbody></table></div>
    {!data.calls.length&&<p className="wa-module-note">No calling events in this range.</p>}
    <footer className="wa-module-controls"><button type="button" title="Previous report page" aria-label="Previous report page" disabled={busy||data.page===1} onClick={()=>load(data.page-1)}><ChevronLeft size={16}/></button><span>Page {data.page}</span><button type="button" title="Next report page" aria-label="Next report page" disabled={busy||!data.hasMore} onClick={()=>load(data.page+1)}><ChevronRight size={16}/></button></footer>
  </>}</section></>;
}
