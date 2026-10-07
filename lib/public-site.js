import crypto from 'node:crypto';
import sharp from 'sharp';
import {AppError,query,transaction} from './db.js';

const sectionKinds=new Set(['overview','features','integrations','about','faq','security','contact','terms']);
const blockKinds=new Set(['paragraph','heading','list','quote','link','image']);
const imageAssets=new Set(['logo','hero','custom']);
const layouts=new Set(['plain','split','columns']);
const alignments=new Set(['left','center']);
const assetKinds=new Set(['logo','favicon','hero']);
const isObject=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const value=(input,max)=>{
  if(typeof input!=='string'||input.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input))throw new AppError('Invalid public site content.',400,'SITE_INVALID');
  return input.trim();
};
const fail=()=>{throw new AppError('Invalid public site content.',400,'SITE_INVALID');};

function localLink(input){
  const path=value(input,240);
  if(!path)return '';
  if(!/^\/(?!\/)[a-zA-Z0-9/_#?=&.%\-]*$/.test(path))fail();
  return path;
}

function externalHttpsLink(input){
  const href=value(input,240);
  if(!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?(?:\/[^\s]*)?$/.test(href))fail();
  return href;
}

function validateNavLinks(items,max){
  if(items===undefined)return [];
  if(!Array.isArray(items)||items.length>max)fail();
  return items.map(item=>{
    if(!isObject(item)||Object.keys(item).some(key=>!['label','href'].includes(key)))fail();
    return {label:value(item.label,60),href:localLink(item.href)};
  });
}

function validateSocialLinks(items){
  if(items===undefined)return [];
  if(!Array.isArray(items)||items.length>6)fail();
  return items.map(item=>{
    if(!isObject(item)||Object.keys(item).some(key=>!['label','href'].includes(key)))fail();
    return {label:value(item.label,40),href:externalHttpsLink(item.href)};
  });
}

export function validateSiteDocument(input){
  if(!isObject(input)||Object.keys(input).some(key=>!['sections','footerLinks','socialLinks'].includes(key))||!Array.isArray(input.sections)||input.sections.length>14)fail();
  const ids=new Set();
  const sections=input.sections.map(section=>{
    if(!isObject(section)||Object.keys(section).some(key=>!['id','kind','title','eyebrow','visible','layout','align','blocks','ctaLabel','ctaHref'].includes(key)))fail();
    const id=value(section.id,48);
    if(!/^[a-z][a-z0-9-]*$/.test(id)||ids.has(id)||!sectionKinds.has(section.kind))fail();
    ids.add(id);
    if(!Array.isArray(section.blocks)||section.blocks.length>12)fail();
    const blocks=section.blocks.map(block=>{
      if(!isObject(block)||!blockKinds.has(block.type))fail();
      if(block.type==='link'){
        if(Object.keys(block).some(key=>!['type','label','href','emphasis'].includes(key)))fail();
        const label=value(block.label,120);
        const href=localLink(block.href);
        if(!label||!href||!['none','bold','italic'].includes(block.emphasis||'none'))fail();
        return {type:'link',label,href,emphasis:block.emphasis||'none',text:label};
      }
      if(block.type==='image'){
        if(Object.keys(block).some(key=>!['type','asset','href','alt','text'].includes(key)))fail();
        const asset=imageAssets.has(block.asset)?block.asset:'custom';
        const href=asset==='custom'?externalHttpsLink(block.href):'';
        const alt=value(block.alt||block.text||'',120);
        if(asset==='custom'&&!href)fail();
        return {type:'image',asset,href,alt,text:alt};
      }
      if(Object.keys(block).some(key=>!['type','text','emphasis'].includes(key)))fail();
      const text=value(block.text,1200);
      if(!text||!['none','bold','italic'].includes(block.emphasis||'none'))fail();
      return {type:block.type,text,emphasis:block.emphasis||'none'};
    });
    const title=value(section.title,120);
    const ctaLabel=value(section.ctaLabel||'',60);
    const ctaHref=localLink(section.ctaHref||'');
    if(!title||Boolean(ctaLabel)!==Boolean(ctaHref)||typeof section.visible!=='boolean')fail();
    if(!layouts.has(section.layout)||!alignments.has(section.align))fail();
    return {id,kind:section.kind,title,eyebrow:value(section.eyebrow||'',60),visible:section.visible,layout:section.layout,align:section.align,blocks,ctaLabel,ctaHref};
  });
  return {sections,footerLinks:validateNavLinks(input.footerLinks,8),socialLinks:validateSocialLinks(input.socialLinks)};
}

export function mergePublicFooterLinks(cmsLinks,defaults){
  const seen=new Set();
  const merged=[];
  for(const link of [...(Array.isArray(cmsLinks)?cmsLinks:[]),...(Array.isArray(defaults)?defaults:[])]){
    if(!link?.href||seen.has(link.href))continue;
    seen.add(link.href);
    merged.push({label:String(link.label||'').trim(),href:link.href});
  }
  return merged;
}

export async function getPublishedSite(){
  const row=(await query("SELECT published,published_revision,published_at FROM public_site_documents WHERE id='current'")).rows[0];
  const published=row?.published||{sections:[]};
  let defaults=[];
  try{
    defaults=(await query("SELECT value FROM platform_settings WHERE key='public_default_footer_links'")).rows[0]?.value||[];
  }catch(error){
    if(error?.code!=='DB_NOT_CONFIGURED'&&error?.code!=='42P01')throw error;
  }
  const document={
    ...published,
    sections:published.sections||[],
    footerLinks:mergePublicFooterLinks(published.footerLinks,defaults),
    socialLinks:published.socialLinks||[]
  };
  return {document,revision:row?.published_revision||0,publishedAt:row?.published_at||null};
}

export async function getSiteDraft(){
  const row=(await query("SELECT draft,revision,published_revision,updated_at,published_at FROM public_site_documents WHERE id='current'")).rows[0];
  if(!row)throw new AppError('Initialize the public site database first.',503,'SITE_NOT_READY');
  return {document:row.draft,revision:row.revision,publishedRevision:row.published_revision,updatedAt:row.updated_at,publishedAt:row.published_at};
}

export async function changeSiteDraft({action,revision,document}){
  if(!Number.isSafeInteger(revision)||revision<1||!['save','publish'].includes(action))fail();
  return transaction(async client=>{
    const current=(await client.query("SELECT revision,draft FROM public_site_documents WHERE id='current' FOR UPDATE")).rows[0];
    if(!current)throw new AppError('Initialize the public site database first.',503,'SITE_NOT_READY');
    if(current.revision!==revision)throw new AppError('The public site was edited elsewhere. Reload before saving.',409,'SITE_REVISION_CONFLICT');
    if(action==='save'){
      const validated=validateSiteDocument(document);
      await client.query("UPDATE public_site_documents SET draft=$1,revision=revision+1,updated_at=now() WHERE id='current'",[JSON.stringify(validated)]);
    }else{
      const validated=validateSiteDocument(current.draft);
      await client.query("UPDATE public_site_documents SET published=$1,published_revision=revision,revision=revision+1,published_at=now(),updated_at=now() WHERE id='current'",[JSON.stringify(validated)]);
    }
    const row=(await client.query("SELECT draft,revision,published_revision,updated_at,published_at FROM public_site_documents WHERE id='current'")).rows[0];
    return {document:row.draft,revision:row.revision,publishedRevision:row.published_revision,updatedAt:row.updated_at,publishedAt:row.published_at};
  });
}

export async function brandAssets(){
  const rows=(await query('SELECT kind,version,width,height,updated_at FROM platform_brand_assets')).rows;
  return Object.fromEntries(rows.map(row=>[row.kind,{url:`/api/platform/asset/${row.kind}?v=${row.version}`,width:row.width,height:row.height,updatedAt:row.updated_at}]));
}

export async function saveBrandAsset(kind,bytes){
  if(!assetKinds.has(kind)||!Buffer.isBuffer(bytes)||bytes.length<32||bytes.length>5_000_000)throw new AppError('Choose an image under 5 MB.',400,'ASSET_INVALID');
  let metadata;
  try{metadata=await sharp(bytes,{limitInputPixels:16_000_000,failOn:'error'}).metadata();}
  catch{throw new AppError('The image could not be decoded.',400,'ASSET_INVALID');}
  if(!['png','jpeg','webp'].includes(metadata.format)||!metadata.width||!metadata.height||metadata.width>4000||metadata.height>4000||metadata.width<16||metadata.height<16)throw new AppError('Upload a PNG, JPEG or WebP image from 16 to 4000 pixels.',400,'ASSET_INVALID');
  if(kind==='favicon'&&(metadata.width!==metadata.height||metadata.width>1024))throw new AppError('Favicon must be square and at most 1024 pixels.',400,'ASSET_INVALID');
  if(kind==='hero'&&(metadata.width<1200||metadata.height<500))throw new AppError('Hero image must be at least 1200 by 500 pixels.',400,'ASSET_INVALID');
  const image=await sharp(bytes,{limitInputPixels:16_000_000,failOn:'error'}).rotate().webp({quality:85,effort:4}).toBuffer();
  const dimensions=await sharp(image).metadata();
  const version=crypto.createHash('sha256').update(image).digest('hex').slice(0,16);
  await query(`INSERT INTO platform_brand_assets(kind,media_type,image_data,width,height,version) VALUES($1,'image/webp',$2,$3,$4,$5)
    ON CONFLICT(kind) DO UPDATE SET media_type=excluded.media_type,image_data=excluded.image_data,width=excluded.width,height=excluded.height,version=excluded.version,updated_at=now()`,[kind,image,dimensions.width,dimensions.height,version]);
  return {url:`/api/platform/asset/${kind}?v=${version}`,width:dimensions.width,height:dimensions.height};
}

export async function removeBrandAsset(kind){
  if(!assetKinds.has(kind))fail();
  await query('DELETE FROM platform_brand_assets WHERE kind=$1',[kind]);
}

export async function loadBrandAsset(kind){
  if(!assetKinds.has(kind))return null;
  return (await query('SELECT image_data,media_type,version FROM platform_brand_assets WHERE kind=$1',[kind])).rows[0]||null;
}
