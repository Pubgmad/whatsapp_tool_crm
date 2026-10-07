'use client';

import { useEffect, useState } from 'react';
import { Bot, Plus, RefreshCcw, Trash2 } from 'lucide-react';
import './whatsapp-modules.css';
import './ai-support-settings.css';
import HonestLimitsCallout from './honest-limits-callout';

export default function AiSupportSettings({ api, postJson, uploadForm, role }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [instructions, setInstructions] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [allowCrmContext, setAllowCrmContext] = useState(false);
  const [autoReplyEnabled,setAutoReplyEnabled]=useState(false);
  const [autoReplyDailyLimit,setAutoReplyDailyLimit]=useState(0);
  const [actionProposalsEnabled,setActionProposalsEnabled]=useState(false);
  const [actionAttributeKeys,setActionAttributeKeys]=useState('');
  const [bookingFlowId,setBookingFlowId]=useState('');
  const [bookingInviteText,setBookingInviteText]=useState('');
  const [bookingInviteCta,setBookingInviteCta]=useState('');
  const [intentRoutingEnabled,setIntentRoutingEnabled]=useState(false);
  const [intentRoutes,setIntentRoutes]=useState({support:'',booking:'',order:'',crm:''});
  const [actionAutonomousEnabled,setActionAutonomousEnabled]=useState(false);
  const [dialogflowEnabled,setDialogflowEnabled]=useState(false);
  const [dialogflowAgentId,setDialogflowAgentId]=useState('');
  const [dialogflowLocation,setDialogflowLocation]=useState('global');
  const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [active, setActive] = useState(true);
  const [importTitle,setImportTitle]=useState('');
  const [importUrl,setImportUrl]=useState('');
  const [importFile,setImportFile]=useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canEdit = role === 'Owner';
  const load = async nextPage => {
    const result = await api(`/api/ai-agent?page=${nextPage}`);
    setData(result);
    setPage(nextPage);
    setInstructions(result.settings.instructions || '');
    setEnabled(Boolean(result.settings.enabled));
    setAllowCrmContext(Boolean(result.settings.allow_crm_context));
    setAutoReplyEnabled(Boolean(result.settings.auto_reply_enabled));setAutoReplyDailyLimit(Number(result.settings.auto_reply_daily_limit||0));
    setActionProposalsEnabled(Boolean(result.settings.action_proposals_enabled));setActionAutonomousEnabled(Boolean(result.settings.action_autonomous_enabled));setActionAttributeKeys((result.settings.action_attribute_keys||[]).join(', '));setBookingFlowId(result.settings.booking_flow_id||'');setBookingInviteText(result.settings.booking_invite_text||'');setBookingInviteCta(result.settings.booking_invite_cta||'');setIntentRoutingEnabled(Boolean(result.settings.intent_routing_enabled));setIntentRoutes({support:result.settings.intent_routes?.support||'',booking:result.settings.intent_routes?.booking||'',order:result.settings.intent_routes?.order||'',crm:result.settings.intent_routes?.crm||''});setDialogflowEnabled(Boolean(result.settings.dialogflow_enabled));setDialogflowAgentId(result.settings.dialogflow_agent_id||'');setDialogflowLocation(result.settings.dialogflow_location||'global');
  };
  useEffect(() => { let activeView = true; api('/api/ai-agent?page=1').then(result => {
    if (!activeView) return;
    setData(result); setInstructions(result.settings.instructions || ''); setEnabled(Boolean(result.settings.enabled)); setAllowCrmContext(Boolean(result.settings.allow_crm_context));setAutoReplyEnabled(Boolean(result.settings.auto_reply_enabled));setAutoReplyDailyLimit(Number(result.settings.auto_reply_daily_limit||0));setActionProposalsEnabled(Boolean(result.settings.action_proposals_enabled));setActionAttributeKeys((result.settings.action_attribute_keys||[]).join(', '));setBookingFlowId(result.settings.booking_flow_id||'');setBookingInviteText(result.settings.booking_invite_text||'');setBookingInviteCta(result.settings.booking_invite_cta||'');
  }).catch(cause => { if (activeView) setError(cause.message); }); return () => { activeView = false; }; }, [api]);
  const run = async (work, message, nextPage = page) => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); await load(nextPage); setNotice(message); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  };
  const edit = item => { setEditing(item.id); setTitle(item.title); setContent(item.content); setActive(item.is_active); };
  const clear = () => { setEditing(null); setTitle(''); setContent(''); setActive(true); };
  return <section className="wa-module aiSupportSettings">
    <header className="wa-module-heading"><h2><Bot size={19} /> Support assistant</h2><button type="button" title="Refresh assistant" aria-label="Refresh assistant" onClick={() => run(() => Promise.resolve(), 'Updated')} disabled={busy}><RefreshCcw size={18} /></button></header>
    {error && <p className="wa-module-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!data && !error && <p role="status">Loading assistant...</p>}
    {data && <>
      <p role="status">AI suggestions today: {data.usage.requests} / {data.usage.limit}</p>
      <p role="status">Automatic replies today: {data.autoReply?.sent??0} / {autoReplyDailyLimit}{data.autoReply?.unknown?` (${data.autoReply.unknown} need manual verification)`:''}</p>
      <HonestLimitsCallout limitId="ai_safety_eval" compact />
      {data.safety && <section aria-label="AI safety and abuse monitoring"><h3>Safety &amp; abuse (24h)</h3><p role="status">Blocked: {data.safety.last24h.blocked} · injection attempts: {data.safety.last24h.injection} · autonomous denials: {data.safety.last24h.autonomousDenied}</p>{data.safety.recent.length>0&&<ul>{data.safety.recent.slice(0,8).map(item=><li key={item.id}><small>{item.event_kind}</small> {item.detail||item.source}</li>)}</ul>}</section>}
      {canEdit&&!!data.unknownReplies?.length&&<div role="alert"><strong>Verify these replies in Meta before responding again</strong>{data.unknownReplies.map(item=><div key={item.inbound_message_id} className="aiSupportActions"><a href={'/app/inbox/'+encodeURIComponent(item.conversation_id)}>{item.conversation_id}</a><span>{item.last_error||'Delivery unconfirmed'}</span><button type="button" disabled={busy} onClick={()=>{if(window.confirm('Did you confirm in Meta that this reply was sent?'))run(()=>postJson('/api/ai-agent',{action:'resolve_unknown',inboundMessageId:item.inbound_message_id,resolution:'sent'}),'Review recorded');}}>Sent</button><button type="button" disabled={busy} onClick={()=>{if(window.confirm('Did you confirm in Meta that this reply was not sent?'))run(()=>postJson('/api/ai-agent',{action:'resolve_unknown',inboundMessageId:item.inbound_message_id,resolution:'not_sent'}),'Review recorded');}}>Not sent</button></div>)}</div>}
      <form className="aiSupportForm" onSubmit={event => { event.preventDefault(); run(() => postJson('/api/ai-agent', { action: 'configure', enabled, allowCrmContext, autoReplyEnabled,autoReplyDailyLimit,instructions,actionProposalsEnabled,actionAutonomousEnabled,actionAttributeKeys:actionAttributeKeys.split(',').map(key=>key.trim()).filter(Boolean),bookingFlowId,bookingInviteText,bookingInviteCta,intentRoutingEnabled,intentRoutes:Object.fromEntries(Object.entries(intentRoutes).filter(([,value])=>value)),dialogflowEnabled,dialogflowAgentId,dialogflowLocation }), 'Assistant settings saved'); }}>
        <label>Instructions<textarea rows="4" maxLength={4000} value={instructions} onChange={event => setInstructions(event.target.value)} disabled={!canEdit} /></label>
        <label className="aiSupportToggle"><input type="checkbox" checked={enabled} onChange={event => {setEnabled(event.target.checked);if(!event.target.checked){setAutoReplyEnabled(false);setActionProposalsEnabled(false);}}} disabled={!canEdit || !data.available} />Enable suggestions</label>
        <label className="aiSupportToggle"><input type="checkbox" checked={allowCrmContext} onChange={event => setAllowCrmContext(event.target.checked)} disabled={!canEdit} />Use this contact's order and booking status in suggestions</label>
        <label className="aiSupportToggle"><input type="checkbox" checked={autoReplyEnabled} onChange={event=>{setAutoReplyEnabled(event.target.checked);if(!event.target.checked)setActionProposalsEnabled(false);if(event.target.checked&&autoReplyDailyLimit<1)setAutoReplyDailyLimit(1);}} disabled={!canEdit||!enabled||!data.available}/>Automatically reply to unassigned text conversations when a source supports the answer</label>
        <label>Maximum automatic replies per day<input type="number" min={autoReplyEnabled?1:0} max="10000" required value={autoReplyDailyLimit} onChange={event=>setAutoReplyDailyLimit(Number(event.target.value))} disabled={!canEdit}/></label>
        <label className="aiSupportToggle"><input type="checkbox" checked={actionProposalsEnabled} onChange={event=>{setActionProposalsEnabled(event.target.checked);if(!event.target.checked)setActionAutonomousEnabled(false);}} disabled={!canEdit||!enabled||!autoReplyEnabled}/>Queue customer-requested CRM actions for owner review</label>
        <label className="aiSupportToggle"><input type="checkbox" checked={actionAutonomousEnabled} onChange={event=>setActionAutonomousEnabled(event.target.checked)} disabled={!canEdit||!actionProposalsEnabled}/>Auto-execute approved action types after AI proposes them (same safety checks as owner approval)</label>
        <p className="wa-module-note">Autonomous actions also require Super Admin platform setting <strong>Autonomous AI actions</strong> or env <code>AI_AUTONOMOUS_ACTIONS_ENABLED=true</code>. There is no general AI tool access to arbitrary APIs.</p>
        <label className="aiSupportToggle"><input type="checkbox" checked={dialogflowEnabled} onChange={event=>setDialogflowEnabled(event.target.checked)} disabled={!canEdit||!autoReplyEnabled||!data.dialogflowAvailable}/>Use Dialogflow CX for WhatsApp auto-replies when configured</label>
        {dialogflowEnabled&&<><label>Dialogflow CX agent ID<input required pattern="[a-zA-Z0-9_-]{10,80}" value={dialogflowAgentId} onChange={event=>setDialogflowAgentId(event.target.value)} disabled={!canEdit}/></label><label>Dialogflow location<input required pattern="[a-z0-9-]+" value={dialogflowLocation} onChange={event=>setDialogflowLocation(event.target.value)} disabled={!canEdit}/></label></>}
        <label>Permitted contact attributes (comma separated)<input value={actionAttributeKeys} onChange={event=>setActionAttributeKeys(event.target.value)} disabled={!canEdit} placeholder="preferred_location, product_interest" /></label>
        <label>Booking Flow<select value={bookingFlowId} onChange={event=>setBookingFlowId(event.target.value)} disabled={!canEdit}><option value="">No booking Flow</option>{(data.flows||[]).map(flow=><option key={flow.id} value={flow.id}>{flow.name}</option>)}</select></label>
        {bookingFlowId&&<><label>Booking invitation text<input value={bookingInviteText} maxLength={1024} onChange={event=>setBookingInviteText(event.target.value)} disabled={!canEdit} required /></label><label>Booking button label<input value={bookingInviteCta} maxLength={20} onChange={event=>setBookingInviteCta(event.target.value)} disabled={!canEdit} required /></label></>}
        <label className="aiSupportToggle"><input type="checkbox" checked={intentRoutingEnabled} onChange={event=>setIntentRoutingEnabled(event.target.checked)} disabled={!canEdit||!autoReplyEnabled}/>Route handoffs to team members by AI intent</label>
        {intentRoutingEnabled&&<div className="aiSupportForm">{['support','booking','order','crm'].map(intent=><label key={intent}>{intent} intent<select value={intentRoutes[intent]} onChange={event=>setIntentRoutes({...intentRoutes,[intent]:event.target.value})} disabled={!canEdit}><option value="">Unassigned</option>{(data.teamMembers||[]).map(member=><option key={member.user_id} value={member.user_id}>{member.name}</option>)}</select></label>)}</div>}
        {autoReplyEnabled&&<p role="status">AI will not take payments or confirm bookings. Requested actions require owner approval; unconfirmed sends need a human check.</p>}
        {!data.available && <p>OpenAI is not configured by the platform administrator.</p>}
        {canEdit && <button type="submit" disabled={busy}>Save settings</button>}
      </form>
      {canEdit&&<><h3>Action review</h3>{!(data.proposals||[]).length&&<p>No actions awaiting review.</p>}{(data.proposals||[]).map(item=><article key={item.id} className="aiSupportProposal"><strong>{item.contact_name||'Contact'}: {item.action_type.replaceAll('_',' ')}</strong><p>{item.reason}</p><pre>{JSON.stringify(item.arguments,null,2)}</pre><a href={'/app/inbox/'+encodeURIComponent(item.conversation_id)}>Review conversation</a>{item.status==='pending'?<div className="aiSupportActions"><button type="button" disabled={busy} onClick={()=>{if(window.confirm('Approve this exact action after reviewing the conversation?'))run(()=>postJson('/api/ai-agent',{action:'review_action',proposalId:item.id,decision:'approve'}),'Action reviewed');}}>Approve</button><button type="button" disabled={busy} onClick={()=>run(()=>postJson('/api/ai-agent',{action:'review_action',proposalId:item.id,decision:'reject'}),'Action rejected')}>Reject</button></div>:<div role="alert"><p>Delivery outcome unknown. Check Meta before sending again.</p><div className="aiSupportActions"><button type="button" disabled={busy} onClick={()=>{if(window.confirm('Did you verify in Meta that this Flow was sent?'))run(()=>postJson('/api/ai-agent',{action:'resolve_action',proposalId:item.id,resolution:'sent'}),'Delivery recorded');}}>Sent</button><button type="button" disabled={busy} onClick={()=>{if(window.confirm('Did you verify in Meta that this Flow was not sent?'))run(()=>postJson('/api/ai-agent',{action:'resolve_action',proposalId:item.id,resolution:'not_sent'}),'Delivery recorded');}}>Not sent</button></div></div>}</article>)}</>}
      <h3>Knowledge</h3>
      {canEdit&&<form className="aiSupportForm" onSubmit={event=>{event.preventDefault();const formElement=event.currentTarget;const form=new FormData();form.set('title',importTitle);if(importUrl.trim())form.set('url',importUrl.trim());else if(importFile)form.set('file',importFile);run(async()=>{await uploadForm('/api/ai-agent/import',form);setImportTitle('');setImportUrl('');setImportFile(null);formElement.reset();},'Source imported for review',1);}}><label>Import title<input required maxLength={120} value={importTitle} onChange={event=>setImportTitle(event.target.value)}/></label><label>Website URL<input type="url" value={importUrl} onChange={event=>{setImportUrl(event.target.value);setImportFile(null);}} disabled={Boolean(importFile)} placeholder="https://"/></label><label>Or document (TXT, Markdown, HTML, DOCX, PDF; 2 MB max)<input type="file" accept=".txt,.md,.html,.docx,.pdf" onChange={event=>{setImportFile(event.target.files?.[0]||null);setImportUrl('');}} disabled={Boolean(importUrl)}/></label><button type="submit" disabled={busy||!importTitle.trim()||(!importUrl.trim()&&!importFile)}>Import inactive source</button></form>}
      {canEdit && <form className="aiSupportForm" onSubmit={event => { event.preventDefault(); run(async () => { await postJson('/api/ai-agent', { action: 'save_knowledge', id: editing || undefined, title, content, isActive: active }); clear(); }, 'Knowledge saved', 1); }}>
        <label>Title<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label>Content<textarea required rows="6" maxLength={12000} value={content} onChange={event => setContent(event.target.value)} /></label>
        <label className="aiSupportToggle"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />Active</label>
        <div className="aiSupportActions"><button type="submit" disabled={busy}><Plus size={16} />{editing ? 'Update knowledge' : 'Add knowledge'}</button>{editing && <button type="button" onClick={clear}>Cancel</button>}</div>
      </form>}
      <div className="aiSupportDocuments">{data.knowledge.map(item => <article key={item.id}><div><strong>{item.title}</strong><small>{item.is_active ? 'Active' : 'Inactive'}</small></div><p>{item.content}</p>{canEdit && <div className="aiSupportActions"><button type="button" onClick={() => edit(item)} disabled={busy}>Edit</button><button type="button" title="Remove knowledge" aria-label={`Remove ${item.title}`} onClick={() => { if (window.confirm(`Remove ${item.title}?`)) run(() => postJson('/api/ai-agent', { action: 'remove_knowledge', id: item.id }), 'Knowledge removed'); }} disabled={busy}><Trash2 size={16} /></button></div>}</article>)}</div>
      {!data.knowledge.length && <p>No knowledge added.</p>}
      <div className="aiSupportActions"><button type="button" onClick={() => run(() => Promise.resolve(), 'Updated', page - 1)} disabled={busy || page <= 1}>Previous</button><span>Page {page}</span><button type="button" onClick={() => run(() => Promise.resolve(), 'Updated', page + 1)} disabled={busy || !data.hasMore}>Next</button></div>
    </>}
  </section>;
}
