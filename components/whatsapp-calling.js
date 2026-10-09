"use client";
import {useEffect,useRef,useState} from 'react';
import {Phone,PhoneOff,Mic,MicOff,RefreshCcw,ChevronLeft,ChevronRight,Volume2} from 'lucide-react';
import CallingHoursSettings from './calling-hours-settings.js';
import './whatsapp-modules.css';

async function iceComplete(peer){
  if(peer.iceGatheringState==='complete')return;
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{peer.removeEventListener('icegatheringstatechange',check);reject(new Error('Audio relay negotiation timed out.'));},15000);
    const check=()=>{if(peer.iceGatheringState==='complete'){clearTimeout(timeout);peer.removeEventListener('icegatheringstatechange',check);resolve();}};
    peer.addEventListener('icegatheringstatechange',check);
  });
}
export default function WhatsAppCalling({api,postJson,role}){
  const [data,setData]=useState(null),[phoneId,setPhoneId]=useState(''),[contactId,setContactId]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1),[busy,setBusy]=useState(false),[error,setError]=useState(''),[liveId,setLiveId]=useState(''),[muted,setMuted]=useState(false),[permission,setPermission]=useState(null),[settings,setSettings]=useState(null);
  const peerRef=useRef(null),streamRef=useRef(null),audioRef=useRef(null),answerRef=useRef(''),generation=useRef(0),liveRef=useRef('');
  const [permissionMessage,setPermissionMessage]=useState('');
  const [policy,setPolicy]=useState(null);
  const canCall=data?.access?.canCall===true;
  liveRef.current=liveId;
  const cleanup=()=>{liveRef.current='';generation.current++;peerRef.current?.close();peerRef.current=null;streamRef.current?.getTracks().forEach(track=>track.stop());streamRef.current=null;answerRef.current='';if(audioRef.current)audioRef.current.srcObject=null;setLiveId('');setMuted(false);};
  const callingUrl='/api/whatsapp/calling?page='+page+'&phoneId='+encodeURIComponent(phoneId)+'&search='+encodeURIComponent(search)+'&callId='+encodeURIComponent(liveId);
  const load=async()=>{const result=await api(callingUrl);setData(result);setPhoneId(current=>current||result.phones[0]?.phone_number_id||'');};
  useEffect(()=>{let cancelled=false;const refresh=async()=>{try{const result=await api(callingUrl);if(!cancelled){setData(result);setPhoneId(current=>current||result.phones[0]?.phone_number_id||'');}}catch(e){if(!cancelled)setError(e.message);}};refresh();const interval=setInterval(()=>{if(document.visibilityState==='visible')refresh();},3000);return()=>{cancelled=true;clearInterval(interval);};},[api,callingUrl]);
  useEffect(()=>{setContactId('');setPermission(null);},[phoneId]);
  useEffect(()=>{if(data&&!data.contacts.some(contact=>contact.id===contactId)){setContactId('');setPermission(null);}},[data,contactId]);
  useEffect(()=>{
    const leave=()=>{if(liveRef.current){const callId=liveRef.current;liveRef.current='';api('/api/whatsapp/calling',{method:'POST',body:JSON.stringify({action:'terminate',callId}),keepalive:true}).catch(()=>{});}generation.current++;peerRef.current?.close();streamRef.current?.getTracks().forEach(t=>t.stop());};
    window.addEventListener('pagehide',leave);
    return()=>{window.removeEventListener('pagehide',leave);leave();};
  },[api]);
  useEffect(()=>{
    const call=data?.selectedCall||data?.calls.find(item=>item.id===liveId);
    if(!call)return;
    if(['terminated','rejected','failed'].includes(call.status)){cleanup();return;}
    if(call.remote_session?.sdp_type==='answer'&&peerRef.current?.signalingState==='have-local-offer'&&answerRef.current!==call.remote_session.sdp){answerRef.current=call.remote_session.sdp;peerRef.current.setRemoteDescription({type:'answer',sdp:call.remote_session.sdp}).catch(e=>setError(e.message));}
  },[data,liveId]);
  const perform=async fn=>{setBusy(true);setError('');try{await fn();await load();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const audioPeer=async()=>{
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection)throw new Error('Calling requires a secure browser with microphone and WebRTC support.');
    const ice=await api('/api/whatsapp/calling?action=ice');
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
    streamRef.current=stream;
    const peer=new RTCPeerConnection({iceServers:ice.iceServers,iceTransportPolicy:'relay'});peerRef.current=peer;
    stream.getTracks().forEach(track=>{track.enabled=false;peer.addTrack(track,stream);});
    for(const transceiver of peer.getTransceivers()){
      const codecs=RTCRtpSender.getCapabilities?.('audio')?.codecs?.filter(codec=>codec.mimeType.toLowerCase()==='audio/opus');
      if(codecs?.length&&transceiver.setCodecPreferences)transceiver.setCodecPreferences(codecs);
    }
    peer.ontrack=event=>{if(audioRef.current){audioRef.current.srcObject=event.streams[0]||new MediaStream([event.track]);audioRef.current.play().catch(()=>setError('Press the speaker button to enable call audio.'));}};
    peer.onconnectionstatechange=()=>{if(peer.connectionState==='failed')setError('Audio connection failed. End the call before trying again.');};
    return peer;
  };
  const start=()=>perform(async()=>{
    const requestId=crypto.randomUUID();
    try{const peer=await audioPeer();await peer.setLocalDescription(await peer.createOffer());await iceComplete(peer);setLiveId(requestId);const result=await postJson('/api/whatsapp/calling',{action:'connect',phoneId,contactId,requestId,session:{sdp_type:'offer',sdp:peer.localDescription.sdp}});if(result.duplicate)throw new Error('This call reference has already been used.');streamRef.current?.getTracks().forEach(t=>t.enabled=true);}catch(e){if(!peerRef.current?.localDescription||(e.code&&e.code!=='CALL_UNCONFIRMED'))cleanup();throw e;}
  });
  const answer=call=>perform(async()=>{
    try{const peer=await audioPeer();await peer.setRemoteDescription({type:'offer',sdp:call.remote_session.sdp});await peer.setLocalDescription(await peer.createAnswer());await iceComplete(peer);setLiveId(call.id);await postJson('/api/whatsapp/calling',{action:'accept',callId:call.id,session:{sdp_type:'answer',sdp:peer.localDescription.sdp}});streamRef.current?.getTracks().forEach(t=>t.enabled=true);}catch(e){if(!peerRef.current?.localDescription||(e.code&&e.code!=='CALL_UNCONFIRMED'))cleanup();throw e;}
  });
  const end=call=>perform(async()=>{await postJson('/api/whatsapp/calling',{action:call.direction==='USER_INITIATED'&&call.status==='ringing'?'reject':'terminate',callId:call.id});if(call.id===liveId)cleanup();});
  const toggleMute=()=>{streamRef.current?.getAudioTracks().forEach(t=>t.enabled=muted);setMuted(!muted);};
  return <section className="wa-module"><header className="wa-module-heading"><h2>WhatsApp Calls</h2><button type="button" title="Refresh calls" aria-label="Refresh calls" onClick={()=>perform(load)} disabled={busy}><RefreshCcw size={18}/></button></header>
    {error&&<p role="alert" className="wa-module-error">{error}</p>}
    <audio ref={audioRef} autoPlay/>
    <div className="wa-module-controls"><label>Agent availability<select disabled={busy} value={data?.availability||'offline'} onChange={event=>perform(()=>postJson('/api/team/members/'+data.userId,{availability:event.target.value},'PATCH'))}><option value="available">Available</option><option value="away">Away</option><option value="offline">Offline</option></select></label></div>
    <details><summary>Missed call follow-ups ({data?.followups?.length||0})</summary>{data?.followups?.map(call=><form key={call.id} onSubmit={event=>{event.preventDefault();const note=new FormData(event.currentTarget).get('note');perform(()=>postJson('/api/whatsapp/calling',{action:'followup',callId:call.id,status:'resolved',note}));}}><strong>{call.remote_number}</strong><small>{new Date(call.created_at).toLocaleString()}</small><label>Follow-up note<textarea name="note" required maxLength={2000} defaultValue={call.followup_note}/></label><button disabled={!canCall||busy}>Resolve follow-up</button></form>)}</details>
    <div className="wa-module-controls"><label>Business number<select value={phoneId} onChange={e=>{setPhoneId(e.target.value);setContactId('');setPermission(null);setSettings(null);}}><option value="">Select number</option>{data?.phones.map(p=><option key={p.phone_number_id} value={p.phone_number_id}>{p.verified_name} {p.display_phone_number}</option>)}</select></label><label>Find contact<input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} type="search"/></label><label>Contact<select value={contactId} onChange={e=>{setContactId(e.target.value);setPermission(null);}}><option value="">Select contact</option>{data?.contacts.map(c=><option key={c.id} value={c.id}>{c.name} {c.phone}</option>)}</select></label>
      <button type="button" disabled={!canCall||busy||!phoneId||!contactId} onClick={()=>perform(async()=>setPermission(await postJson('/api/whatsapp/calling',{action:'permissions',phoneId,contactId})))}>Check permission</button><button type="button" disabled={!canCall||busy||!!liveId||!phoneId||!contactId} onClick={start}><Phone size={16}/>Call</button>
      {liveId&&<><button type="button" title={muted?'Unmute':'Mute'} aria-label={muted?'Unmute':'Mute'} onClick={toggleMute}>{muted?<MicOff size={18}/>:<Mic size={18}/>}</button><button type="button" title="Play call audio" aria-label="Play call audio" onClick={()=>audioRef.current?.play().catch(e=>setError(e.message))}><Volume2 size={18}/></button></>}
    </div>
    {permission&&<p role="status">Call permission: {permission.permission?.status||'Unavailable'}. {permission.actions?.find(a=>a.action_name==='start_call')?.can_perform_action===true?'Available now':'Not available now'}</p>}
    <details><summary>Request customer calling permission</summary><form onSubmit={event=>{event.preventDefault();perform(()=>postJson('/api/whatsapp/calling',{action:'requestPermission',phoneId,contactId,requestId:crypto.randomUUID(),message:permissionMessage}));}}><label>Permission request message<textarea required maxLength={1024} value={permissionMessage} onChange={event=>setPermissionMessage(event.target.value)}/></label><div className="wa-module-controls"><button disabled={!canCall||busy||!phoneId||!contactId}>Send permission request</button></div></form></details>
    {data?.access?.canReadSettings&&<details><summary>Number calling settings</summary><button type="button" disabled={busy||!phoneId} onClick={()=>perform(async()=>setSettings(await api('/api/whatsapp/calling?action=settings&phoneId='+encodeURIComponent(phoneId))))}>Load settings</button>{settings&&<div className="wa-module-controls"><label><input type="checkbox" disabled={!data.access.canWriteSettings||busy} checked={settings.calling?.status==='ENABLED'} onChange={e=>setSettings({...settings,calling:{...settings.calling,status:e.target.checked?'ENABLED':'DISABLED'}})}/>Calling enabled</label><label><input type="checkbox" disabled={!data.access.canWriteSettings||busy} checked={settings.calling?.callback_permission_status==='ENABLED'} onChange={e=>setSettings({...settings,calling:{...settings.calling,callback_permission_status:e.target.checked?'ENABLED':'DISABLED'}})}/>Request callback permission</label><button type="button" disabled={!data.access.canWriteSettings||busy} onClick={()=>perform(()=>postJson('/api/whatsapp/calling',{action:'settings',phoneId,enabled:settings.calling?.status==='ENABLED',callbackPermissions:settings.calling?.callback_permission_status==='ENABLED'}))}>Save browser calling settings</button></div>}</details>}
    {data?.access?.canReadSettings&&<CallingHoursSettings api={api} postJson={postJson}/>}
    {!data?<p role="status">Loading calls...</p>:<div className="wa-module-table"><table><thead><tr><th>Contact</th><th>Direction</th><th>Status</th><th>Started</th><th>Actions</th></tr></thead><tbody>{data.calls.map(call=><tr key={call.id}><td>{call.remote_number}</td><td>{call.direction==='USER_INITIATED'?'Incoming':'Outgoing'}</td><td>{call.status}{call.error_code&&<small>{call.error_code}</small>}</td><td>{new Date(call.created_at).toLocaleString()}</td><td><div className="wa-module-controls">{canCall&&call.remote_session?.sdp_type==='offer'&&data.availability==='available'&&call.direction==='USER_INITIATED'&&call.status==='ringing'&&(!call.agent_id||call.agent_id===data.userId)&&<button type="button" title="Answer" aria-label="Answer" disabled={busy||!!liveId} onClick={()=>answer(call)}><Phone size={18}/></button>}{(canCall||call.agent_id===data.userId)&&!['terminated','rejected','failed'].includes(call.status)&&(!call.agent_id||call.agent_id===data.userId)&&<button type="button" title="End call" aria-label="End call" disabled={busy||!call.provider_call_id} onClick={()=>end(call)}><PhoneOff size={18}/></button>}</div></td></tr>)}</tbody></table>{!data.calls.length&&<p>No calls yet.</p>}</div>}
    {data?.access?.canConfigurePolicy&&<details><summary>Calling roles and team</summary><form onSubmit={event=>{event.preventDefault();perform(async()=>{await postJson('/api/whatsapp/calling',{action:'policy',policy:policy||data.access.policy});setPolicy(null);});}}><fieldset disabled={busy}><legend>Calling roles</legend>{data.access.allowedRoles.map(item=><label key={item}><input type="checkbox" checked={(policy||data.access.policy).roles.includes(item)} onChange={event=>{const current=policy||data.access.policy;setPolicy({...current,roles:event.target.checked?[...current.roles,item]:current.roles.filter(value=>value!==item)});}}/>{item}</label>)}</fieldset><fieldset disabled={busy}><legend>Calling team</legend><label><input type="checkbox" checked={(policy||data.access.policy).agentIds===null} onChange={event=>setPolicy({... (policy||data.access.policy),agentIds:event.target.checked?null:[]})}/>All team members</label>{(policy||data.access.policy).agentIds!==null&&data.members.map(member=><label key={member.user_id}><input type="checkbox" checked={(policy||data.access.policy).agentIds.includes(member.user_id)} onChange={event=>{const current=policy||data.access.policy;setPolicy({...current,agentIds:event.target.checked?[...current.agentIds,member.user_id]:current.agentIds.filter(value=>value!==member.user_id)});}}/>{member.name} ({member.role})</label>)}</fieldset><button disabled={busy}>Save calling policy</button></form></details>}
    <footer className="wa-module-controls"><button type="button" title="Previous page" aria-label="Previous page" disabled={page===1} onClick={()=>setPage(page-1)}><ChevronLeft size={18}/></button><span>Page {page}</span><button type="button" title="Next page" aria-label="Next page" disabled={!data?.hasMore} onClick={()=>setPage(page+1)}><ChevronRight size={18}/></button></footer>
  </section>;
}
