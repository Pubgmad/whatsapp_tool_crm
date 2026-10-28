"use client";
import {useEffect,useState,useRef} from 'react';
import {RefreshCcw,Play,Pause,Archive,ChevronLeft,ChevronRight,Search,X} from 'lucide-react';
import './whatsapp-modules.css';
export default function WhatsAppAds({api,postJson,uploadForm,role}){
  const createReference=useRef(null);
  const [budgetEditing,setBudgetEditing]=useState(null);
  const [creativeEditing,setCreativeEditing]=useState(null);
  const [videos,setVideos]=useState([]),[videoCursor,setVideoCursor]=useState(null),[editing,setEditing]=useState(null);
  const [data,setData]=useState(null),[form,setForm]=useState({}),[credentials,setCredentials]=useState({}),[images,setImages]=useState([]),[audiences,setAudiences]=useState([]),[imageCursor,setImageCursor]=useState(null),[audienceCursor,setAudienceCursor]=useState(null),[page,setPage]=useState(1),[error,setError]=useState(''),[busy,setBusy]=useState(false),[details,setDetails]=useState({}),[report,setReport]=useState(null),[range,setRange]=useState({since:'',until:''}),[selected,setSelected]=useState(''),[adsSummary,setAdsSummary]=useState(null),[oauthPending,setOauthPending]=useState(null),[oauthPick,setOauthPick]=useState({adAccountId:'',pageId:'',phoneId:''}),[credits,setCredits]=useState(null),[includeLeads,setIncludeLeads]=useState(false),[syncFormId,setSyncFormId]=useState(''),[leadSyncNote,setLeadSyncNote]=useState('');
  const managerView=role==='Owner'||role==='Manager';
  const formatUserError=error=>{
    const msg=(error?.message||String(error||'')).trim()||'Something went wrong.';
    const code=error?.code;
    if(code&&!msg.includes(`(${code})`))return `${msg} (${code})`;
    return msg;
  };
  const connectionHasLeadsCapability=connection=>{
    if(!connection)return false;
    if(connection.last_permission_report?.capabilities?.leads?.enabled)return true;
    const scopes=Array.isArray(connection.token_scopes)?connection.token_scopes:[];
    return scopes.some(scope=>/leads/i.test(String(scope||'')));
  };
  const applyConnectionLeadState=connection=>{
    if(connectionHasLeadsCapability(connection))setIncludeLeads(true);
  };
  // Server connection wins; never keep stale IDs that make the form look Connected without a token.
  const mergeCredentialsFromConnection=(connection)=>setCredentials(current=>{
    const next={...current,...(connection||{})};
    if(!connection){
      next.ad_account_id='';
      next.page_id='';
      next.phone_number_id='';
      next.accessToken='';
    }
    return next;
  });
  const ADS_OAUTH_HANDOFF='mathstrat_ads_oauth_handoff';
  const loadCredits=async()=>{try{setCredits(await api('/api/whatsapp/ads/credits'));}catch{setCredits(null);}};
  const load=async()=>{const result=await api('/api/whatsapp/ads?page='+page);setData(result);mergeCredentialsFromConnection(result.connection);applyConnectionLeadState(result.connection);if(result.needsReconnect&&!result.connection)setError(result.reconnectReason==='revoked'?'Meta advertising authorization was revoked. Use Continue with Facebook, then Finish connection.':'This workspace needs Facebook reconnect before Lead forms or campaigns will work.');await loadCredits();};
  useEffect(()=>{let cancelled=false;api('/api/whatsapp/ads?page='+page).then(result=>{if(!cancelled){setData(result);mergeCredentialsFromConnection(result.connection);applyConnectionLeadState(result.connection);if(result.needsReconnect&&!result.connection)setError(result.reconnectReason==='revoked'?'Meta advertising authorization was revoked. Use Continue with Facebook, then Finish connection.':'This workspace needs Facebook reconnect before Lead forms or campaigns will work.');}}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[api,page]);
  useEffect(()=>{let cancelled=false;api('/api/whatsapp/ads/report?days=30').then(result=>{if(!cancelled)setAdsSummary(result);}).catch(()=>{});loadCredits();return()=>{cancelled=true;};},[api]);
  const formatCredits=(minor,currency='INR')=>{try{return new Intl.NumberFormat('en-IN',{style:'currency',currency}).format((Number(minor)||0)/100);}catch{return `${currency} ${((Number(minor)||0)/100).toFixed(2)}`;}};
  const readOAuthHandoff=()=>{
    if(typeof window==='undefined')return null;
    try{
      const raw=sessionStorage.getItem(ADS_OAUTH_HANDOFF);
      if(!raw)return null;
      const parsed=JSON.parse(raw);
      if(!parsed?.businessId||(Date.now()-Number(parsed.ts||0))>2*60*60*1000){
        sessionStorage.removeItem(ADS_OAUTH_HANDOFF);
        return null;
      }
      return parsed;
    }catch{return null;}
  };
  const writeOAuthHandoff=(businessId)=>{
    if(typeof window==='undefined'||!businessId)return;
    try{sessionStorage.setItem(ADS_OAUTH_HANDOFF,JSON.stringify({businessId,ts:Date.now()}));}catch{/* ignore */}
  };
  const clearOAuthHandoff=()=>{
    if(typeof window==='undefined')return;
    try{sessionStorage.removeItem(ADS_OAUTH_HANDOFF);}catch{/* ignore */}
  };
  const clearAdsOAuthQuery=()=>{
    if(typeof window==='undefined')return;
    const url=new URL(window.location.href);
    const hadOAuthQuery=url.searchParams.has('adsOAuth')||url.searchParams.has('adsOAuthError')||url.searchParams.has('oauthBusinessId');
    const hadFacebookHash=url.hash==='#_=_';
    if(!hadOAuthQuery&&!hadFacebookHash)return;
    url.searchParams.delete('adsOAuth');
    url.searchParams.delete('adsOAuthError');
    url.searchParams.delete('oauthBusinessId');
    // Facebook appends #_=_ after Login; strip it so remounts do not look like a bare /app/ads.
    if(hadFacebookHash)url.hash='';
    window.history.replaceState({},'',url.pathname+(url.search||'')+(url.hash||''));
  };
  const applyPendingResult=(result,fresh)=>{
    setOauthPending(result);
    if(result.assetsError)setError(result.assetsError);
    const crmPhones=result.phones?.length?result.phones:(fresh?.phones||[]);
    const adAccounts=result.adAccounts||[];
    const pages=result.pages||[];
    setOauthPick({
      adAccountId:adAccounts.length===1?adAccounts[0].id:(adAccounts[0]?.id||''),
      pageId:pages.length===1?pages[0].id:(pages[0]?.id||''),
      phoneId:crmPhones.length===1?crmPhones[0].phone_number_id:(crmPhones[0]?.phone_number_id||'')
    });
  };
  // preferPending: after Facebook return, do not accept alreadyConnected until the last try —
  // reconnect races where the pending row lags would otherwise skip Finish and clear handoff.
  const fetchPendingWithRetry=async(attempts=4,{preferPending=false}={})=>{
    let last=null;
    for(let i=0;i<attempts;i+=1){
      last=await api('/api/whatsapp/ads/oauth/pending');
      if(last?.pending||last?.reason==='wrong_workspace'||last?.needsReconnect)return last;
      if(last?.alreadyConnected&&(!preferPending||i===attempts-1))return last;
      if(i<attempts-1)await new Promise(resolve=>setTimeout(resolve,400*(i+1)));
    }
    return last;
  };
  // OAuth return must not re-run when ads list data loads — that race cleared oauthPending.
  useEffect(()=>{
    if(role!=='Owner')return;
    let cancelled=false;
    const params=new URLSearchParams(typeof window!=='undefined'?window.location.search:'');
    const oauthError=params.get('adsOAuthError');
    const afterOAuth=params.get('adsOAuth')==='1';
    const urlBusinessId=params.get('oauthBusinessId')||'';
    const handoff=readOAuthHandoff();
    const oauthBusinessId=urlBusinessId||handoff?.businessId||'';
    const shouldFinish=afterOAuth||Boolean(handoff)||Boolean(oauthError);
    if(oauthError){
      setError(()=>{try{return decodeURIComponent(oauthError);}catch{return oauthError;}});
      clearAdsOAuthQuery();
      clearOAuthHandoff();
    }
    const loadPending=async()=>{
      try{
        if(oauthBusinessId){
          const workspaces=await api('/api/workspaces');
          if(!cancelled&&workspaces.currentBusinessId!==oauthBusinessId){
            await postJson('/api/workspaces',{businessId:oauthBusinessId});
            writeOAuthHandoff(oauthBusinessId);
          }
        }
        // Retry: callback redirect can beat pending row visibility by a beat.
        const result=shouldFinish?await fetchPendingWithRetry(4,{preferPending:true}):await api('/api/whatsapp/ads/oauth/pending');
        if(cancelled)return;
        if(result.pending){
          const fresh=await api('/api/whatsapp/ads?page='+page).catch(()=>null);
          if(cancelled)return;
          if(fresh){
            setData(fresh);
            mergeCredentialsFromConnection(fresh.connection);
            applyConnectionLeadState(fresh.connection);
          }
          applyPendingResult(result,fresh);
          clearAdsOAuthQuery();
          // Keep handoff until Finish succeeds so remounts can rehydrate.
          return;
        }
        if(result.alreadyConnected){
          // Only mark Connected from the token-bearing GET list — never inject pending's asset IDs alone.
          const fresh=await api('/api/whatsapp/ads?page='+page).catch(()=>null);
          if(cancelled)return;
          const connection=fresh?.connection||null;
          if(!connection?.ad_account_id){
            setData(fresh||{connection:null,operations:[],phones:[]});
            mergeCredentialsFromConnection(null);
            setOauthPending(null);
            setError(fresh?.needsReconnect||result.needsReconnect
              ?(fresh?.reconnectReason==='revoked'||result.reason==='revoked'
                ?'Meta advertising authorization was revoked. Use Continue with Facebook, then Finish connection.'
                :'This workspace needs Facebook reconnect before Lead forms or campaigns will work.')
              :'Facebook Login reported Connected, but this workspace has no usable ads token. Use Continue with Facebook again.');
            clearAdsOAuthQuery();
            clearOAuthHandoff();
            return;
          }
          setData(fresh);
          mergeCredentialsFromConnection(connection);
          applyConnectionLeadState(connection);
          setOauthPending(null);
          clearAdsOAuthQuery();
          clearOAuthHandoff();
          return;
        }
        if(result.needsReconnect){
          const fresh=await api('/api/whatsapp/ads?page='+page).catch(()=>null);
          if(cancelled)return;
          setData(fresh?{...fresh,connection:null}:{connection:null,operations:[],phones:[],needsReconnect:true});
          mergeCredentialsFromConnection(null);
          setOauthPending(null);
          setError(result.error||'This workspace needs Facebook reconnect before Lead forms or campaigns will work.');
          clearAdsOAuthQuery();
          if(shouldFinish)clearOAuthHandoff();
          return;
        }
        if(result.reason==='wrong_workspace'&&result.oauthBusinessId){
          writeOAuthHandoff(result.oauthBusinessId);
          await postJson('/api/workspaces',{businessId:result.oauthBusinessId});
          const retry=await fetchPendingWithRetry(3,{preferPending:true});
          if(cancelled)return;
          if(retry.pending){
            applyPendingResult(retry,null);
            clearAdsOAuthQuery();
            return;
          }
          if(retry.alreadyConnected){
            const fresh=await api('/api/whatsapp/ads?page='+page).catch(()=>null);
            if(cancelled)return;
            const connection=fresh?.connection||null;
            if(!connection?.ad_account_id){
              setData(fresh||{connection:null,operations:[],phones:[]});
              mergeCredentialsFromConnection(null);
              setOauthPending(null);
              setError(retry.error||'Facebook Login reported Connected, but this workspace has no usable ads token. Use Continue with Facebook again.');
              clearAdsOAuthQuery();
              clearOAuthHandoff();
              return;
            }
            setData(fresh);
            mergeCredentialsFromConnection(connection);
            applyConnectionLeadState(connection);
            setOauthPending(null);
            clearAdsOAuthQuery();
            clearOAuthHandoff();
            return;
          }
          if(retry.needsReconnect){
            setData(current=>({...(current||{}),connection:null,operations:current?.operations||[],phones:current?.phones||[],needsReconnect:true}));
            mergeCredentialsFromConnection(null);
            setOauthPending(null);
            setError(retry.error||'This workspace needs Facebook reconnect before Lead forms or campaigns will work.');
            clearAdsOAuthQuery();
            clearOAuthHandoff();
            return;
          }
        }
        // Do not wipe an in-progress Finish form unless this pass was an OAuth return.
        if(shouldFinish){
          setOauthPending(null);
          if(result.error)setError(result.error);
          else if(result.reason==='expired')setError('Facebook Login expired. Use Continue with Facebook again.');
          else if(result.reason==='session_mismatch')setError('Your CRM login changed during Facebook Login. Sign in again, then use Continue with Facebook.');
          else if(afterOAuth||handoff)setError('Facebook authorized, but no Finish session was found for this workspace. Use Continue with Facebook again.');
          clearAdsOAuthQuery();
          // Keep handoff briefly only when wrong_workspace may still resolve — otherwise clear.
          if(result.reason!=='wrong_workspace')clearOAuthHandoff();
        }
      }catch(e){
        if(!cancelled){
          setError(formatUserError(e));
          if(shouldFinish)clearAdsOAuthQuery();
          // Keep handoff so a refresh can retry pending hydrate.
        }
      }
    };
    loadPending();
    return()=>{cancelled=true;};
    // Intentionally omit data/page — list loads must not cancel OAuth pending hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[api,role,postJson]);
  const run=async task=>{setBusy(true);setError('');try{await task();await load();}catch(e){setError(formatUserError(e));}finally{setBusy(false);}};
  const finishOAuthConnection=async()=>{
    setBusy(true);setError('');
    try{
      const phoneId=oauthPick.phoneId||credentials.phone_number_id;
      if(!oauthPick.adAccountId||!oauthPick.pageId||!phoneId){
        throw Object.assign(new Error('Select ad account, Facebook Page, and WhatsApp number.'),{code:'ADS_PAYLOAD_INVALID'});
      }
      const result=await postJson('/api/whatsapp/ads',{action:'completeOAuth',adAccountId:oauthPick.adAccountId,pageId:oauthPick.pageId,phoneId});
      if(!result?.connection?.ad_account_id){
        throw Object.assign(new Error(result?.error||'Meta Login finished but the ads connection was not saved. Sync Setup → Numbers, then Continue with Facebook again.'),{code:result?.code||'ADS_CONNECTION_NOT_SAVED'});
      }
      clearOAuthHandoff();
      setOauthPending(null);
      // Prefer a fresh GET; if RLS lag still hides the row, trust POST-verified connection once.
      let fresh=await api('/api/whatsapp/ads?page='+page);
      if(!fresh?.connection?.ad_account_id&&result.connection?.ad_account_id){
        await new Promise(r=>setTimeout(r,400));
        fresh=await api('/api/whatsapp/ads?page='+page).catch(()=>fresh);
      }
      if(fresh?.connection?.ad_account_id){
        mergeCredentialsFromConnection(fresh.connection);
        setData(fresh);
        applyConnectionLeadState(fresh.connection);
      }else if(result.connection?.ad_account_id){
        mergeCredentialsFromConnection(result.connection);
        setData({
          ...(fresh||{}),
          connection:result.connection,
          phones:fresh?.phones||[],
          operations:fresh?.operations||[],
          needsReconnect:false,
          reconnectReason:''
        });
        applyConnectionLeadState(result.connection);
      }else{
        setData(fresh?{...fresh,connection:null}:{connection:null,operations:[],phones:[],needsReconnect:true});
        mergeCredentialsFromConnection(null);
        throw Object.assign(new Error('Facebook Login saved, but this workspace still has no usable ads token. Stay on the same workspace and use Continue with Facebook again.'),{code:'ADS_CONNECTION_NOT_SAVED'});
      }
      const report=await api('/api/whatsapp/ads/report?days=30').catch(()=>null);
      if(report)setAdsSummary(report);
      if(result.leadWarning)setError(result.leadWarning);
    }catch(e){setError(formatUserError(e));}
    finally{setBusy(false);}
  };
  const startFacebookLogin=async()=>{
    setBusy(true);setError('');
    try{
      const capabilities=['ctwa','reporting',...(includeLeads?['leads']:[])];
      const result=await api('/api/whatsapp/ads/oauth/start?capabilities='+encodeURIComponent(capabilities.join(',')));
      if(!result.url)throw Object.assign(new Error('Facebook Login URL was not returned by the server.'),{code:'META_OAUTH_URL_MISSING'});
      let businessId=result.businessId||'';
      if(!businessId){
        const workspaces=await api('/api/workspaces').catch(()=>({}));
        businessId=workspaces.currentBusinessId||'';
      }
      writeOAuthHandoff(businessId);
      window.location.assign(result.url);
      return;
    }catch(e){setError(formatUserError(e));}
    finally{setBusy(false);}
  };
  const assets=(resource,after='')=>run(async()=>{const result=await api('/api/whatsapp/ads?resource='+resource+(after?'&after='+encodeURIComponent(after):''));if(resource==='images'){setImages(result.data);setImageCursor(result.after);}else if(resource==='videos'){setVideos(result.data);setVideoCursor(result.after);}else{setAudiences(result.data);setAudienceCursor(result.after);}});
  const uploadImage=file=>run(async()=>{if(!file)return;const body=new FormData();body.set('file',file);const result=await uploadForm('/api/whatsapp/ads/images',body);setImages(current=>[{hash:result.hash,name:file.name},...current.filter(image=>image.hash!==result.hash)]);setForm(current=>({...current,imageHash:result.hash}));});
  const action=(operation,command)=>run(async()=>{
    const body={action:command,operationId:operation.id};
    if(command==='activate'){
      const confirmation=window.prompt('Confirm advertising spend by entering campaign ID '+operation.campaign_id);
      if(confirmation!==operation.campaign_id)return;
      Object.assign(body,{confirmation,confirmSpend:true});
    }
    if(command==='recover'){const value=window.prompt('Meta '+operation.stage+' ID for this exact creation request');if(!value)return;body.providerId=value;}
    if(command==='rename'){const value=window.prompt('Campaign name',operation.payload.campaign.name);if(value===null)return;body.name=value;}
    await postJson('/api/whatsapp/ads',body);
  });
  const input=(key,label,type='text')=><label>{label}<input required type={type} value={form[key]||''} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>;
  const [leadForms,setLeadForms]=useState([]);
  const [publishedFlows,setPublishedFlows]=useState([]);
  const objectiveKind=form.objectiveKind||'MESSAGES';
  const attachFlow=(objectiveKind==='MESSAGES'||objectiveKind==='WHATSAPP_STATUS')&&Boolean(form.nativeFlowId);
  const oauthCrmPhones=oauthPending?.phones?.length?oauthPending.phones:(data?.phones||[]);
  const oauthAdAccounts=oauthPending?.adAccounts||[];
  const oauthPages=oauthPending?.pages||[];
  const leadsCapability=connectionHasLeadsCapability(data?.connection);
  const leadgenSubscribed=Boolean(data?.connection?.leadgen_subscribed);
  const loadLeadForms=()=>run(async()=>{
    if(!data?.connection?.ad_account_id)throw Object.assign(new Error('Finish Facebook connection with a live ads token before loading Instant Forms.'),{code:'ADS_NOT_CONFIGURED'});
    if(!leadsCapability)throw Object.assign(new Error('Reconnect with Facebook with Include lead-form retrieval enabled to load Instant Forms.'),{code:'ADS_CAPABILITY_MISSING'});
    const result=await api('/api/whatsapp/ads?resource=leadforms');
    const rows=result.data||[];
    const pageId=result.pageId||data?.connection?.page_id||'';
    setLeadForms(rows);
    if(rows.length===1)setSyncFormId(rows[0].id);
    else if(!rows.some(row=>row.id===syncFormId))setSyncFormId('');
    setLeadSyncNote(rows.length
      ?`${rows.length} lead form(s) loaded from Page ${pageId}.`
      :`No Instant Forms on connected Page ${pageId||'(unknown)'}. Use Create Instant Form here (or Meta Lead Center on this exact Page), then Load again.`);
  });
  const createLeadForm=()=>run(async()=>{
    if(!data?.connection?.ad_account_id)throw Object.assign(new Error('Finish Facebook connection before creating an Instant Form.'),{code:'ADS_NOT_CONFIGURED'});
    if(!leadsCapability)throw Object.assign(new Error('Reconnect with Include lead-form retrieval enabled before creating Instant Forms.'),{code:'ADS_CAPABILITY_MISSING'});
    const result=await postJson('/api/whatsapp/ads',{action:'createLeadgenForm'});
    if(!result?.id)throw Object.assign(new Error(result?.error||'Meta did not return a new Instant Form id.'),{code:result?.code||'ADS_UNCONFIRMED'});
    await loadLeadForms();
    setSyncFormId(result.id);
    setLeadSyncNote(`Created Instant Form ${result.id} on Page ${result.pageId||data.connection.page_id}. Subscribe leadgen, then Sync after test submissions.`);
  });
  const syncLeadFormsIntoCrm=()=>run(async()=>{
    if(!data?.connection?.ad_account_id)throw Object.assign(new Error('Finish Facebook connection with a live ads token before syncing leads.'),{code:'ADS_NOT_CONFIGURED'});
    if(!leadsCapability)throw Object.assign(new Error('Reconnect with Facebook with Include lead-form retrieval enabled before syncing leads.'),{code:'ADS_CAPABILITY_MISSING'});
    if(!syncFormId)throw Object.assign(new Error('Load lead forms and select a form to sync into CRM.'),{code:'ADS_PAYLOAD_INVALID'});
    const result=await api('/api/whatsapp/ads?resource=leadgen_leads&formId='+encodeURIComponent(syncFormId)+'&ingest=1');
    const count=Array.isArray(result.imported)?result.imported.length:0;
    const failed=Array.isArray(result.failed)?result.failed.length:0;
    const extras=[failed?`${failed} failed`:null,result.truncated?'more leads remain on Meta (re-run sync later)':null].filter(Boolean);
    setLeadSyncNote(`Synced ${count} lead(s) into Audience/Contacts${extras.length?` (${extras.join('; ')})`:''}.`);
  });
  const subscribeLeadgen=()=>run(async()=>{
    await postJson('/api/whatsapp/ads',{action:'subscribeLeadgen'});
    await load();
    setLeadSyncNote('Page leadgen webhooks subscribed for this workspace.');
  });
  return <section className="wa-module wa-ad-dashboard wa-ads-workspace" aria-label="Click-to-WhatsApp Ads" data-ads-workspace><header className="wa-module-heading saasPageHead saasPageHeadToolbar"><span className="wa-module-toolbarLabel">Campaign controls</span><button type="button" title="Refresh campaigns" aria-label="Refresh campaigns" disabled={busy} onClick={()=>run(load)}><RefreshCcw size={18}/></button></header>{error&&<p role="alert" className="wa-module-error">{error}</p>}
    {adsSummary&&<div className="wa-ad-kpis" aria-label="Ads performance overview"><article className="wa-ad-kpi"><span>AD referrals</span><strong>{adsSummary.performance.whatsappEntryConversations}</strong><small>{adsSummary.performance.windowDays}d Click-to-WhatsApp</small></article><article className="wa-ad-kpi"><span>Status</span><strong>{adsSummary.readiness.readyToLaunch?'Ready':'Setup needed'}</strong><small>{adsSummary.readiness.blockers?.length||0} blocker(s)</small></article>{credits&&<article className="wa-ad-kpi"><span>Ad credits</span><strong>{formatCredits(credits.availableMinor,credits.currency)}</strong><small>{formatCredits(credits.reservedMinor,credits.currency)} reserved</small></article>}<article className="wa-ad-kpi"><span>Campaigns</span><strong>{data?.operations?.length??'—'}</strong><small>This page</small></article></div>}
    {adsSummary&&(adsSummary.readiness.blockers?.length>0||!adsSummary.readiness.readyToLaunch)&&<div className="wa-ad-banner" role="status"><div><strong>{adsSummary.readiness.readyToLaunch?'Ready':'Setup required'}</strong>{adsSummary.readiness.blockers?.length>0&&<ul>{adsSummary.readiness.blockers.map((item,index)=><li key={index}>{item}</li>)}</ul>}</div></div>}
    {managerView&&credits&&<details><summary>Buy ad credits</summary><div className="wa-module-controls">{role==='Owner'&&!credits.starterGranted&&<button type="button" disabled={busy} onClick={()=>run(async()=>{await postJson('/api/whatsapp/ads/credits',{action:'claimStarter'});await loadCredits();})}>Claim starter credits ({formatCredits(credits.starterCreditsMinor,credits.currency)})</button>}<button type="button" disabled={busy} onClick={()=>run(loadCredits)}>Refresh balance</button></div><div className="wa-module-table"><table><thead><tr><th>Package</th><th>Credits</th><th>Price</th><th></th></tr></thead><tbody>{credits.packages?.map(pack=><tr key={pack.id}><td>{pack.name}</td><td>{formatCredits(pack.credits_minor,pack.currency)}</td><td>{formatCredits(pack.price_minor,pack.currency)}</td><td>{role==='Owner'&&<button type="button" disabled={busy} onClick={()=>run(async()=>{const result=await postJson('/api/whatsapp/ads/credits',{action:'buy',packageId:pack.id});if(result.url)window.location.assign(result.url);})}>Buy</button>}</td></tr>)}</tbody></table></div>{credits.purchases?.length>0&&<details className="techDetails"><summary>Purchase history</summary><div className="wa-module-table"><table><thead><tr><th>Purchase</th><th>Status</th><th>Credits</th><th></th></tr></thead><tbody>{credits.purchases.map(item=><tr key={item.id}><td>{item.id}</td><td>{item.status}</td><td>{formatCredits(item.credits_minor,item.currency)}</td><td>{role==='Owner'&&!['captured','cancelled','expired'].includes(item.status)&&<button type="button" disabled={busy} onClick={()=>run(async()=>{await postJson('/api/whatsapp/ads/credits',{action:'reconcile',purchaseId:item.id});await loadCredits();})}>Reconcile</button>}{item.status==='pending'&&item.checkout_url&&<a href={item.checkout_url} target="_blank" rel="noreferrer">Open checkout</a>}</td></tr>)}</tbody></table></div></details>}</details>}
    <div className="wa-module-table wa-ad-primary-table"><table><thead><tr><th>Campaign</th><th>Objective</th><th>Status</th><th>Stage</th><th>Actions</th></tr></thead><tbody>{data?.operations.map(operation=><tr key={operation.id}><td>{operation.payload.campaign.name}<small>{operation.campaign_id}</small></td><td>{operation.payload.objectiveKind||operation.objective_kind||'MESSAGES'}</td><td>{operation.state}<small>{operation.error_code}</small>{details[operation.id]&&<details className="techDetails"><summary>Live Meta status</summary><pre>{JSON.stringify(details[operation.id],null,2)}</pre></details>}</td><td>{operation.stage}</td><td><div className="wa-module-controls"><button type="button" title="Read live Meta status" aria-label="Read live Meta status" disabled={busy||!operation.campaign_id} onClick={()=>run(async()=>setDetails({...details,[operation.id]:await api('/api/whatsapp/ads?resource=status&operationId='+encodeURIComponent(operation.id))}))}><RefreshCcw size={16}/></button>{operation.state==='partial'&&<button type="button" disabled={busy} onClick={()=>action(operation,'resume')}>Resume rejected stage</button>}{role==='Owner'&&<>{operation.state==='unconfirmed'&&<button type="button" disabled={busy} onClick={()=>action(operation,'recover')}>Reconcile resource</button>}{operation.stage==='complete'&&operation.state!=='archived'&&<><button type="button" title="Activate with spend confirmation" aria-label="Activate with spend confirmation" disabled={busy} onClick={()=>action(operation,'activate')}><Play size={16}/></button><button type="button" title="Pause campaign" aria-label="Pause campaign" disabled={busy} onClick={()=>action(operation,'pause')}><Pause size={16}/></button><button type="button" disabled={busy} onClick={()=>run(async()=>{const live=await api('/api/whatsapp/ads?resource=status&operationId='+encodeURIComponent(operation.id));setBudgetEditing({operation,adset:live.adset});})}>Budget and schedule</button><button type="button" disabled={busy} onClick={()=>action(operation,'rename')}>Rename</button><button type="button" disabled={busy} onClick={()=>setEditing(operation)}>Edit audience</button><button type="button" disabled={busy} onClick={()=>action(operation,'reconcileDelivery')}>Reconcile delivery</button><button type="button" title="Archive campaign" aria-label="Archive campaign" disabled={busy} onClick={()=>action(operation,'archive')}><Archive size={16}/></button></>}</>}</div></td></tr>)}</tbody></table>{data&&!data.operations.length&&<div className="wa-ad-empty"><strong>No campaigns yet</strong></div>}</div><footer className="wa-module-controls"><button type="button" title="Previous campaigns" aria-label="Previous campaigns" disabled={page===1||busy} onClick={()=>setPage(page-1)}><ChevronLeft size={18}/></button><span>Page {page}</span><button type="button" title="Next campaigns" aria-label="Next campaigns" disabled={!data?.hasMore||busy} onClick={()=>setPage(page+1)}><ChevronRight size={18}/></button></footer>
    {role==='Owner'&&<details open={!data?.connection||Boolean(oauthPending)||Boolean(data?.needsReconnect)}><summary>Meta advertising connection</summary>
      {data?.connection&&!oauthPending&&<p role="status" className="wa-module-success">Connected to Meta ads (ad account {data.connection.ad_account_id}, Page {data.connection.page_id}). You can create a paused campaign below.</p>}
      {data?.connection&&!oauthPending&&leadsCapability&&<p role="status" className={leadgenSubscribed?'wa-module-success':'wa-module-error'}>Connected lead status: subscribed {leadgenSubscribed?'yes':'no'}.</p>}
      {!data?.connection&&!oauthPending&&data?.needsReconnect&&<p role="status" className="wa-module-error">Reconnect required: this workspace has Meta ads assets saved but no usable access token. Use Reconnect with Facebook, then Finish connection.</p>}
      {oauthPending&&<p role="status" className="wa-module-success">Facebook authorized this workspace. Select the ad account, Page, and WhatsApp number below, then click Finish connection.</p>}
      <div className="wa-module-controls"><label className="checkRow"><input type="checkbox" checked={includeLeads} onChange={event=>setIncludeLeads(event.target.checked)}/> Include lead-form retrieval</label><button type="button" disabled={busy||data?.oauthConfigured===false} onClick={startFacebookLogin}>{(data?.connection||data?.needsReconnect)?'Reconnect with Facebook':'Continue with Facebook'}</button>{data?.connection&&leadsCapability&&!leadgenSubscribed&&!oauthPending&&<button type="button" disabled={busy} onClick={subscribeLeadgen}>Subscribe Page leadgen</button>}{data?.oauthConfigured===false&&<small>Ads connection is not available yet. Contact your platform admin.</small>}</div>
      <p><small>Include lead-form retrieval applies on the next Continue/Reconnect with Facebook.</small></p>
      {oauthPending&&<form onSubmit={e=>{e.preventDefault();finishOAuthConnection();}}>{error&&<p role="alert" className="wa-module-error">{error}</p>}{!oauthCrmPhones.length&&<p className="wa-module-error">No WhatsApp number in this workspace. Open Setup → Numbers, Sync from Meta, then refresh this page.</p>}{!oauthAdAccounts.length&&<p className="wa-module-error">No Meta ad accounts were returned for this Facebook login. Grant ads access, then use Continue with Facebook again.</p>}{!oauthPages.length&&<p className="wa-module-error">No Facebook Pages were returned. Make sure your Facebook user manages the Page used for CTWA ads.</p>}<div className="wa-ad-grid"><label>Ad account (Meta)<select required value={oauthPick.adAccountId} onChange={e=>setOauthPick({...oauthPick,adAccountId:e.target.value})} disabled={!oauthAdAccounts.length}>{oauthAdAccounts.length!==1&&<option value="">—</option>}{oauthAdAccounts.map(account=><option key={account.id} value={account.id}>{account.name||account.id} ({account.currency})</option>)}</select></label><label>Facebook Page (Meta)<select required value={oauthPick.pageId} onChange={e=>setOauthPick({...oauthPick,pageId:e.target.value})} disabled={!oauthPages.length}>{oauthPages.length!==1&&<option value="">—</option>}{oauthPages.map(pageRow=><option key={pageRow.id} value={pageRow.id}>{pageRow.name||pageRow.id}</option>)}</select></label><label>WhatsApp number (CRM)<select required value={oauthPick.phoneId||credentials.phone_number_id||''} onChange={e=>setOauthPick({...oauthPick,phoneId:e.target.value})} disabled={!oauthCrmPhones.length}>{oauthCrmPhones.length!==1&&<option value="">—</option>}{oauthCrmPhones.map(phone=><option key={phone.phone_number_id} value={phone.phone_number_id}>{[phone.verified_name,phone.display_phone_number].filter(Boolean).join(' · ')||phone.phone_number_id}</option>)}</select></label></div><div className="wa-module-controls"><button disabled={busy||!oauthCrmPhones.length||!oauthAdAccounts.length||!oauthPages.length}>Finish connection</button></div></form>}
      <details className="techDetails"><summary>Advanced: manual token</summary><form onSubmit={e=>{e.preventDefault();run(async()=>{await postJson('/api/whatsapp/ads',{action:'configure',adAccountId:credentials.ad_account_id,pageId:credentials.page_id,phoneId:credentials.phone_number_id,accessToken:credentials.accessToken});setCredentials({...credentials,accessToken:''});await load();});}}><div className="wa-ad-grid"><label>Ad account ID<input required value={credentials.ad_account_id||''} onChange={e=>setCredentials({...credentials,ad_account_id:e.target.value})}/></label><label>Facebook Page ID<input required value={credentials.page_id||''} onChange={e=>setCredentials({...credentials,page_id:e.target.value})}/></label><label>WhatsApp number<select required value={credentials.phone_number_id||''} onChange={e=>setCredentials({...credentials,phone_number_id:e.target.value})}>{(data?.phones?.length||0)>1&&<option value="">—</option>}{(data?.phones||[]).map(phone=><option key={phone.phone_number_id} value={phone.phone_number_id}>{[phone.verified_name,phone.display_phone_number].filter(Boolean).join(' · ')||phone.phone_number_id}</option>)}</select></label><label>Meta advertising access token<input type="password" autoComplete="new-password" value={credentials.accessToken||''} onChange={e=>setCredentials({...credentials,accessToken:e.target.value})}/></label></div><div className="wa-module-controls"><button disabled={busy}>Save verified connection</button>{data?.connection&&<>
        <button type="button" disabled={busy} onClick={()=>run(async()=>postJson('/api/whatsapp/ads',{action:'checkPermissions'}))}>Recheck permissions</button>
        <button type="button" disabled={busy} onClick={subscribeLeadgen}>Subscribe Page leadgen</button>
        <button type="button" disabled={busy} onClick={()=>{if(window.confirm('Disconnect this workspace from the Meta ad account? Campaign history is kept.'))run(async()=>{await postJson('/api/whatsapp/ads',{action:'disconnect'});});}}>Disconnect</button>
      </>}</div></form></details>
    </details>}
    {role==='Owner'&&data?.connection&&<details open={leadsCapability}><summary>Lead forms (Instant Forms)</summary>
      {!leadsCapability&&<p className="wa-module-error">Load and Sync are disabled. Reconnect with Include lead-form retrieval enabled to grant Instant Form access.</p>}
      {leadsCapability&&!leadgenSubscribed&&<p className="wa-module-error">Subscribe Page leadgen so new Instant Form submissions are delivered to this CRM.</p>}
      <div className="wa-ad-grid"><label>Lead form<select value={syncFormId} onChange={event=>setSyncFormId(event.target.value)} disabled={!leadsCapability||!leadForms.length}><option value="">{leadForms.length?'Select lead form':'Load lead forms first'}</option>{leadForms.map(formRow=><option key={formRow.id} value={formRow.id}>{formRow.name||formRow.id}{formRow.status?` (${formRow.status})`:''}</option>)}</select></label></div>
      <div className="wa-module-controls">
        <button type="button" disabled={busy||!leadsCapability} onClick={createLeadForm}>Create Instant Form</button>
        <button type="button" disabled={busy||!leadsCapability} onClick={loadLeadForms}>Load lead forms</button>
        <button type="button" disabled={busy||!leadsCapability||!syncFormId} onClick={syncLeadFormsIntoCrm}>Sync leads into CRM</button>
      </div>
      {leadSyncNote&&<p role="status">{leadSyncNote}</p>}
      <p><small>Instant Forms belong to the Facebook Page chosen at Finish connection (currently {data.connection.page_id}). Sync imports existing form leads into Audience/Contacts. After Subscribe Page leadgen, new submissions also arrive by webhook.</small></p>
    </details>}
    {data?.connection&&<><details><summary>Create paused campaign</summary><form onSubmit={e=>{e.preventDefault();run(async()=>{createReference.current??=crypto.randomUUID();await postJson('/api/whatsapp/ads',{...scheduleValues(form),action:'create',requestId:createReference.current,objectiveKind,statusPlacement:form.statusPlacement===true||objectiveKind==='WHATSAPP_STATUS',customAudiences:form.customAudiences||[],websiteUrl:form.websiteUrl,leadGenFormId:form.leadGenFormId,...(form.nativeFlowId?{nativeFlowId:form.nativeFlowId,flowGreetingText:form.flowGreetingText,flowCtaLabel:form.flowCtaLabel,flowAutofillMessage:form.flowAutofillMessage}:{})});createReference.current=null;setForm({});});}}><div className="wa-ad-grid"><label>Objective<select value={objectiveKind} onChange={event=>setForm({...form,objectiveKind:event.target.value,nativeFlowId:'',statusPlacement:event.target.value==='WHATSAPP_STATUS'})}><option value="MESSAGES">Click to WhatsApp</option><option value="WHATSAPP_STATUS">WhatsApp Status + IG story</option><option value="WEBSITE_TRAFFIC">Website traffic</option><option value="LEAD_GENERATION">Lead form</option></select></label>{(objectiveKind==='MESSAGES'||objectiveKind==='WEBSITE_TRAFFIC')&&<label className="checkRow"><input type="checkbox" checked={Boolean(form.statusPlacement)||objectiveKind==='WHATSAPP_STATUS'} disabled={objectiveKind==='WHATSAPP_STATUS'} onChange={event=>setForm({...form,statusPlacement:event.target.checked})}/> WhatsApp Status placement (also requires Instagram story)</label>}{objectiveKind==='WEBSITE_TRAFFIC'&&input('websiteUrl','Website URL (HTTPS)')}{objectiveKind==='LEAD_GENERATION'&&<label>Lead form<select required value={form.leadGenFormId||''} onChange={event=>setForm({...form,leadGenFormId:event.target.value})}><option value="">Select lead form</option>{leadForms.map(formRow=><option key={formRow.id} value={formRow.id}>{formRow.name}</option>)}</select></label>}{(objectiveKind==='MESSAGES'||objectiveKind==='WHATSAPP_STATUS')&&<><label>Published Flow (optional)<select value={form.nativeFlowId||''} onChange={event=>setForm({...form,nativeFlowId:event.target.value})}><option value="">No Flow greeting</option>{publishedFlows.filter(flow=>flow.ctwaEligible).map(flow=><option key={flow.id} value={flow.id}>{flow.name}</option>)}</select></label>{attachFlow&&<><label>Greeting message<textarea required maxLength={500} value={form.flowGreetingText||''} onChange={event=>setForm({...form,flowGreetingText:event.target.value})}/></label><label>Flow button label<input required maxLength={25} value={form.flowCtaLabel||''} onChange={event=>setForm({...form,flowCtaLabel:event.target.value})}/></label><label>Autofill message<textarea required maxLength={500} value={form.flowAutofillMessage||''} onChange={event=>setForm({...form,flowAutofillMessage:event.target.value})}/></label></>}</>}<label>Creative format<select value={form.mediaType||'image'} onChange={event=>setForm({...form,mediaType:event.target.value,videoId:''})}><option value="image">Image</option><option value="video">Video</option></select></label>{form.mediaType==='video'&&<label>Ad-account video<select required value={form.videoId||''} onChange={event=>setForm({...form,videoId:event.target.value})}><option value="">Select ready video</option>{videos.filter(video=>video.status?.video_status==='ready').map(video=><option key={video.id} value={video.id}>{video.title||video.id}</option>)}</select></label>}{input('name','Campaign name')}{input('headline','Headline')}<label>Ad text<textarea required maxLength={2000} value={form.text||''} onChange={e=>setForm({...form,text:e.target.value})}/></label><AdBudgetFields form={form} setForm={setForm} currency={data.connection.currency} busy={busy}/>{input('ageMin','Minimum age','number')}{input('ageMax','Maximum age','number')}<label>Ad-account image<select required value={form.imageHash||''} onChange={e=>setForm({...form,imageHash:e.target.value})}><option value="">Select image</option>{images.map(image=><option key={image.hash} value={image.hash}>{image.name||image.hash}</option>)}</select></label></div><AdGeography api={api} form={form} setForm={setForm} busy={busy}/><div className="wa-module-controls"><label>Upload image<input type="file" accept="image/png,image/jpeg" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)uploadImage(file);}}/></label><button type="button" disabled={busy} onClick={()=>assets('images')}>Load images</button><button type="button" disabled={busy} onClick={()=>assets('videos')}>Load videos</button><button type="button" disabled={busy||!videoCursor} onClick={()=>assets('videos',videoCursor)}>Next videos</button><button type="button" disabled={busy||!imageCursor} onClick={()=>assets('images',imageCursor)}>Next images</button><button type="button" disabled={busy||!leadsCapability} onClick={loadLeadForms}>Load lead forms</button><button type="button" disabled={busy} onClick={()=>run(async()=>{const result=await api('/api/whatsapp/ads?resource=publishedflows');setPublishedFlows(result.data||[]);})}>Load published Flows</button><button type="button" disabled={busy} onClick={()=>assets('audiences')}>Load custom audiences</button><button type="button" disabled={busy||!audienceCursor} onClick={()=>assets('audiences',audienceCursor)}>Next audiences</button></div>{form.imageHash&&images.find(image=>image.hash===form.imageHash)?.url&&<img src={images.find(image=>image.hash===form.imageHash).url} alt="Selected campaign creative" width={160} height={160} style={{objectFit:'contain',maxWidth:'100%'}} referrerPolicy="no-referrer"/>}<fieldset><legend>Custom audiences</legend>{audiences.map(audience=><label key={audience.id}><input type="checkbox" checked={form.customAudiences?.includes(audience.id)||false} onChange={e=>setForm({...form,customAudiences:e.target.checked?[...new Set([...(form.customAudiences||[]),audience.id])]:(form.customAudiences||[]).filter(id=>id!==audience.id)})}/>{audience.name}</label>)}</fieldset><div className="wa-module-controls"><button disabled={busy}>Create paused campaign</button></div></form></details>
      <details><summary>Campaign performance</summary><form onSubmit={e=>{e.preventDefault();run(async()=>{setReport(await api('/api/whatsapp/ads?resource=insights&operationId='+encodeURIComponent(selected)+'&since='+range.since+'&until='+range.until));});}}><div className="wa-module-controls"><label>Campaign<select required value={selected} onChange={e=>{setSelected(e.target.value);setReport(null);}}><option value="">Select campaign</option>{data.operations.filter(o=>o.campaign_id).map(o=><option key={o.id} value={o.id}>{o.payload.campaign.name}</option>)}</select></label><label>From<input required type="date" value={range.since} onChange={e=>setRange({...range,since:e.target.value})}/></label><label>Until<input required type="date" value={range.until} onChange={e=>setRange({...range,until:e.target.value})}/></label><button disabled={busy}>Get report</button></div></form>{report&&<div className="wa-module-table"><table><thead><tr><th>Campaign</th><th>Impressions</th><th>Reach</th><th>Clicks</th><th>Spend</th><th>Results</th></tr></thead><tbody>{report.data.map((row,index)=><tr key={row.campaign_id+'-'+index}><td>{row.campaign_name}</td><td>{row.impressions??'—'}</td><td>{row.reach??'—'}</td><td>{row.clicks??'—'}</td><td>{report.currency} {row.spend??'—'}</td><td>{row.actions?.map(action=><small key={action.action_type}>{action.action_type}: {action.value}</small>)}</td></tr>)}</tbody></table>{!report.data.length&&<p>No data for this range.</p>}</div>}</details></>}
    
    {editing&&role==='Owner'&&<AdAudienceEditor key={editing.id} operation={editing} api={api} audiences={audiences} busy={busy} onClose={()=>setEditing(null)} onSave={values=>run(async()=>{await postJson('/api/whatsapp/ads',{action:'targeting',operationId:editing.id,...values});setEditing(null);})}/>}
    {budgetEditing&&role==='Owner'&&<AdBudgetEditor key={budgetEditing.operation.id} {...budgetEditing} currency={data.connection.currency} busy={busy} onClose={()=>setBudgetEditing(null)} onSave={values=>run(async()=>{await postJson('/api/whatsapp/ads',{...values,action:'budget',operationId:budgetEditing.operation.id});setBudgetEditing(null);})}/>}
    {role==='Owner'&&data?.operations.some(operation=>operation.stage==='complete'&&operation.state==='paused')&&<section className="wa-module"><h3>Ad creative</h3><label>Paused campaign<select value={creativeEditing?.id||''} onChange={event=>setCreativeEditing(data.operations.find(operation=>operation.id===event.target.value)||null)}><option value="">Select campaign</option>{data.operations.filter(operation=>operation.stage==='complete'&&operation.state==='paused').map(operation=><option key={operation.id} value={operation.id}>{operation.payload.campaign.name}</option>)}</select></label><div className="wa-module-controls"><button type="button" disabled={busy} onClick={()=>assets('images')}>Load ad images</button><button type="button" disabled={busy} onClick={()=>assets('videos')}>Load ad videos</button></div>{creativeEditing&&<AdCreativeEditor key={creativeEditing.id+':'+creativeEditing.creative_id} operation={data.operations.find(item=>item.id===creativeEditing.id)||creativeEditing} images={images} videos={videos} busy={busy} onSave={values=>run(async()=>{await postJson('/api/whatsapp/ads',{action:'editCreative',operationId:creativeEditing.id,requestId:crypto.randomUUID(),...values});setCreativeEditing(null);})} onReconcile={providerId=>run(async()=>{await postJson('/api/whatsapp/ads',{action:'reconcileCreative',operationId:creativeEditing.id,...(providerId?{providerId}:{})});setCreativeEditing(null);})}/>}</section>}
  </section>;
}

function AdCreativeEditor({operation,images,videos,busy,onSave,onReconcile}){
  const story=operation.payload.creative.object_story_spec;
  const old=story.video_data||story.link_data;
  const [form,setForm]=useState({mediaType:story.video_data?'video':'image',name:operation.payload.creative.name,text:old.message,headline:old.title||old.name,imageHash:old.image_hash,videoId:old.video_id||''});
  const [providerId,setProviderId]=useState('');
  const pending=operation.creative_edit&&!['complete','rejected'].includes(operation.creative_edit.state);
  if(pending)return <div><p role="status">Creative edit: {operation.creative_edit.state}. Reconcile with Meta before another edit.</p><form onSubmit={event=>{event.preventDefault();onReconcile(providerId);}}>{!operation.creative_edit.creativeId&&<label>Meta creative ID<input required pattern="[0-9]{1,32}" value={providerId} onChange={event=>setProviderId(event.target.value)}/></label>}<button disabled={busy}>Reconcile creative</button></form></div>;
  return <form onSubmit={event=>{event.preventDefault();onSave(form);}}><div className="wa-ad-grid"><label>Creative name<input required maxLength={160} value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/></label><label>Format<select value={form.mediaType} onChange={event=>setForm({...form,mediaType:event.target.value,videoId:''})}><option value="image">Image</option><option value="video">Video</option></select></label><label>Headline<input required maxLength={255} value={form.headline} onChange={event=>setForm({...form,headline:event.target.value})}/></label><label>Ad text<textarea required maxLength={2000} value={form.text} onChange={event=>setForm({...form,text:event.target.value})}/></label><label>Image<select required value={form.imageHash} onChange={event=>setForm({...form,imageHash:event.target.value})}><option value="">Select ad-account image</option>{images.map(image=><option key={image.hash} value={image.hash}>{image.name||image.hash}</option>)}{form.imageHash&&!images.some(image=>image.hash===form.imageHash)&&<option value={form.imageHash}>Current image (verify on save)</option>}</select></label>{form.mediaType==='video'&&<label>Video<select required value={form.videoId} onChange={event=>setForm({...form,videoId:event.target.value})}><option value="">Select ready video</option>{videos.filter(video=>video.status?.video_status==='ready').map(video=><option key={video.id} value={video.id}>{video.title||video.id}</option>)}</select></label>}</div><button disabled={busy}>Replace paused ad creative</button></form>;
}

function AdAudienceEditor({operation,api,audiences,busy,onSave,onClose}){
  const targeting=operation.payload.adset.targeting;
  const [form,setForm]=useState({...targeting.geo_locations,ageMin:targeting.age_min,ageMax:targeting.age_max,customAudiences:(targeting.custom_audiences||[]).map(item=>item.id)});
  return <section className="wa-module"><h3>Audience: {operation.payload.campaign.name}</h3><form onSubmit={event=>{event.preventDefault();onSave(form);}}><div className="wa-ad-grid"><label>Minimum age<input required type="number" min={18} max={65} value={form.ageMin} onChange={event=>setForm({...form,ageMin:event.target.value})}/></label><label>Maximum age<input required type="number" min={18} max={65} value={form.ageMax} onChange={event=>setForm({...form,ageMax:event.target.value})}/></label></div><AdGeography api={api} form={form} setForm={setForm} busy={busy}/><fieldset><legend>Custom audiences</legend>{audiences.map(audience=><label key={audience.id}><input type="checkbox" checked={form.customAudiences.includes(audience.id)} onChange={event=>setForm({...form,customAudiences:event.target.checked?[...new Set([...form.customAudiences,audience.id])]:form.customAudiences.filter(id=>id!==audience.id)})}/>{audience.name}</label>)}</fieldset><div className="wa-module-controls"><button disabled={busy}>Save paused campaign audience</button><button type="button" disabled={busy} onClick={onClose}>Cancel</button></div></form></section>;
}
function scheduleValues(form){
  return {...form,...(form.startTime?{startTime:new Date(form.startTime).toISOString()}:{}),...(form.endTime?{endTime:new Date(form.endTime).toISOString()}:{})};
}
function localTime(value){
  if(!value)return '';
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return '';
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function AdBudgetFields({form,setForm,currency,busy,existing=false}){
  const mode=form.budgetType||'daily',key=mode+'Budget';
  return <><label>Budget type<select disabled={busy||existing} value={mode} onChange={event=>setForm({...form,budgetType:event.target.value,dailyBudget:'',lifetimeBudget:''})}><option value="daily">Daily</option><option value="lifetime">Lifetime</option></select></label><label>{mode==='daily'?'Daily budget':'Lifetime budget'} ({currency})<input required inputMode="decimal" disabled={busy} value={form[key]||''} onChange={event=>setForm({...form,[key]:event.target.value})}/></label><label>Start (local time)<input type="datetime-local" required={!existing&&mode==='lifetime'} disabled={busy||existing} value={form.startTime||''} onChange={event=>setForm({...form,startTime:event.target.value})}/></label><label>End (local time)<input type="datetime-local" required={mode==='lifetime'} disabled={busy} value={form.endTime||''} onChange={event=>setForm({...form,endTime:event.target.value})}/></label></>;
}
function AdBudgetEditor({operation,adset,currency,busy,onSave,onClose}){
  const mode=Number(adset?.lifetime_budget)>0?'lifetime':'daily';
  const digits=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;
  const [form,setForm]=useState({budgetType:mode,[mode+'Budget']:(Number(adset?.[mode+'_budget'])/10**digits).toFixed(digits),startTime:localTime(adset?.start_time),endTime:localTime(adset?.end_time)});
  return <section className="wa-module"><h3>Budget and schedule: {operation.payload.campaign.name}</h3><form onSubmit={event=>{event.preventDefault();onSave({...scheduleValues({...form,startTime:''}),...(adset?.start_time?{startTime:adset.start_time}:{})});}}><div className="wa-ad-grid"><AdBudgetFields form={form} setForm={setForm} currency={currency} busy={busy} existing/></div><div className="wa-module-controls"><button disabled={busy}>Save paused campaign budget</button><button type="button" disabled={busy} onClick={onClose}>Cancel</button></div></form></section>;
}
const geoFields={country:'countries',region:'regions',city:'cities',zip:'zips'};
function AdGeography({api,form,setForm,busy}){
  const [type,setType]=useState('city'),[term,setTerm]=useState(''),[country,setCountry]=useState(''),[results,setResults]=useState([]),[after,setAfter]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const search=async(cursor='')=>{
    setLoading(true);setError('');
    try{
      const params=new URLSearchParams({resource:'locations',locationType:type,q:term,...(country?{country}:{}),...(cursor?{after:cursor}:{})});
      const result=await api('/api/whatsapp/ads?'+params);
      setResults(result.data);setAfter(result.after);
    }catch(error){setResults([]);setAfter(null);setError(error.message);}finally{setLoading(false);}
  };
  const reset=()=>{setResults([]);setAfter(null);setError('');};
  const selected=Object.entries(geoFields).flatMap(([locationType,field])=>(form[field]||[]).map(item=>({field,key:locationType==='country'?item:item.key,label:locationType==='country'?item:item.name||item.key})));
  return <fieldset disabled={busy||loading}><legend>Audience locations</legend><div className="wa-module-controls"><label>Location type<select value={type} onChange={event=>{setType(event.target.value);reset();}}><option value="country">Country</option><option value="region">State / region</option><option value="city">City</option><option value="zip">Postal code</option></select></label><label>Country filter<input maxLength={2} pattern="[A-Z]{2}" value={country} onChange={event=>{setCountry(event.target.value.toUpperCase());reset();}}/></label><label>Location search<input value={term} maxLength={100} onChange={event=>{setTerm(event.target.value);reset();}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();if(term.trim().length>=2)search();}}}/></label><button type="button" title="Search Meta locations" aria-label="Search Meta locations" disabled={term.trim().length<2} onClick={()=>search()}><Search size={16}/></button><button type="button" title="Next locations" aria-label="Next locations" disabled={!after} onClick={()=>search(after)}><ChevronRight size={16}/></button></div>{error&&<p role="alert" className="wa-module-error">{error}</p>}
    <div className="wa-module-controls">{selected.map(item=><span key={item.field+':'+item.key}>{item.label} <button type="button" title={'Remove '+item.label} aria-label={'Remove '+item.label} onClick={()=>setForm({...form,[item.field]:(form[item.field]||[]).filter(value=>(item.field==='countries'?value:value.key)!==item.key)})}><X size={14}/></button></span>)}</div>{results.map(item=>{
    const field=geoFields[item.type],values=form[field]||[],checked=values.some(value=>(field==='countries'?value:value.key)===item.key);
    return <label key={item.type+':'+item.key}><input type="checkbox" checked={checked} onChange={event=>setForm({...form,[field]:event.target.checked?[...values,field==='countries'?item.key:{key:item.key,name:item.name}]:values.filter(value=>(field==='countries'?value:value.key)!==item.key)})}/>{item.name}{item.region?' / '+item.region:''}{item.country_code?' / '+item.country_code:''}</label>;
  })}</fieldset>;
}
