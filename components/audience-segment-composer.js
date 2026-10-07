'use client';
import { useEffect, useState } from 'react';
import { Plus, Save, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import './audience-segment-composer.css';

export default function AudienceSegmentComposer({ api, postJson, onSaved }) {
  const [engagement, setEngagement] = useState([]), [attributes, setAttributes] = useState([]);
  const [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [campaigns, setCampaigns] = useState([]), [known, setKnown] = useState({}), [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api('/api/segments/campaigns?' + new URLSearchParams({ search, page: String(page) })).then(result => {
        if (!active) return;
        setCampaigns(result.campaigns); setHasMore(result.hasMore);
        setKnown(current => ({ ...current, ...Object.fromEntries(result.campaigns.map(item => [item.id, item.name])) }));
      }).catch(cause => { if (active) setError(cause.message); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [api, search, page]);
  function change(setter, index, values) { setter(current => current.map((item, position) => position === index ? { ...item, ...values } : item)); }
  async function save(event) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    setBusy(true); setError('');
    try {
      await postJson('/api/segments', { name: data.get('name'), description: data.get('description'), rules: {
        permission: data.get('permission'), tagMode: data.get('tagMode'), tags: data.get('tags'), sources: data.get('sources'),
        lastActiveDays: data.get('lastActiveDays'), createdWithinDays: data.get('createdWithinDays'),
        engagementMode: data.get('engagementMode'), engagement, attributes,
        purchase: data.get('purchase'), purchaseWithinDays: data.get('purchaseWithinDays')
      } });
      form.reset(); setEngagement([]); setAttributes([]); await onSaved();
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  return <form className="audienceComposer" onSubmit={save}>
    <fieldset disabled={busy}><legend>Audience details</legend><div className="audienceFields">
      <label>Name<input name="name" required maxLength={255}/></label><label>Description<input name="description" maxLength={2000}/></label>
      <label>Permission<select name="permission" defaultValue="marketable"><option value="marketable">Marketable only</option><option value="blocked">Suppressed only</option><option value="all">All contacts</option></select></label>
      <label>Tags<input name="tags"/></label><label>Tag match<select name="tagMode"><option value="any">Any tag</option><option value="all">All tags</option></select></label>
      <label>Sources<input name="sources"/></label><label>Active within days<input name="lastActiveDays" type="number" min={1} max={3650}/></label><label>Created within days<input name="createdWithinDays" type="number" min={1} max={3650}/></label>
    </div></fieldset>
    <fieldset disabled={busy}><legend>Campaign engagement</legend><div className="audienceFields">
      <label>Condition match<select name="engagementMode"><option value="all">All conditions</option><option value="any">Any condition</option></select></label>
      <label>Find campaign<input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} maxLength={120}/></label>
      <div className="audienceButtons"><button type="button" title="Previous campaigns" aria-label="Previous campaigns" disabled={page===1} onClick={()=>setPage(page-1)}><ChevronLeft size={16}/></button><span>{page}</span><button type="button" title="Next campaigns" aria-label="Next campaigns" disabled={!hasMore} onClick={()=>setPage(page+1)}><ChevronRight size={16}/></button></div>
    </div>
    {engagement.map((rule,index)=><div className="audienceRule" key={rule.rowId}>
      <label>Campaign<select required value={rule.campaignId} onChange={event=>change(setEngagement,index,{campaignId:event.target.value})}><option value="">Select campaign</option>{rule.campaignId&&!campaigns.some(item=>item.id===rule.campaignId)&&<option value={rule.campaignId}>{known[rule.campaignId]||rule.campaignId}</option>}{campaigns.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Event<select value={rule.event} onChange={event=>change(setEngagement,index,{event:event.target.value})}>{['sent','delivered','read','replied','failed','clicked','flow_abandoned'].map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>
      <label>Match<select value={rule.match} onChange={event=>change(setEngagement,index,{match:event.target.value})}><option value="matched">Has event</option><option value="not_matched">Does not have event</option></select></label>
      <label>{rule.event==='replied'?'Reply within days':rule.event==='failed'?'Failure within days':'Sent within days'}<input type="number" min={1} max={3650} value={rule.withinDays} onChange={event=>change(setEngagement,index,{withinDays:event.target.value})}/></label>
      <button type="button" aria-label="Remove engagement condition" title="Remove engagement condition" onClick={()=>setEngagement(current=>current.filter((_,position)=>position!==index))}><Trash2 size={16}/></button>
    </div>)}
    <button type="button" disabled={engagement.length>=10} onClick={()=>setEngagement(current=>[...current,{rowId:crypto.randomUUID(),campaignId:'',event:'read',match:'matched',withinDays:''}])}><Plus size={16}/>Engagement condition</button></fieldset>
    <fieldset disabled={busy}><legend>Contact fields</legend>{attributes.map((rule,index)=><div className="audienceRule" key={rule.rowId}>
      <label>Field key<input required maxLength={100} pattern="[a-zA-Z0-9_-]+" value={rule.key} onChange={event=>change(setAttributes,index,{key:event.target.value})}/></label>
      <label>Operator<select value={rule.operator} onChange={event=>change(setAttributes,index,{operator:event.target.value})}>{[['equals','Equals'],['not_equals','Does not equal'],['contains','Contains'],['exists','Exists'],['missing','Missing']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {!['exists','missing'].includes(rule.operator)&&<label>Value<input maxLength={2000} value={rule.value} onChange={event=>change(setAttributes,index,{value:event.target.value})}/></label>}
      <button type="button" aria-label="Remove field condition" title="Remove field condition" onClick={()=>setAttributes(current=>current.filter((_,position)=>position!==index))}><Trash2 size={16}/></button>
    </div>)}<button type="button" disabled={attributes.length>=20} onClick={()=>setAttributes(current=>[...current,{rowId:crypto.randomUUID(),key:'',operator:'equals',value:''}])}><Plus size={16}/>Field condition</button></fieldset>
    <fieldset disabled={busy}><legend>Recorded purchases</legend><div className="audienceFields"><label>Paid orders<select name="purchase"><option value="all">No filter</option><option value="purchased">Has captured payment</option><option value="not_purchased">Exclude captured payments</option></select></label><label>Payment within days<input name="purchaseWithinDays" type="number" min={1} max={3650}/></label></div></fieldset>
    {error&&<p className="formError" role="alert">{error}</p>}<button className="primaryAction" disabled={busy}><Save size={18}/>{busy?'Saving':'Save segment'}</button>
  </form>;
}
