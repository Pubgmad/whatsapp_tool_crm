'use client';
import { useEffect, useState } from 'react';
import { Plus, Save, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import './audience-segment-composer.css';

const TYPES = [
  ['permission', 'Permission'], ['tags', 'Tags'], ['source', 'Source'], ['last_active', 'Last active'],
  ['created', 'Created'], ['engagement', 'Campaign engagement'], ['attribute', 'Contact field'], ['purchase', 'Purchase']
];

function uid() { return crypto.randomUUID(); }
function condition(type = 'tags') {
  const defaults = {
    permission: { value: 'marketable' }, tags: { mode: 'any', values: '' }, source: { values: '' },
    last_active: { withinDays: '' }, created: { withinDays: '' },
    engagement: { campaignId: '', event: 'read', match: 'matched', withinDays: '' },
    attribute: { key: '', operator: 'equals', value: '' }, purchase: { value: 'purchased', withinDays: '' }
  };
  return { rowId: uid(), type, ...defaults[type] };
}
function group(operator = 'and', children = []) { return { rowId: uid(), type: 'group', operator, children }; }
function updateTree(node, id, change) {
  if (node.rowId === id) return change(node);
  if (node.type !== 'group') return node;
  return { ...node, children: node.children.map(child => updateTree(child, id, change)) };
}
function countNodes(node) { return 1 + (node.type === 'group' ? node.children.reduce((sum, child) => sum + countNodes(child), 0) : 0); }
function payload(node) {
  if (node.type === 'group') return { type: 'group', operator: node.operator, children: node.children.map(payload) };
  const result = { ...node }; delete result.rowId;
  if (['tags', 'source'].includes(node.type)) result.values = String(node.values || '').split(',').map(value => value.trim()).filter(Boolean);
  return result;
}

function ConditionFields({ node, campaigns, known, onChange }) {
  if (node.type === 'permission') return <label>Audience permission<select value={node.value} onChange={event=>onChange({value:event.target.value})}><option value="marketable">Marketable only</option><option value="blocked">Suppressed only</option><option value="all">All contacts</option></select></label>;
  if (node.type === 'tags') return <><label>Tags<input required value={node.values} onChange={event=>onChange({values:event.target.value})}/></label><label>Match<select value={node.mode} onChange={event=>onChange({mode:event.target.value})}><option value="any">Any</option><option value="all">All</option></select></label></>;
  if (node.type === 'source') return <label>Sources<input required value={node.values} onChange={event=>onChange({values:event.target.value})}/></label>;
  if (['last_active','created'].includes(node.type)) return <label>Within days<input required type="number" min={1} max={3650} value={node.withinDays} onChange={event=>onChange({withinDays:event.target.value})}/></label>;
  if (node.type === 'purchase') return <><label>Order match<select value={node.value} onChange={event=>onChange({value:event.target.value})}><option value="purchased">Has captured payment</option><option value="not_purchased">No captured payment</option></select></label><label>Within days (optional)<input type="number" min={1} max={3650} value={node.withinDays} onChange={event=>onChange({withinDays:event.target.value})}/></label></>;
  if (node.type === 'attribute') return <><label>Field key<input required maxLength={100} pattern="[a-zA-Z0-9_-]+" value={node.key} onChange={event=>onChange({key:event.target.value})}/></label><label>Operator<select value={node.operator} onChange={event=>onChange({operator:event.target.value})}>{[['equals','Equals'],['not_equals','Does not equal'],['contains','Contains'],['exists','Exists'],['missing','Missing']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>{!['exists','missing'].includes(node.operator)&&<label>Value<input required maxLength={2000} value={node.value} onChange={event=>onChange({value:event.target.value})}/></label>}</>;
  return <><label>Campaign<select required value={node.campaignId} onChange={event=>onChange({campaignId:event.target.value})}><option value="">Select campaign</option>{node.campaignId&&!campaigns.some(item=>item.id===node.campaignId)&&<option value={node.campaignId}>{known[node.campaignId]||node.campaignId}</option>}{campaigns.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Event<select value={node.event} onChange={event=>onChange({event:event.target.value})}>{['sent','delivered','read','replied','failed','clicked','flow_abandoned'].map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label><label>Match<select value={node.match} onChange={event=>onChange({match:event.target.value})}><option value="matched">Has event</option><option value="not_matched">Does not have event</option></select></label><label>Within days (optional)<input type="number" min={1} max={3650} value={node.withinDays} onChange={event=>onChange({withinDays:event.target.value})}/></label></>;
}

function RuleGroup({ node, depth, campaigns, known, edit, remove, total }) {
  const add = child => edit(node.rowId, current => ({ ...current, children: [...current.children, child] }));
  return <div className="audienceGroup">
    <div className="audienceGroupHeader"><strong>{depth===1?'Match contacts when':'Nested group'}</strong><select aria-label="Group operator" value={node.operator} onChange={event=>edit(node.rowId,current=>({...current,operator:event.target.value}))}><option value="and">All (AND)</option><option value="or">Any (OR)</option></select>{depth>1&&<button type="button" aria-label="Remove group" onClick={remove}><Trash2 size={16}/></button>}</div>
    <div className="audienceGroupChildren">{node.children.map(child => child.type==='group'
      ? <RuleGroup key={child.rowId} node={child} depth={depth+1} campaigns={campaigns} known={known} edit={edit} total={total} remove={()=>edit(node.rowId,current=>({...current,children:current.children.filter(item=>item.rowId!==child.rowId)}))}/>
      : <div className="audienceRule" key={child.rowId}><label>Condition<select value={child.type} onChange={event=>edit(child.rowId,()=>condition(event.target.value))}>{TYPES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><ConditionFields node={child} campaigns={campaigns} known={known} onChange={values=>edit(child.rowId,current=>({...current,...values}))}/><button type="button" aria-label="Remove condition" title="Remove condition" onClick={()=>edit(node.rowId,current=>({...current,children:current.children.filter(item=>item.rowId!==child.rowId)}))}><Trash2 size={16}/></button></div>)}</div>
    <div className="audienceButtons"><button type="button" disabled={node.children.length>=50||total>=100} onClick={()=>add(condition())}><Plus size={16}/>Condition</button><button type="button" disabled={depth>=4||node.children.length>=50||total>=100} onClick={()=>add(group('and',[condition()]))}><Plus size={16}/>Group</button></div>
  </div>;
}

export default function AudienceSegmentComposer({ api, postJson, onSaved }) {
  const [root, setRoot] = useState(()=>group('and',[condition('permission')]));
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
  function edit(id, change) { setRoot(current=>updateTree(current,id,change)); }
  async function save(event) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    setBusy(true); setError('');
    try {
      await postJson('/api/segments', { name: data.get('name'), description: data.get('description'), rules: { version: 2, root: payload(root) } });
      form.reset(); setRoot(group('and',[condition('permission')])); await onSaved();
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  return <form className="audienceComposer" onSubmit={save}>
    <fieldset disabled={busy}><legend>Audience details</legend><div className="audienceFields">
      <label>Name<input name="name" required maxLength={255}/></label><label>Description<input name="description" maxLength={2000}/></label>
    </div></fieldset>
    <fieldset disabled={busy}><legend>Campaign finder</legend><div className="audienceFields">
      <label>Find campaign<input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} maxLength={120}/></label>
      <div className="audienceButtons"><button type="button" title="Previous campaigns" aria-label="Previous campaigns" disabled={page===1} onClick={()=>setPage(page-1)}><ChevronLeft size={16}/></button><span>{page}</span><button type="button" title="Next campaigns" aria-label="Next campaigns" disabled={!hasMore} onClick={()=>setPage(page+1)}><ChevronRight size={16}/></button></div>
    </div></fieldset>
    <fieldset disabled={busy}><legend>Audience rules</legend><RuleGroup node={root} depth={1} campaigns={campaigns} known={known} edit={edit} total={countNodes(root)}/></fieldset>
    {error&&<p className="formError" role="alert">{error}</p>}<button className="primaryAction" disabled={busy}><Save size={18}/>{busy?'Saving':'Save segment'}</button>
  </form>;
}
