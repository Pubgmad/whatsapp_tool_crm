import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import https from 'node:https';
import {isIP} from 'node:net';
import {load} from 'cheerio';
import mammoth from 'mammoth';
import {PDFParse} from 'pdf-parse';
import {AppError,errorJson,id,json,query,transaction} from './db.js';
import {currentAccount} from './auth.js';
import {enforceRequestRateLimit,readMultipartFormLimited} from './security.js';
import {publicWebhookAddress} from './workspace-integrations.js';
import {reindexKnowledgeChunks} from './ai-knowledge-retrieve.js';
import {aiRuntimeTunables} from './ai-policy.js';

const maxDocumentBytes=2*1024*1024;
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const cleanText=value=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,12000);

export function knowledgePageUrl(raw){
  let url;try{url=new URL(raw);}catch{throw new AppError('Enter a valid HTTPS page URL.',400,'KNOWLEDGE_URL_INVALID');}
  if(url.protocol!=='https:'||url.port&&url.port!=='443'||url.username||url.password||url.hash||isIP(url.hostname)||url.href.length>2000||!url.hostname.includes('.'))throw new AppError('Use a public HTTPS page without credentials.',400,'KNOWLEDGE_URL_INVALID');
  return url;
}

export async function fetchKnowledgePage(raw,{lookup=dns.lookup,request=https.request,userAgent}={}){
  const url=knowledgePageUrl(raw);
  let records;try{records=await lookup(url.hostname,{all:true});}catch{throw new AppError('Could not resolve the knowledge website.',502,'KNOWLEDGE_DNS_FAILED');}
  if(!records?.length||records.some(record=>!publicWebhookAddress(record.address)))throw new AppError('Only public IPv4 knowledge websites are supported.',400,'KNOWLEDGE_ADDRESS_DENIED');
  const pinned=records[0];
  return new Promise((resolve,reject)=>{
    const req=request(url,{method:'GET',agent:false,lookup:(_host,options,callback)=>callback(null,options.all?[pinned]:pinned.address,pinned.family),headers:{accept:'text/html, text/plain;q=0.8','user-agent':userAgent||'KnowledgeImporter/1.0'}},response=>{
      const type=String(response.headers['content-type']||'').toLowerCase();
      if(response.statusCode!==200||!/^text\/(html|plain)(?:;|$)/.test(type)){response.resume();reject(new AppError('The page did not return HTML or plain text.',400,'KNOWLEDGE_PAGE_UNAVAILABLE'));return;}
      const parts=[];let total=0;
      response.on('data',chunk=>{total+=chunk.length;if(total>maxDocumentBytes){req.destroy(new AppError('The page is too large.',413,'KNOWLEDGE_TOO_LARGE'));return;}parts.push(chunk);});
      response.on('end',()=>resolve({body:Buffer.concat(parts),type}));response.on('error',reject);
    });
    req.setTimeout(10000,()=>req.destroy(new AppError('The website timed out.',504,'KNOWLEDGE_TIMEOUT')));
    req.on('error',reject);req.end();
  });
}

export async function extractKnowledge(bytes,type){
  let raw;
  if(type==='website'||type==='html'){
    const $=load(bytes.toString('utf8'));
    $('script,style,nav,footer,form,iframe,noscript,svg').remove();
    raw=$('main').text()||$('article').text()||$('body').text();
  }else if(type==='txt'||type==='md')raw=bytes.toString('utf8');
  else if(type==='docx')raw=(await mammoth.extractRawText({buffer:bytes})).value;
  else if(type==='pdf'){
    const parser=new PDFParse({data:new Uint8Array(bytes)});
    try{raw=(await parser.getText()).text;}finally{await parser.destroy();}
  }else throw new AppError('Upload a TXT, Markdown, HTML, DOCX or PDF document.',415,'KNOWLEDGE_FORMAT_UNSUPPORTED');
  const content=cleanText(raw);
  if(content.length<20)throw new AppError('The source has too little readable text.',400,'KNOWLEDGE_EMPTY');
  return content;
}

export async function importAiKnowledge(request){
  try{
    const account=await currentAccount(request);
    if(account.role!=='Owner')throw new AppError('Only the workspace owner can import knowledge.',403,'FORBIDDEN');
    await enforceRequestRateLimit(request,account.user.id,'ai');
    const form=await readMultipartFormLimited(request,maxDocumentBytes+8192);
    const title=String(form.get('title')||'').trim();
    if(!title||title.length>120)throw new AppError('Provide a source title up to 120 characters.',400,'VALIDATION_ERROR');
    const url=String(form.get('url')||'').trim();
    const file=form.get('file');
    if(Boolean(url)===Boolean(file))throw new AppError('Provide one website URL or one document.',400,'KNOWLEDGE_SOURCE_INVALID');
    let bytes,type,sourceUrl=null,kind;
    if(url){
      const {buildKnowledgeImportUserAgent}=await import('./platform.js');
      const userAgent=await buildKnowledgeImportUserAgent();
      const page=await fetchKnowledgePage(url,{userAgent});
      bytes=page.body;type=page.type.startsWith('text/html')?'website':'txt';sourceUrl=knowledgePageUrl(url).href;kind='website';
    }
    else{
      const name=String(file.name||'').toLowerCase();type=name.split('.').at(-1);
      if(!['txt','md','html','docx','pdf'].includes(type)||file.size>maxDocumentBytes||file.size<1)throw new AppError('Upload a supported document under 2 MB.',400,'KNOWLEDGE_FORMAT_UNSUPPORTED');
      bytes=Buffer.from(await file.arrayBuffer());kind='document';
    }
    const content=await extractKnowledge(bytes,type);
    const businessId=account.business.id;
    const documentId=id('aik');
    await transaction(async client=>{
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[businessId]);
      const tunables=await aiRuntimeTunables(client.query.bind(client));
      const count=(await client.query('SELECT COUNT(*)::int AS total FROM ai_agent_knowledge WHERE business_id=$1',[businessId])).rows[0].total;
      if(count>=tunables.knowledgeLimit)throw new AppError('Knowledge limit reached.',409,'KNOWLEDGE_LIMIT');
      await client.query('INSERT INTO ai_agent_knowledge(id,business_id,title,content,is_active,source_kind,source_url,source_hash,sync_status,last_synced_at) VALUES($1,$2,$3,$4,FALSE,$5,$6,$7,$8,NOW())',[documentId,businessId,title,content,kind,sourceUrl,digest(bytes),sourceUrl?'synced':'idle']);
      await reindexKnowledgeChunks(client,{businessId,knowledgeId:documentId,content});
      await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),businessId,account.user.id,'ai_knowledge_imported',JSON.stringify({documentId,kind,sourceUrl})]);
    });
    return json({id:documentId,content,active:false});
  }catch(error){return errorJson(error);}
}

export async function resyncAiKnowledge({businessId,userId,knowledgeId}){
  if(!/^aik_[a-f0-9]{16}$/.test(knowledgeId||''))throw new AppError('Invalid knowledge ID.',400,'VALIDATION_ERROR');
  const row=(await query('SELECT * FROM ai_agent_knowledge WHERE business_id=$1 AND id=$2',[businessId,knowledgeId])).rows[0];
  if(!row)throw new AppError('Knowledge not found.',404,'NOT_FOUND');
  if(row.source_kind!=='website'||!row.source_url)throw new AppError('Only website sources can be re-synced.',409,'KNOWLEDGE_SYNC_UNSUPPORTED');
  await query("UPDATE ai_agent_knowledge SET sync_status='syncing',sync_error='',updated_at=NOW() WHERE business_id=$1 AND id=$2",[businessId,knowledgeId]);
  try{
    const {buildKnowledgeImportUserAgent}=await import('./platform.js');
    const userAgent=await buildKnowledgeImportUserAgent();
    const page=await fetchKnowledgePage(row.source_url,{userAgent});
    const type=page.type.startsWith('text/html')?'website':'txt';
    const content=await extractKnowledge(page.body,type);
    const hash=digest(page.body);
    await transaction(async client=>{
      await client.query(
        `UPDATE ai_agent_knowledge
         SET content=$1,source_hash=$2,sync_status='synced',last_synced_at=NOW(),sync_error='',updated_at=NOW()
         WHERE business_id=$3 AND id=$4`,
        [content,hash,businessId,knowledgeId]
      );
      const embeddingEnabled=(await client.query('SELECT embedding_enabled FROM ai_agent_settings WHERE business_id=$1',[businessId])).rows[0]?.embedding_enabled!==false;
      await reindexKnowledgeChunks(client,{businessId,knowledgeId,content,embeddingEnabled});
      await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),businessId,userId,'ai_knowledge_resynced',JSON.stringify({documentId:knowledgeId})]);
    });
    return {id:knowledgeId,content,changed:hash!==row.source_hash};
  }catch(error){
    await query("UPDATE ai_agent_knowledge SET sync_status='failed',sync_error=$1,updated_at=NOW() WHERE business_id=$2 AND id=$3",[String(error?.code||error?.message||'SYNC_FAILED').slice(0,120),businessId,knowledgeId]);
    throw error;
  }
}
