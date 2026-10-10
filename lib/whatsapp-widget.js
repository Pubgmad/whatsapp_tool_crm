import { requireSession } from './auth.js';
import { AppError, query, transaction, json, errorJson, id, enterSystemContext } from './db.js';
import { readJsonBodyLimited, enforceRequestRateLimit, requestIp } from './security.js';
// readJsonBodyLimited used by manageWidgets + trackWidgetEvent
import { requireWorkspaceManager } from './workspace-permissions.js';

function invalid() { throw new AppError('Provide a label, message, HTTPS website origins, color and position.',400,'WIDGET_INVALID'); }
export function widgetInput(body) {
  if (!body || typeof body.label!=='string' || !body.label.trim() || body.label.length>40 || typeof body.message!=='string' || body.message.length>512 || !/^#[a-fA-F0-9]{6}$/.test(body.color||'') || !['left','right'].includes(body.position) || typeof body.enabled!=='boolean') invalid();
  if (!Array.isArray(body.origins) || !body.origins.length || body.origins.length>20) invalid();
  const origins=body.origins.map(value=>{
    let url;try { url=new URL(value); } catch { invalid(); }
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.href.length>300)invalid();
    return url.origin;
  });
  return {label:body.label.trim(),message:body.message.trim(),color:body.color.toLowerCase(),position:body.position,enabled:body.enabled,origins:[...new Set(origins)]};
}
export function widgetScript(config) {
  const phone=String(config.phone||'').replace(/[\s()+-]/g,'');
  if(!/^[1-9][0-9]{6,14}$/.test(phone))throw new AppError('The connected number is unavailable.',409,'WIDGET_PHONE_INVALID');
  const input=widgetInput(config),url=new URL('https://wa.me/'+phone);
  if(input.message)url.searchParams.set('text',input.message);
  const rgb=[1,3,5].map(offset=>parseInt(input.color.slice(offset,offset+2),16)/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);
  const foreground=rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722>0.179?'#000000':'#ffffff';
  const trackUrl=String(config.trackUrl||'').trim();
  const data=JSON.stringify({id:config.id,label:input.label,url:url.href,origins:input.origins,color:input.color,position:input.position,foreground,trackUrl}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  return `(()=>{'use strict';const c=${data};if(!c.origins.includes(window.location.origin)||document.getElementById('wa-widget-'+c.id))return;
    const track=(kind)=>{if(!c.trackUrl)return;try{const body=JSON.stringify({kind,origin:window.location.origin});if(navigator.sendBeacon)navigator.sendBeacon(c.trackUrl,new Blob([body],{type:'application/json'}));else fetch(c.trackUrl,{method:'POST',headers:{'content-type':'application/json'},body,mode:'cors',keepalive:true,credentials:'omit'});}catch(_){}};
    const mount=()=>{if(!document.body||document.getElementById('wa-widget-'+c.id))return;const host=document.createElement('div');host.id='wa-widget-'+c.id;
      Object.assign(host.style,{position:'fixed',bottom:'max(16px, env(safe-area-inset-bottom))',[c.position]:'16px',zIndex:'2147483000',maxWidth:'calc(100vw - 32px)'});
      const root=host.attachShadow({mode:'closed'}),link=document.createElement('a');link.href=c.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=c.label;
      Object.assign(link.style,{display:'block',padding:'12px 16px',borderRadius:'6px',background:c.color,color:c.foreground,font:'600 14px/1.4 system-ui,sans-serif',textDecoration:'none',overflowWrap:'anywhere',boxSizing:'border-box',boxShadow:'0 2px 8px #0003'});
      link.addEventListener('click',()=>track('click'));track('impression');
      root.appendChild(link);document.body.appendChild(host);};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();})();`;
}
export async function manageWidgets(request) {
  try {
    const session=await requireSession(request);requireWorkspaceManager(session);
    const phoneId=new URL(request.url).searchParams.get('phoneId');
    if(request.method==='GET') {
      const widgets=(await query('SELECT id,label,prefilled_message AS message,allowed_origins AS origins,color,position,enabled FROM whatsapp_website_widgets WHERE business_id=$1 AND phone_id=$2 ORDER BY created_at DESC LIMIT 100',[session.businessId,phoneId])).rows;
      const origin=new URL(process.env.APP_URL||request.url).origin;
      const stats=(await query(
        `SELECT widget_id,
           COUNT(*) FILTER (WHERE event_kind='impression' AND created_at>NOW()-INTERVAL '30 days')::int AS impressions_30d,
           COUNT(*) FILTER (WHERE event_kind='click' AND created_at>NOW()-INTERVAL '30 days')::int AS clicks_30d
         FROM whatsapp_widget_events WHERE business_id=$1 AND widget_id=ANY($2::text[])
         GROUP BY widget_id`,
        [session.businessId, widgets.map((widget) => widget.id)]
      )).rows;
      const byId=Object.fromEntries(stats.map((row) => [row.widget_id, row]));
      return json({widgets:widgets.map(widget=>({
        ...widget,
        scriptUrl:origin+'/api/public/whatsapp-widget/'+widget.id,
        impressions30d:byId[widget.id]?.impressions_30d||0,
        clicks30d:byId[widget.id]?.clicks_30d||0
      }))});
    }
    if(session.role!=='Owner')throw new AppError('Only the owner can publish website widgets.',403,'FORBIDDEN');
    const body=await readJsonBodyLimited(request,12288);
    if(!['save','delete'].includes(body.action))invalid();
    const widgetId=body.id||id('widget');
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(widgetId))invalid();
    const config=body.action==='save'?widgetInput(body):null;
    await transaction(async client=>{
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[session.businessId]);
      if(body.action==='delete') {
        if(!(await client.query('DELETE FROM whatsapp_website_widgets WHERE business_id=$1 AND id=$2 RETURNING id',[session.businessId,widgetId])).rowCount)throw new AppError('Widget not found.',404,'NOT_FOUND');
      }else {
        if(!(await client.query("SELECT 1 FROM whatsapp_phone_numbers p JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id WHERE p.id=$1 AND p.business_id=$2 AND a.status='connected'",[body.phoneId,session.businessId])).rowCount)throw new AppError('Select a connected workspace phone.',400,'WIDGET_PHONE_INVALID');
        if(body.id){
          if(!(await client.query('UPDATE whatsapp_website_widgets SET phone_id=$1,label=$2,prefilled_message=$3,allowed_origins=$4,color=$5,position=$6,enabled=$7,updated_at=NOW() WHERE id=$8 AND business_id=$9 RETURNING id',[body.phoneId,config.label,config.message,JSON.stringify(config.origins),config.color,config.position,config.enabled,widgetId,session.businessId])).rowCount)throw new AppError('Widget not found.',404,'NOT_FOUND');
        }else {
          if((await client.query('SELECT COUNT(*)::int AS count FROM whatsapp_website_widgets WHERE business_id=$1',[session.businessId])).rows[0].count>=100)throw new AppError('Remove unused widgets before creating another.',409,'WIDGET_LIMIT');
          await client.query('INSERT INTO whatsapp_website_widgets (id,business_id,phone_id,label,prefilled_message,allowed_origins,color,position,enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[widgetId,session.businessId,body.phoneId,config.label,config.message,JSON.stringify(config.origins),config.color,config.position,config.enabled]);
        }
      }
      await client.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'website_widget_'+body.action,JSON.stringify({widgetId})]);
    });
    return json({ok:true,id:widgetId});
  }catch(error){return errorJson(error);}
}
export async function serveWidget(request,context) {
  const headers={'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'cross-origin'};
  try {
    const {id:widgetId}=await context.params;
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(widgetId))return new Response('',{status:404,headers});
    enterSystemContext();
    await enforceRequestRateLimit(request,'widget:'+requestIp(request));
    const row=(await query(`SELECT w.*,p.display_phone_number AS phone FROM whatsapp_website_widgets w
      JOIN businesses b ON b.id=w.business_id AND b.account_status='active'
      JOIN whatsapp_phone_numbers p ON p.id=w.phone_id AND p.business_id=w.business_id AND p.registration_state='registered'
      JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=w.business_id AND a.status='connected'
      WHERE w.id=$1 AND w.enabled AND (a.token_expires_at IS NULL OR a.token_expires_at>NOW())`,[widgetId])).rows[0];
    if(!row)return new Response('',{status:404,headers});
    let appOrigin='';
    try{appOrigin=new URL(process.env.APP_URL||'').origin;}catch{appOrigin='';}
    const trackUrl=appOrigin?`${appOrigin}/api/public/whatsapp-widget/${encodeURIComponent(widgetId)}/click`:'';
    return new Response(widgetScript({...row,message:row.prefilled_message,origins:row.allowed_origins,trackUrl}),{headers});
  }catch(error){return new Response('',{status:error.status||503,headers});}
}

export async function trackWidgetEvent(request, context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Cache-Control': 'no-store'
  };
  if (request.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  try {
    const { id: widgetId } = await context.params;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(widgetId || '')) return new Response('', { status: 404, headers: cors });
    enterSystemContext();
    await enforceRequestRateLimit(request, 'widget-track:' + requestIp(request));
    const body = await readJsonBodyLimited(request, 2048).catch(() => ({}));
    const kind = body?.kind === 'impression' ? 'impression' : 'click';
    const origin = String(body?.origin || request.headers.get('origin') || '').trim().slice(0, 300);
    const row = (await query(
      `SELECT w.id,w.business_id,w.allowed_origins
       FROM whatsapp_website_widgets w
       JOIN businesses b ON b.id=w.business_id AND b.account_status='active'
       WHERE w.id=$1 AND w.enabled`,
      [widgetId]
    )).rows[0];
    if (!row) return new Response('', { status: 404, headers: cors });
    const allowed = Array.isArray(row.allowed_origins) ? row.allowed_origins : [];
    if (origin && allowed.length && !allowed.includes(origin)) {
      return new Response('', { status: 403, headers: cors });
    }
    await query(
      `INSERT INTO whatsapp_widget_events(id,business_id,widget_id,event_kind,origin,user_agent)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [id('wwe'), row.business_id, widgetId, kind, origin, String(request.headers.get('user-agent') || '').slice(0, 300)]
    );
    return new Response(JSON.stringify({ ok: true }), {
      status: 202,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response('', { status: error.status || 503, headers: cors });
  }
}
