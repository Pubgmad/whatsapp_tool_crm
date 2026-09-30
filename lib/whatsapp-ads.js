import {requireSession} from './auth.js';
import {AppError,query,transaction,id,json,errorJson} from './db.js';
import {encryptSecret,decryptSecret} from './meta.js';
import {readJsonBodyLimited,readTextBodyLimited,readMultipartFormLimited} from './security.js';
import {requireWorkspaceManager} from './workspace-permissions.js';
import {assertSubscriptionActive,subscriptionUsage} from './limits.js';
import {paymentMinorUnits} from './razorpay.js';
import businessSdk from 'facebook-nodejs-business-sdk';

const metaId=value=>/^\d{1,32}$/.test(String(value||''));
const stages=['campaign','adset','creative','ad'];
const clean=value=>String(value||'').trim();
async function graph(token,path,body){
  let response;
  try{response=await fetch('https://graph.facebook.com/'+(process.env.META_GRAPH_API_VERSION||'v26.0')+'/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});}catch{throw new AppError('Meta operation delivery is unconfirmed. Reconcile before retrying.',409,'ADS_UNCONFIRMED');}
  const result=JSON.parse(await readTextBodyLimited(response,2_000_000));
  if(!response.ok)throw new AppError(result.error?.message||'Meta advertising request failed.',response.status>=500?502:400,response.status>=500||[408,409].includes(response.status)?'ADS_UNCONFIRMED':'ADS_REJECTED');
  return result;
}
export function whatsappAdTargeting(body){
  if(body.countries!==undefined&&!Array.isArray(body.countries))throw new AppError('Invalid countries.',400,'ADS_PAYLOAD_INVALID');
  const countries=Array.isArray(body.countries)?[...new Set(body.countries)]:[];
  const geo={...(countries.length?{countries}:{})};
  for(const field of ['regions','cities','zips']){
    const locations=body[field]??[];
    if(!Array.isArray(locations)||locations.length>50||locations.some(item=>!item||typeof item.key!=='string'||!/^[a-zA-Z0-9_ .:-]{1,100}$/.test(item.key)||item.radius!==undefined||item.distance_unit!==undefined))throw new AppError('Select valid Meta locations without radius overrides.',400,'ADS_PAYLOAD_INVALID');
    if(locations.length)geo[field]=[...new Map(locations.map(item=>[item.key,{key:item.key}])).values()];
  }
  const min=Number(body.ageMin),max=Number(body.ageMax);
  const customAudiences=body.customAudiences||[];
  if(!Object.keys(geo).length||countries.length>25||countries.some(c=>typeof c!=='string'||!/^[A-Z]{2}$/.test(c))||!Number.isInteger(min)||min<18||!Number.isInteger(max)||max>65||max<min||!Array.isArray(customAudiences)||customAudiences.length>20||customAudiences.some(c=>!metaId(c)))throw new AppError('Provide valid adult audience settings.',400,'ADS_PAYLOAD_INVALID');
  return {geo_locations:geo,age_min:min,age_max:max,...(customAudiences.length?{custom_audiences:[...new Set(customAudiences)].map(value=>({id:value}))}:{})};
}
export function whatsappAdBudget(body,currency,{now=Date.now(),existing=null}={}){
  const mode=body.budgetType||'daily';
  if(!['daily','lifetime'].includes(mode)||mode==='daily'&&clean(body.lifetimeBudget)||mode==='lifetime'&&clean(body.dailyBudget))throw new AppError('Choose exactly one budget type.',400,'ADS_PAYLOAD_INVALID');
  if(existing&&mode!==(Number(existing.lifetime_budget)>0?'lifetime':'daily'))throw new AppError('Keep the existing budget type for this campaign.',409,'ADS_BUDGET_TYPE_LOCKED');
  const result={[mode+'_budget']:paymentMinorUnits(body[mode+'Budget'],currency)};
  for(const [input,field] of [['startTime','start_time'],['endTime','end_time']]){
    const value=clean(body[input]);
    if(!value)continue;
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==value.slice(0,10))throw new AppError('Provide valid schedule timestamps with an explicit time zone.',400,'ADS_SCHEDULE_INVALID');
    const timestamp=Date.parse(value);
    if(field==='start_time'&&existing){
      if(timestamp!==Date.parse(existing.start_time))throw new AppError('The existing start time cannot be changed here.',409,'ADS_SCHEDULE_INVALID');
    }else if(timestamp<=now)throw new AppError('Schedule times must be in the future.',400,'ADS_SCHEDULE_INVALID');
    result[field]=new Date(timestamp).toISOString();
  }
  const start=result.start_time||existing?.start_time;
  const end=result.end_time||existing?.end_time;
  if(mode==='lifetime'&&(!end||!existing&&!start)||end&&Date.parse(end)<=Math.max(start?Date.parse(start):now,now))throw new AppError('Provide an end time after the campaign start and the current time.',400,'ADS_SCHEDULE_INVALID');
  return result;
}
export function whatsappAdPayload(body,connection,number){
  const name=clean(body.name),text=clean(body.text),headline=clean(body.headline);
  const providerName=body.requestId?name+' ['+body.requestId+']':name;
  if(!name||name.length>200||!text||text.length>2000||!headline||headline.length>255||!/^\d{5,20}$/.test(number)||!/^[a-f0-9]{32}$/i.test(body.imageHash||''))throw new AppError('Provide valid creative and WhatsApp number details.',400,'ADS_PAYLOAD_INVALID');
  const budget=whatsappAdBudget(body,connection.currency);
  const targeting=whatsappAdTargeting(body);
  if(body.mediaType&&!['image','video'].includes(body.mediaType))throw new AppError('Select an image or video creative.',400,'ADS_PAYLOAD_INVALID');
  if(body.mediaType==='video'&&!metaId(body.videoId))throw new AppError('Select a video from this ad account.',400,'ADS_PAYLOAD_INVALID');
  const objective=businessSdk.Campaign.Objective.outcome_engagement;
  const destination=businessSdk.AdSet.DestinationType.whatsapp;
  const optimization=businessSdk.AdSet.OptimizationGoal.conversations;
  if(!objective||!destination||!optimization)throw new AppError('The installed Meta SDK does not support WhatsApp ad creation.',503,'ADS_SDK_UNSUPPORTED');
  return {
    campaign:{name:providerName,objective,special_ad_categories:[],status:'PAUSED'},
    adset:{name:providerName,destination_type:destination,optimization_goal:optimization,billing_event:'IMPRESSIONS',...budget,targeting,promoted_object:{page_id:connection.page_id,whatsapp_phone_number:number},status:'PAUSED'},
    creative:{name:providerName,object_story_spec:{page_id:connection.page_id,...(body.mediaType==='video'?{video_data:{video_id:body.videoId,image_hash:body.imageHash,message:text,title:headline,call_to_action:{type:'WHATSAPP_MESSAGE',value:{app_destination:'WHATSAPP',whatsapp_number:number}}}}:{link_data:{image_hash:body.imageHash,message:text,name:headline,link:'https://wa.me/'+number,call_to_action:{type:'WHATSAPP_MESSAGE',value:{app_destination:'WHATSAPP',whatsapp_number:number}}}})}},
    ad:{name:providerName,status:'PAUSED'}
  };
}
async function connectionFor(businessId){
  const connection=(await query('SELECT * FROM whatsapp_ads_connections WHERE business_id=$1',[businessId])).rows[0];
  if(!connection)throw new AppError('The owner must connect a Meta ad account first.',409,'ADS_NOT_CONFIGURED');
  return {...connection,token:decryptSecret(connection.access_token_encrypted)};
}
async function verifyConnection(businessId,connection){
  const phone=(await query("SELECT p.display_phone_number FROM whatsapp_phone_numbers p JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id WHERE p.business_id=$1 AND p.phone_number_id=$2 AND p.registration_state='registered' AND a.status='connected'",[businessId,connection.phone_number_id])).rows[0];
  if(!phone)throw new AppError('Connect and register the selected WhatsApp number.',409,'ADS_PHONE_INELIGIBLE');
  const number=phone.display_phone_number.replace(/\D/g,'');
  const account=await graph(connection.token,'act_'+connection.ad_account_id+'?fields=id,account_status,currency');
  const page=await graph(connection.token,connection.page_id+'?fields=id,whatsapp_number');
  if(String(account.id)!=='act_'+connection.ad_account_id||account.account_status!==1||String(page.id)!==connection.page_id||String(page.whatsapp_number||'').replace(/\D/g,'')!==number||!number)throw new AppError('Meta must grant access to an active ad account and a Page linked to this exact WhatsApp number.',403,'ADS_ASSET_MISMATCH');
  if(connection.currency&&connection.currency!==account.currency)throw new AppError('The ad account currency changed.',409,'ADS_ASSET_MISMATCH');
  return {number,currency:account.currency};
}
async function audit(session,action,metadata){await query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,action,JSON.stringify(metadata)]);}
export async function uploadAdImage(request){
  try{
    const session=await requireSession(request);requireWorkspaceManager(session);
    assertSubscriptionActive(await subscriptionUsage(session.businessId));
    const connection=await connectionFor(session.businessId);await verifyConnection(session.businessId,connection);
    const form=await readMultipartFormLimited(request,6*1024*1024),file=form.get('file');
    if(!file||typeof file.arrayBuffer!=='function'||file.size<8||file.size>5*1024*1024||!['image/png','image/jpeg'].includes(file.type))throw new AppError('Upload a PNG or JPEG image smaller than 5 MB.',400,'ADS_IMAGE_INVALID');
    const bytes=Buffer.from(await file.arrayBuffer());
    if(file.type==='image/png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||file.type==='image/jpeg'&&!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))throw new AppError('The file content does not match its image type.',400,'ADS_IMAGE_INVALID');
    const result=await graph(connection.token,'act_'+connection.ad_account_id+'/adimages',{bytes:bytes.toString('base64'),name:clean(file.name).slice(0,200)});
    const image=Object.values(result.images||{}).find(value=>/^[a-f0-9]{32}$/i.test(value.hash||''));
    if(!image)throw new AppError('Meta did not confirm an image hash.',409,'ADS_UNCONFIRMED');
    await audit(session,'whatsapp_ad_image_uploaded',{hash:image.hash});return json({hash:image.hash},201);
  }catch(error){return errorJson(error);}
}
export async function getWhatsAppAds(request){
  try{
    const session=await requireSession(request);requireWorkspaceManager(session);
    const params=new URL(request.url).searchParams;
    if(params.get('resource')){
      const connection=await connectionFor(session.businessId);const resource=params.get('resource');
      const cursor=clean(params.get('after'));if(cursor.length>2000)throw new AppError('Invalid page cursor.',400,'INVALID_CURSOR');
      if(resource==='locations'){
        const type=clean(params.get('locationType')),term=clean(params.get('q')),country=clean(params.get('country'));
        if(!['country','region','city','zip'].includes(type)||term.length<2||term.length>100||country&&!/^[A-Z]{2}$/.test(country))throw new AppError('Provide a location type and search term of 2 to 100 characters.',400,'ADS_PAYLOAD_INVALID');
        const search=new URLSearchParams({type:'adgeolocation',location_types:JSON.stringify([type]),q:term,limit:'25',...(country?{country_code:country}:{}),...(cursor?{after:cursor}:{})});
        const result=await graph(connection.token,'search?'+search);
        return json({data:(result.data||[]).filter(item=>item.type===type&&typeof item.key==='string'&&typeof item.name==='string').map(item=>({key:item.key,name:item.name,type:item.type,country_code:item.country_code,region:item.region})),after:result.paging?.next?result.paging?.cursors?.after||null:null});
      }
      if(['images','audiences','videos'].includes(resource)){
        const result=await graph(connection.token,'act_'+connection.ad_account_id+'/'+(resource==='images'?'adimages?fields=hash,name,url':resource==='videos'?'advideos?fields=id,title,status':'customaudiences?fields=id,name')+'&limit=25'+(cursor?'&after='+encodeURIComponent(cursor):''));
        return json({data:result.data||[],after:result.paging?.next?result.paging?.cursors?.after||null:null});
      }
      const operation=(await query('SELECT * FROM whatsapp_ads_operations WHERE business_id=$1 AND id=$2',[session.businessId,params.get('operationId')])).rows[0];
      if(!operation||!operation.campaign_id||operation.ad_account_id!==connection.ad_account_id)throw new AppError('Ad campaign not found.',404,'NOT_FOUND');
      if(resource==='insights'){
        const since=clean(params.get('since')),until=clean(params.get('until'));
        if(!/^\d{4}-\d{2}-\d{2}$/.test(since)||!/^\d{4}-\d{2}-\d{2}$/.test(until)||!Number.isFinite(Date.parse(since))||!Number.isFinite(Date.parse(until))||since>until||Date.parse(until)-Date.parse(since)>366*86400000)throw new AppError('Provide a report range of at most 366 days.',400,'ADS_REPORT_RANGE');
        const result=await graph(connection.token,operation.campaign_id+'/insights?fields=campaign_id,campaign_name,impressions,reach,clicks,spend,actions&time_range='+encodeURIComponent(JSON.stringify({since,until}))+'&limit=25');
        return json({data:result.data||[],currency:connection.currency});
      }
      if(resource==='status'){
        const campaign=await graph(connection.token,operation.campaign_id+'?fields=id,account_id,status,effective_status');
        if(String(campaign.account_id)!==connection.ad_account_id)throw new AppError('Campaign ownership could not be verified.',403,'ADS_ASSET_MISMATCH');
        const adset=operation.adset_id?await graph(connection.token,operation.adset_id+'?fields=id,account_id,status,effective_status,daily_budget,lifetime_budget,start_time,end_time,destination_type'):null;
        const ad=operation.ad_id?await graph(connection.token,operation.ad_id+'?fields=id,account_id,status,effective_status'):null;
        return json({campaign,adset,ad});
      }
      throw new AppError('Unsupported advertising resource.',400,'INVALID_ACTION');
    }
    const raw=Number(params.get('page')||1),page=Number.isSafeInteger(raw)?Math.min(100000,Math.max(1,raw)):1;
    await query("UPDATE whatsapp_ads_operations SET state='unconfirmed',error_code='ADS_UNCONFIRMED' WHERE business_id=$1 AND state='processing' AND updated_at<NOW()-INTERVAL '2 minutes'",[session.businessId]);
    const operations=(await query(`SELECT o.id,o.payload,o.state,o.stage,o.campaign_id,o.adset_id,o.creative_id,o.ad_id,o.error_code,o.created_at,
      (SELECT json_build_object('id',e.id,'state',e.state,'creativeId',e.creative_id,'errorCode',e.error_code)
       FROM whatsapp_ads_creative_edits e WHERE e.business_id=o.business_id AND e.operation_id=o.id ORDER BY e.created_at DESC LIMIT 1) AS creative_edit
      FROM whatsapp_ads_operations o WHERE o.business_id=$1 ORDER BY o.created_at DESC,o.id LIMIT 26 OFFSET $2`,[session.businessId,(page-1)*25])).rows;
    const connection=(await query('SELECT ad_account_id,page_id,phone_number_id,currency FROM whatsapp_ads_connections WHERE business_id=$1',[session.businessId])).rows[0]||null;
    const phones=(await query("SELECT p.phone_number_id,p.display_phone_number,p.verified_name FROM whatsapp_phone_numbers p JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id WHERE p.business_id=$1 AND p.registration_state='registered' AND a.status='connected' ORDER BY p.created_at",[session.businessId])).rows;
    return json({connection,phones,operations:operations.slice(0,25),page,hasMore:operations.length>25});
  }catch(error){return errorJson(error);}
}
async function createResources(session,connection,operation){
  for(const stage of stages){
    if(operation[stage+'_id'])continue;
    await query('UPDATE whatsapp_ads_operations SET stage=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3',[stage,operation.id,session.businessId]);
    const wire={...operation.payload[stage]};
    if(stage==='adset')wire.campaign_id=operation.campaign_id;
    if(stage==='ad'){wire.adset_id=operation.adset_id;wire.creative={creative_id:operation.creative_id};}
    try{
      const result=await graph(connection.token,'act_'+connection.ad_account_id+'/'+({campaign:'campaigns',adset:'adsets',creative:'adcreatives',ad:'ads'}[stage]),wire);
      if(!metaId(result.id))throw new AppError('Meta did not confirm a created resource ID.',409,'ADS_UNCONFIRMED');
      operation[stage+'_id']=String(result.id);
      await query('UPDATE whatsapp_ads_operations SET '+stage+'_id=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3',[result.id,operation.id,session.businessId]);
      await audit(session,'whatsapp_ad_resource_created',{operationId:operation.id,stage,providerId:result.id});
    }catch(error){await query('UPDATE whatsapp_ads_operations SET state=$1,error_code=$2,updated_at=NOW() WHERE id=$3 AND business_id=$4',[error.code==='ADS_REJECTED'?'partial':'unconfirmed',error.code||'ADS_UNCONFIRMED',operation.id,session.businessId]);throw error;}
  }
  await query("UPDATE whatsapp_ads_operations SET state='paused',stage='complete',error_code='',updated_at=NOW() WHERE id=$1 AND business_id=$2",[operation.id,session.businessId]);
  return {ok:true,operationId:operation.id,state:'paused'};
}
export async function updateWhatsAppAds(request){
  try{
    const session=await requireSession(request);requireWorkspaceManager(session);
    const body=await readJsonBodyLimited(request,16000);assertSubscriptionActive(await subscriptionUsage(session.businessId));
    // Serialize CRM mutations so a paused edit cannot race activation in this workspace.
    return await transaction(async client=>{
      const lock=await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',['whatsapp-ads:'+session.businessId]);
      if(!lock.rows[0]?.acquired)throw new AppError('Another advertising change is in progress. Refresh before retrying.',409,'ADS_BUSY');
      return performAdsUpdate(session,body);
    });
  }catch(error){return errorJson(error);}
}
async function performAdsUpdate(session,body){
    if(body.action==='configure'){
      if(session.role!=='Owner')throw new AppError('Only the owner can connect advertising assets.',403,'FORBIDDEN');
      const previous=(await query('SELECT * FROM whatsapp_ads_connections WHERE business_id=$1',[session.businessId])).rows[0];
      if(!metaId(body.adAccountId)||!metaId(body.pageId)||!metaId(body.phoneId))throw new AppError('Provide valid Meta asset IDs.',400,'ADS_PAYLOAD_INVALID');
      const same=previous?.ad_account_id===body.adAccountId&&previous.page_id===body.pageId&&previous.phone_number_id===body.phoneId;
      const embeddedAccount=(await query("SELECT a.access_token_encrypted FROM whatsapp_phone_numbers p JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id WHERE p.business_id=$1 AND p.phone_number_id=$2 AND a.status='connected'",[session.businessId,body.phoneId])).rows[0];
      const token=clean(body.accessToken)||(same?decryptSecret(previous.access_token_encrypted):embeddedAccount?decryptSecret(embeddedAccount.access_token_encrypted):'');
      if(!token||token.length>8192)throw new AppError('Provide the advertising access token.',400,'META_TOKEN_REQUIRED');
      const next={ad_account_id:body.adAccountId,page_id:body.pageId,phone_number_id:body.phoneId,token};
      const verified=await verifyConnection(session.businessId,next);
      await transaction(async client=>{
        await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[session.businessId]);
        const locked=(await client.query('SELECT * FROM whatsapp_ads_connections WHERE business_id=$1',[session.businessId])).rows[0];
        if(locked?.updated_at?.getTime()!==previous?.updated_at?.getTime())throw new AppError('Advertising settings changed. Refresh first.',409,'ADS_CONFIGURATION_CHANGED');
        if(previous&&!same&&(await client.query('SELECT 1 FROM whatsapp_ads_operations WHERE business_id=$1 LIMIT 1',[session.businessId])).rowCount)throw new AppError('Keep existing assets for reconciliation; rotate the access token instead.',409,'ADS_CONFIGURATION_CHANGED');
        await client.query('INSERT INTO whatsapp_ads_connections (business_id,ad_account_id,page_id,phone_number_id,currency,access_token_encrypted) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (business_id) DO UPDATE SET ad_account_id=EXCLUDED.ad_account_id,page_id=EXCLUDED.page_id,phone_number_id=EXCLUDED.phone_number_id,currency=EXCLUDED.currency,access_token_encrypted=EXCLUDED.access_token_encrypted,updated_at=NOW()',[session.businessId,body.adAccountId,body.pageId,body.phoneId,verified.currency,encryptSecret(token)]);
      });
      await audit(session,'whatsapp_ads_connected',{adAccountId:body.adAccountId,pageId:body.pageId,phoneId:body.phoneId});return json({ok:true});
    }
    const connection=await connectionFor(session.businessId);
    if(body.action==='create'){
      const verified=await verifyConnection(session.businessId,connection);
      const payload=whatsappAdPayload(body,connection,verified.number);
      const images=await graph(connection.token,'act_'+connection.ad_account_id+'/adimages?fields=hash&hashes='+encodeURIComponent(JSON.stringify([body.imageHash])));
      if(!images.data?.some(image=>image.hash===body.imageHash))throw new AppError('Choose an image belonging to this ad account.',403,'ADS_ASSET_MISMATCH');
      if(body.mediaType==='video'){
        let found=false,cursor='';
        for(let page=0;page<20;page++){
          const videos=await graph(connection.token,'act_'+connection.ad_account_id+'/advideos?fields=id,status&limit=100'+(cursor?'&after='+encodeURIComponent(cursor):''));
          if(videos.data?.some(video=>String(video.id)===body.videoId&&video.status?.video_status==='ready')){found=true;break;}
          cursor=videos.paging?.next?videos.paging?.cursors?.after:'';if(!cursor)break;
        }
        if(!found)throw new AppError('Select a ready video in the verified ad-account library.',403,'ADS_ASSET_MISMATCH');
      }
      for(const audience of body.customAudiences||[]){const value=await graph(connection.token,audience+'?fields=id,account_id');if(String(value.account_id)!==connection.ad_account_id)throw new AppError('Audience does not belong to this ad account.',403,'ADS_ASSET_MISMATCH');}
      if(!/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId||''))throw new AppError('Provide a unique creation reference.',400,'ADS_REFERENCE_REQUIRED');
      const operation={id:body.requestId,business_id:session.businessId,ad_account_id:connection.ad_account_id,page_id:connection.page_id,phone_number_id:connection.phone_number_id,payload};
      const created=await query("INSERT INTO whatsapp_ads_operations (id,business_id,ad_account_id,page_id,phone_number_id,payload,state) VALUES ($1,$2,$3,$4,$5,$6,'processing') ON CONFLICT DO NOTHING RETURNING id",[operation.id,session.businessId,connection.ad_account_id,connection.page_id,connection.phone_number_id,JSON.stringify(payload)]);
      if(!created.rowCount)throw new AppError('This creation reference already exists. Check its status.',409,'ADS_REFERENCE_EXISTS');
      return json(await createResources(session,connection,operation),201);
    }
    const operation=(await query('SELECT * FROM whatsapp_ads_operations WHERE id=$1 AND business_id=$2',[body.operationId,session.businessId])).rows[0];
    if(!operation||operation.ad_account_id!==connection.ad_account_id)throw new AppError('Ad operation not found.',404,'NOT_FOUND');
    if(!['editCreative','reconcileCreative','pause'].includes(body.action)&&(await query("SELECT 1 FROM whatsapp_ads_creative_edits WHERE business_id=$1 AND operation_id=$2 AND state NOT IN ('complete','rejected')",[session.businessId,operation.id])).rowCount)throw new AppError('Reconcile the pending creative edit before changing this campaign.',409,'ADS_CREATIVE_PENDING');
    if(body.action==='resume'){
      const claimed=await query("UPDATE whatsapp_ads_operations SET state='processing',updated_at=NOW() WHERE id=$1 AND business_id=$2 AND state='partial' RETURNING id",[operation.id,session.businessId]);
      if(!claimed.rowCount)throw new AppError('Only explicitly rejected creation stages can resume.',409,'ADS_STATE_INVALID');
      await verifyConnection(session.businessId,connection);return json(await createResources(session,connection,operation));
    }
    if(body.action==='recover'){
      if(session.role!=='Owner'||operation.state!=='unconfirmed'||!stages.includes(operation.stage)||!metaId(body.providerId))throw new AppError('Only the owner can reconcile an uncertain resource with its Meta ID.',403,'FORBIDDEN');
      const fields=operation.stage==='campaign'?'id,account_id,name,objective,status':operation.stage==='adset'?'id,account_id,campaign_id,name,destination_type,promoted_object':operation.stage==='creative'?'id,account_id,name,object_story_spec':'id,account_id,adset_id,name,creative';
      const value=await graph(connection.token,body.providerId+'?fields='+fields);
      if(String(value.account_id)!==connection.ad_account_id||value.name!==operation.payload[operation.stage].name||(operation.stage==='campaign'&&value.objective!==operation.payload.campaign.objective)||(operation.stage==='adset'&&(String(value.campaign_id)!==operation.campaign_id||value.destination_type!=='WHATSAPP'||String(value.promoted_object?.page_id)!==operation.page_id))||(operation.stage==='ad'&&(String(value.adset_id)!==operation.adset_id||String(value.creative?.id)!==operation.creative_id))||(operation.stage==='creative'&&JSON.stringify(value.object_story_spec)!==JSON.stringify(operation.payload.creative.object_story_spec)))throw new AppError('Meta resource does not match the recorded creation request.',409,'ADS_ASSET_MISMATCH');
      await query("UPDATE whatsapp_ads_operations SET "+operation.stage+"_id=$1,state='partial',error_code='',updated_at=NOW() WHERE id=$2 AND business_id=$3 AND state='unconfirmed'",[body.providerId,operation.id,session.businessId]);
      await audit(session,'whatsapp_ad_recovered',{operationId:operation.id,stage:operation.stage,providerId:body.providerId});return json({ok:true});
    }
    if(!['activate','pause','budget','archive','rename','targeting','reconcileDelivery','editCreative','reconcileCreative'].includes(body.action))throw new AppError('Unsupported advertising action.',400,'INVALID_ACTION');
    if(session.role!=='Owner')throw new AppError('Only the owner can change advertising spend or delivery.',403,'FORBIDDEN');
    if(operation.stage!=='complete')throw new AppError('Complete and reconcile resource creation first.',409,'ADS_STATE_INVALID');
    if(operation.state==='archived')throw new AppError('Archived campaigns cannot be changed.',409,'ADS_STATE_INVALID');
    if(body.action==='editCreative'||body.action==='reconcileCreative')return updateCreative(session,connection,operation,body);
    if(body.action==='activate'&&(body.confirmSpend!==true||body.confirmation!==operation.campaign_id))throw new AppError('Explicitly confirm the campaign and advertising spend.',400,'ADS_SPEND_CONFIRMATION_REQUIRED');
    await verifyConnection(session.businessId,connection);
    const set=await graph(connection.token,operation.adset_id+'?fields=id,account_id,campaign_id,destination_type,promoted_object');
    if(String(set.account_id)!==connection.ad_account_id||String(set.campaign_id)!==operation.campaign_id||set.destination_type!=='WHATSAPP'||String(set.promoted_object?.page_id)!==operation.page_id)throw new AppError('Campaign is not the recorded WhatsApp destination.',403,'ADS_ASSET_MISMATCH');
    if(body.action==='reconcileDelivery'){
      const campaign=await graph(connection.token,operation.campaign_id+'?fields=id,account_id,status');
      const ad=await graph(connection.token,operation.ad_id+'?fields=id,account_id,adset_id,status');
      const adset=await graph(connection.token,operation.adset_id+'?fields=id,account_id,status');
      if(String(campaign.account_id)!==connection.ad_account_id||String(ad.account_id)!==connection.ad_account_id||String(ad.adset_id)!==operation.adset_id||String(adset.account_id)!==connection.ad_account_id)throw new AppError('Meta asset ownership changed.',403,'ADS_ASSET_MISMATCH');
      const state=campaign.status==='ARCHIVED'?'archived':campaign.status==='PAUSED'?'paused':campaign.status==='ACTIVE'&&ad.status==='ACTIVE'&&adset.status==='ACTIVE'?'active':null;
      if(!state)throw new AppError('Meta delivery settings are inconsistent. Pause in Ads Manager and check again.',409,'ADS_UNCONFIRMED');
      await query('UPDATE whatsapp_ads_operations SET state=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3',[state,operation.id,session.businessId]);
      await audit(session,'whatsapp_ad_delivery_reconciled',{operationId:operation.id,state});return json({ok:true,state});
    }
    if(body.action==='rename'){
      const name=clean(body.name);if(!name||name.length>200)throw new AppError('Enter a campaign name of up to 200 characters.',400,'ADS_PAYLOAD_INVALID');
      const result=await graph(connection.token,operation.campaign_id,{name});if(result.success!==true)throw new AppError('Meta did not confirm the campaign name.',409,'ADS_UNCONFIRMED');
      await query("UPDATE whatsapp_ads_operations SET payload=jsonb_set(payload,'{campaign,name}',$1::jsonb),updated_at=NOW() WHERE id=$2 AND business_id=$3",[JSON.stringify(name),operation.id,session.businessId]);
      await audit(session,'whatsapp_ad_renamed',{operationId:operation.id,name});return json({ok:true});
    }
    if(body.action==='targeting'){
      const campaign=await graph(connection.token,operation.campaign_id+'?fields=id,account_id,status');
      if(String(campaign.account_id)!==connection.ad_account_id||campaign.status!=='PAUSED')throw new AppError('Pause the campaign before changing its audience.',409,'ADS_MUST_BE_PAUSED');
      const targeting=whatsappAdTargeting(body);
      for(const audience of body.customAudiences||[]){const value=await graph(connection.token,audience+'?fields=id,account_id');if(String(value.account_id)!==connection.ad_account_id)throw new AppError('Audience does not belong to this ad account.',403,'ADS_ASSET_MISMATCH');}
      const result=await graph(connection.token,operation.adset_id,{targeting});if(result.success!==true)throw new AppError('Meta did not confirm the audience.',409,'ADS_UNCONFIRMED');
      await query("UPDATE whatsapp_ads_operations SET payload=jsonb_set(payload,'{adset,targeting}',$1::jsonb),updated_at=NOW() WHERE id=$2 AND business_id=$3",[JSON.stringify(targeting),operation.id,session.businessId]);
      await audit(session,'whatsapp_ad_targeting_changed',{operationId:operation.id,targeting});return json({ok:true});
    }
    await audit(session,'whatsapp_ad_'+body.action+'_requested',{operationId:operation.id});
    if(body.action==='budget'){
      const campaign=await graph(connection.token,operation.campaign_id+'?fields=id,account_id,status');
      if(String(campaign.account_id)!==connection.ad_account_id||campaign.status!=='PAUSED')throw new AppError('Pause the campaign before changing its budget or schedule.',409,'ADS_MUST_BE_PAUSED');
      const live=await graph(connection.token,operation.adset_id+'?fields=id,account_id,campaign_id,daily_budget,lifetime_budget,start_time,end_time');
      if(String(live.account_id)!==connection.ad_account_id||String(live.campaign_id)!==operation.campaign_id)throw new AppError('Ad set ownership changed.',403,'ADS_ASSET_MISMATCH');
      const budget=whatsappAdBudget(body,connection.currency,{existing:live});
      const result=await graph(connection.token,operation.adset_id,budget);if(result.success!==true)throw new AppError('Meta did not confirm the budget or schedule. Read live status before retrying.',409,'ADS_UNCONFIRMED');
      await query("UPDATE whatsapp_ads_operations SET payload=jsonb_set(payload,'{adset}',(payload->'adset') || $1::jsonb),updated_at=NOW() WHERE id=$2 AND business_id=$3",[JSON.stringify(budget),operation.id,session.businessId]);
      await audit(session,'whatsapp_ad_budget_confirmed',{operationId:operation.id,budget});return json({ok:true});
    }
    const status=body.action==='activate'?'ACTIVE':body.action==='archive'?'ARCHIVED':'PAUSED';
    const targets=['activate','pause'].includes(body.action)?[operation.ad_id,operation.adset_id,operation.campaign_id]:[operation.campaign_id];
    for(const target of targets){const result=await graph(connection.token,target,{status});if(result.success!==true)throw new AppError('Meta did not confirm the delivery change. Read live status before retrying.',409,'ADS_UNCONFIRMED');}
    await query('UPDATE whatsapp_ads_operations SET state=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3',[body.action==='activate'?'active':body.action==='archive'?'archived':'paused',operation.id,session.businessId]);
    await audit(session,'whatsapp_ad_'+body.action+'_confirmed',{operationId:operation.id});return json({ok:true});
}

export function editedWhatsAppCreative(body,connection,number){
  const text=clean(body.text),headline=clean(body.headline),imageHash=clean(body.imageHash);
  if(!text||text.length>2000||!headline||headline.length>255||!/^[a-f0-9]{32}$/i.test(imageHash)||!['image','video'].includes(body.mediaType)||body.mediaType==='video'&&!metaId(body.videoId)||!/^[0-9]{5,20}$/.test(number))throw new AppError('Provide valid text, headline and ad-account media.',400,'ADS_PAYLOAD_INVALID');
  const call_to_action={type:'WHATSAPP_MESSAGE',value:{app_destination:'WHATSAPP',whatsapp_number:number}};
  return {name:clean(body.name),object_story_spec:{page_id:connection.page_id,...(body.mediaType==='video'?{video_data:{video_id:body.videoId,image_hash:imageHash,message:text,title:headline,call_to_action}}:{link_data:{image_hash:imageHash,message:text,name:headline,link:'https://wa.me/'+number,call_to_action}})}};
}

async function updateCreative(session,connection,operation,body){
  if(operation.state!=='paused'||operation.stage!=='complete')throw new AppError('Pause and complete the campaign before editing its creative.',409,'ADS_MUST_BE_PAUSED');
  const verified=await verifyConnection(session.businessId,connection);
  const campaign=await graph(connection.token,operation.campaign_id+'?fields=id,account_id,status');
  const adset=await graph(connection.token,operation.adset_id+'?fields=id,account_id,status,campaign_id');
  const ad=await graph(connection.token,operation.ad_id+'?fields=id,account_id,status,adset_id,creative');
  if(String(campaign.account_id)!==connection.ad_account_id||String(adset.account_id)!==connection.ad_account_id||String(adset.campaign_id)!==operation.campaign_id||String(ad.account_id)!==connection.ad_account_id||String(ad.adset_id)!==operation.adset_id||[campaign,adset,ad].some(item=>item.status!=='PAUSED'))throw new AppError('Pause all Meta delivery and verify asset ownership before editing.',409,'ADS_MUST_BE_PAUSED');
  let edit=(await query("SELECT * FROM whatsapp_ads_creative_edits WHERE business_id=$1 AND operation_id=$2 AND state NOT IN ('complete','rejected') ORDER BY created_at DESC LIMIT 1",[session.businessId,operation.id])).rows[0];
  if(body.action==='editCreative'){
    if(edit)throw new AppError('Reconcile the existing creative edit before creating another.',409,'ADS_CREATIVE_PENDING');
    if(String(ad.creative?.id)!==operation.creative_id)throw new AppError('The live ad creative changed. Reconcile in Ads Manager first.',409,'ADS_ASSET_MISMATCH');
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(body.requestId||''))throw new AppError('Provide a unique edit reference.',400,'ADS_REFERENCE_REQUIRED');
    const name=clean(body.name)||operation.payload.creative.name;
    if(name.length+body.requestId.length+3>200)throw new AppError('Creative name is too long.',400,'ADS_PAYLOAD_INVALID');
    const payload=editedWhatsAppCreative({...body,name:name+' ['+body.requestId+']'},connection,verified.number);
    const images=await graph(connection.token,'act_'+connection.ad_account_id+'/adimages?fields=hash&hashes='+encodeURIComponent(JSON.stringify([body.imageHash])));
    if(!images.data?.some(image=>image.hash===body.imageHash))throw new AppError('Select an image in this ad account.',403,'ADS_ASSET_MISMATCH');
    if(body.mediaType==='video'){
      let found=false,cursor='';
      for(let page=0;page<20;page++){
        const videos=await graph(connection.token,'act_'+connection.ad_account_id+'/advideos?fields=id,status&limit=100'+(cursor?'&after='+encodeURIComponent(cursor):''));
        if(videos.data?.some(video=>String(video.id)===body.videoId&&video.status?.video_status==='ready')){found=true;break;}
        cursor=videos.paging?.next?videos.paging?.cursors?.after:'';if(!cursor)break;
      }
      if(!found)throw new AppError('Select a ready video in this ad account.',403,'ADS_ASSET_MISMATCH');
    }
    const result=await query("INSERT INTO whatsapp_ads_creative_edits(id,business_id,operation_id,payload,previous_creative_id,state) VALUES($1,$2,$3,$4,$5,'creating') ON CONFLICT DO NOTHING RETURNING id",[body.requestId,session.businessId,operation.id,JSON.stringify(payload),operation.creative_id]);
    if(!result.rowCount)throw new AppError('Creative edit reference already exists.',409,'ADS_REFERENCE_EXISTS');
    try{
      const created=await graph(connection.token,'act_'+connection.ad_account_id+'/adcreatives',payload);
      if(!metaId(created.id))throw new AppError('Meta did not confirm the new creative ID.',409,'ADS_UNCONFIRMED');
      await query("UPDATE whatsapp_ads_creative_edits SET creative_id=$1,state='created',updated_at=NOW() WHERE business_id=$2 AND id=$3",[String(created.id),session.businessId,body.requestId]);
      edit={id:body.requestId,creative_id:String(created.id),payload,previous_creative_id:operation.creative_id};
    }catch(error){
      await query('UPDATE whatsapp_ads_creative_edits SET state=$1,error_code=$2,updated_at=NOW() WHERE business_id=$3 AND id=$4',[error.code==='ADS_REJECTED'?'rejected':'unconfirmed',error.code||'ADS_UNCONFIRMED',session.businessId,body.requestId]);
      throw error;
    }
  }else{
    if(!edit)throw new AppError('No creative edit needs reconciliation.',409,'ADS_STATE_INVALID');
    if(!edit.creative_id){
      if(!metaId(body.providerId))throw new AppError('Provide the Meta creative ID from the uncertain creation.',400,'ADS_REFERENCE_REQUIRED');
      const candidate=await graph(connection.token,body.providerId+'?fields=id,account_id,name,object_story_spec');
      if(String(candidate.account_id)!==connection.ad_account_id||candidate.name!==edit.payload.name||JSON.stringify(candidate.object_story_spec)!==JSON.stringify(edit.payload.object_story_spec))throw new AppError('The Meta creative does not match this edit.',409,'ADS_ASSET_MISMATCH');
      await query("UPDATE whatsapp_ads_creative_edits SET creative_id=$1,state='created',updated_at=NOW() WHERE business_id=$2 AND id=$3",[body.providerId,session.businessId,edit.id]);
      edit.creative_id=body.providerId;
    }
    if(String(ad.creative?.id)!==edit.previous_creative_id&&String(ad.creative?.id)!==edit.creative_id)throw new AppError('The live ad has an unexpected creative. Inspect it in Ads Manager.',409,'ADS_ASSET_MISMATCH');
  }
  if(String(ad.creative?.id)!==edit.creative_id){
    await query("UPDATE whatsapp_ads_creative_edits SET state='applying',updated_at=NOW() WHERE business_id=$1 AND id=$2",[session.businessId,edit.id]);
    try{
      const result=await graph(connection.token,operation.ad_id,{creative:{creative_id:edit.creative_id}});
      if(result.success!==true)throw new AppError('Meta did not confirm the ad update.',409,'ADS_UNCONFIRMED');
    }catch(error){
      await query("UPDATE whatsapp_ads_creative_edits SET state='unconfirmed',error_code=$1,updated_at=NOW() WHERE business_id=$2 AND id=$3",[error.code||'ADS_UNCONFIRMED',session.businessId,edit.id]);
      throw error;
    }
  }
  const live=await graph(connection.token,operation.ad_id+'?fields=id,account_id,status,creative');
  if(String(live.account_id)!==connection.ad_account_id||live.status!=='PAUSED'||String(live.creative?.id)!==edit.creative_id)throw new AppError('Meta creative assignment is unconfirmed. Reconcile before retrying.',409,'ADS_UNCONFIRMED');
  await query("UPDATE whatsapp_ads_operations SET creative_id=$1,payload=jsonb_set(payload,'{creative}',$2::jsonb),updated_at=NOW() WHERE business_id=$3 AND id=$4",[edit.creative_id,JSON.stringify(edit.payload),session.businessId,operation.id]);
  await query("UPDATE whatsapp_ads_creative_edits SET state='complete',error_code='',updated_at=NOW() WHERE business_id=$1 AND id=$2",[session.businessId,edit.id]);
  await audit(session,'whatsapp_ad_creative_changed',{operationId:operation.id,creativeId:edit.creative_id,editId:edit.id});
  return json({ok:true,creativeId:edit.creative_id});
}
