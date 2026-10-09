'use client';

import {useEffect,useState} from 'react';
import {ArrowDown,ArrowUp,Eye,Plus,Save,Trash2,Upload} from 'lucide-react';
import PublicHtmlBlock from './public-html-block';
import styles from './public-site-editor.module.css';

const kinds=['overview','features','integrations','about','faq','security','contact','terms'];
const layouts=['plain','split','columns'];
const blockTypes=['paragraph','heading','list','quote','link','image','html'];
const newSection=()=>({id:`section-${Date.now()}`,kind:'overview',title:'New section',eyebrow:'',visible:true,layout:'plain',align:'left',blocks:[{type:'paragraph',text:'Add section content here.',emphasis:'none'}],ctaLabel:'',ctaHref:''});
const emptyHtmlBlock=()=>({type:'html',text:'<!-- Paste full HTML / CSS / JS design here. It renders the same on the public website. -->\n<section style="padding:48px;font-family:Georgia,serif;background:#0f2f33;color:#f4fffc">\n  <h2 style="font-size:40px;margin:0 0 12px">Your designed section</h2>\n  <p style="margin:0;font-size:18px;line-height:1.6">Replace this with your marketing HTML.</p>\n</section>',emphasis:'none'});

function PreviewBlock({block,assets}){
  if(block.type==='html')return <PublicHtmlBlock markup={block.text} className={styles.htmlPreview} minHeight={180} title='Design preview'/>;
  if(block.type==='link')return <p><a href={block.href}>{block.label}</a></p>;
  if(block.type==='image'){
    const src=block.asset==='logo'?assets?.logo?.url:block.asset==='hero'?assets?.hero?.url:block.href;
    return src?<img src={src} alt={block.alt||''} style={{maxWidth:'100%'}}/>:<p><em>Image</em></p>;
  }
  const content=block.emphasis==='bold'?<strong>{block.text}</strong>:block.emphasis==='italic'?<em>{block.text}</em>:block.text;
  if(block.type==='heading')return <h4>{content}</h4>;
  if(block.type==='quote')return <blockquote>{content}</blockquote>;
  if(block.type==='list')return <ul>{block.text.split('\n').map((line,index)=><li key={index}>{line}</li>)}</ul>;
  return <p>{content}</p>;
}

function normalizeBlockType(block,type){
  if(type==='html')return {...emptyHtmlBlock(),text:block.type==='html'&&block.text?block.text:emptyHtmlBlock().text};
  if(type==='link')return {type:'link',label:block.label||block.text||'Learn more',href:block.href||'/signup',emphasis:'none',text:block.label||block.text||'Learn more'};
  if(type==='image')return {type:'image',asset:block.asset||'hero',href:block.href||'',alt:block.alt||block.text||'Image',text:block.alt||block.text||'Image'};
  return {type,text:block.text||'New content',emphasis:block.emphasis||'none'};
}

export default function PublicSiteEditor({api,notify}){
  const [snapshot,setSnapshot]=useState(null);
  const [document,setDocument]=useState({sections:[],footerLinks:[],socialLinks:[]});
  const [assets,setAssets]=useState({});
  const [selected,setSelected]=useState(0);
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const load=async()=>{const result=await api('/api/super-admin/site');setSnapshot(result.site);setDocument({sections:result.site.document?.sections||[],footerLinks:result.site.document?.footerLinks||[],socialLinks:result.site.document?.socialLinks||[]});setAssets(result.assets);setDirty(false);};
  useEffect(()=>{load().catch(reason=>setError(reason.message));},[]);
  const change=patch=>{setDocument(current=>({...current,...patch}));setDirty(true);};
  const update=(index,patch)=>change({sections:document.sections.map((section,i)=>i===index?{...section,...patch}:section)});
  const move=(index,by)=>{const next=[...document.sections];const target=index+by;if(target<0||target>=next.length)return;[next[index],next[target]]=[next[target],next[index]];change({sections:next});setSelected(target);};
  const persist=async publish=>{
    if(!snapshot)return;
    setBusy(true);setError('');
    try{
      let next=snapshot;
      if(dirty){next=(await api('/api/super-admin/site',{method:'POST',body:JSON.stringify({action:'save',revision:next.revision,document})})).site;setSnapshot(next);setDocument({sections:next.document?.sections||[],footerLinks:next.document?.footerLinks||[],socialLinks:next.document?.socialLinks||[]});setDirty(false);}
      if(publish){next=(await api('/api/super-admin/site',{method:'POST',body:JSON.stringify({action:'publish',revision:next.revision})})).site;setSnapshot(next);}
      notify(publish?'Public site published':'Draft saved');
    }catch(reason){setError(reason.message);}finally{setBusy(false);}
  };
  const upload=async(event,kind)=>{
    const file=event.target.files?.[0];if(!file)return;
    setBusy(true);setError('');
    try{
      const tokenResult=await api('/api/security/csrf');
      const form=new FormData();form.append('kind',kind);form.append('file',file);
      const response=await fetch('/api/super-admin/site/asset',{method:'POST',body:form,headers:{'x-csrf-token':tokenResult.csrfToken},credentials:'same-origin'});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Image upload failed');
      setAssets(result.assets);notify('Image updated');
    }catch(reason){setError(reason.message);}finally{setBusy(false);event.target.value='';}
  };
  const removeAsset=async kind=>{setBusy(true);setError('');try{const result=await api('/api/super-admin/site/asset',{method:'DELETE',body:JSON.stringify({kind})});setAssets(result.assets);notify('Image removed');}catch(reason){setError(reason.message);}finally{setBusy(false);}};
  if(!snapshot)return <section className={styles.editor}><h2>Public website</h2><p>{error||'Loading content...'}</p><button type='button' onClick={()=>load().catch(reason=>setError(reason.message))}>Retry</button></section>;
  const current=document.sections[selected];
  return <section className={styles.editor}>
    <div className={styles.header}><div><h2>Public website</h2><p>Draft revision {snapshot.revision} | Published revision {snapshot.publishedRevision||'none'}</p><p className={styles.hint}>Use block format <strong>html</strong> to paste combined HTML/CSS/JS. It renders as the same designed content on the public CRM website. A section that contains only html blocks is shown full-width without the default heading chrome. Scripts run inside a sandbox and cannot access Super Admin or customer sessions.</p></div><div className={styles.actions}><a href='/' target='_blank' rel='noreferrer' title='Open published website'><Eye size={17}/> View site</a><button type='button' onClick={()=>persist(false)} disabled={busy||!dirty}><Save size={17}/> Save draft</button><button type='button' className={styles.publish} onClick={()=>persist(true)} disabled={busy}><Upload size={17}/> Publish</button></div></div>
    {error&&<p className={styles.error} role='alert'>{error}</p>}
    <div className={styles.grid}><div className={styles.sectionList}><h3>Sections</h3>{document.sections.map((section,index)=><button type='button' className={selected===index?styles.active:''} onClick={()=>setSelected(index)} key={section.id}><strong>{section.title}</strong><small>{section.kind} | {section.visible?'Visible':'Hidden'}</small></button>)}<button type='button' className={styles.add} onClick={()=>{change({sections:[...document.sections,newSection()]});setSelected(document.sections.length);}} disabled={document.sections.length>=14}><Plus size={16}/> Add section</button></div>
      <div className={styles.fields}>{current?<><div className={styles.row}><label>Section type<select value={current.kind} onChange={event=>update(selected,{kind:event.target.value})}>{kinds.map(kind=><option key={kind}>{kind}</option>)}</select></label><label>Layout<select value={current.layout} onChange={event=>update(selected,{layout:event.target.value})}>{layouts.map(layout=><option key={layout}>{layout}</option>)}</select></label><label>Alignment<select value={current.align} onChange={event=>update(selected,{align:event.target.value})}><option>left</option><option>center</option></select></label></div><div className={styles.row}><label>Anchor ID<input value={current.id} onChange={event=>update(selected,{id:event.target.value})}/></label><label>Eyebrow<input value={current.eyebrow} onChange={event=>update(selected,{eyebrow:event.target.value})}/></label></div><label>Heading<input value={current.title} onChange={event=>update(selected,{title:event.target.value})}/></label><div className={styles.row}><label>CTA label<input value={current.ctaLabel} onChange={event=>update(selected,{ctaLabel:event.target.value})}/></label><label>CTA destination<input value={current.ctaHref} placeholder='/signup' onChange={event=>update(selected,{ctaHref:event.target.value})}/></label></div><label className={styles.checkbox}><input type='checkbox' checked={current.visible} onChange={event=>update(selected,{visible:event.target.checked})}/> Visible on public website</label><div className={styles.blocksHeader}><h3>Content blocks</h3><div className={styles.blockActions}><button type='button' onClick={()=>update(selected,{blocks:[...current.blocks,emptyHtmlBlock()]})} disabled={current.blocks.length>=12}><Plus size={16}/> Add HTML design</button><button type='button' onClick={()=>update(selected,{blocks:[...current.blocks,{type:'paragraph',text:'New paragraph',emphasis:'none'}]})} disabled={current.blocks.length>=12}><Plus size={16}/> Add block</button></div></div>{current.blocks.map((block,index)=><div className={styles.block} key={index}><div className={styles.row}><label>Format<select value={block.type} onChange={event=>update(selected,{blocks:current.blocks.map((item,i)=>i===index?normalizeBlockType(item,event.target.value):item)})}>{blockTypes.map(type=><option key={type}>{type}</option>)}</select></label>{block.type!=='link'&&block.type!=='image'&&block.type!=='html'&&<label>Emphasis<select value={block.emphasis} onChange={event=>update(selected,{blocks:current.blocks.map((item,i)=>i===index?{...item,emphasis:event.target.value}:item)})}><option>none</option><option>bold</option><option>italic</option></select></label>}<button type='button' title='Remove block' onClick={()=>update(selected,{blocks:current.blocks.filter((_,i)=>i!==index)})}><Trash2 size={16}/></button></div>{block.type==='link'&&<div className={styles.row}><label>Label<input value={block.label||''} onChange={event=>update(selected,{blocks:current.blocks.map((item,i)=>i===index?{...item,label:event.target.value,text:event.target.value}:item)})}/></label><label>Path<input value={block.href||''} placeholder='/signup' onChange={event=>update(selected,{blocks:current.blocks.map((item,i)=>i===index?{...item,href:event.target.value}:item)})}/></label></div>}{block.type==='image'&&<div className={styles.row}><label>Asset<select value={block.asset||'hero'} onChange={event=>update(selected,{blocks:current.blocks.map((item,i)=>i===index?{...item,asset:event.target.value}:item)})}><option value='logo'>Logo</option><option value='hero'>Hero</option><option value='custom'>Custom HTTPS URL</option></select></label>{block.asset==='custom'&&<label>Image URL<input value={block.href||''} onChange={event=>update(selected,{blocks:current.blocks.map((item,i)=>i===index?{...item,href:event.target.value}:item)})}/></label>}<label>Alt text<input value={block.alt||''} onChange={event=>update(selected,{blocks:current.blocks.map((item,i)=>i===index?{...item,alt:event.target.value,text:event.target.value}:item)})}/></label></div>}{block.type==='html'&&<p className={styles.blockHint}>Paste your full design markup (HTML + CSS + JS). Save and publish to show it on the live site.</p>}{block.type!=='link'&&block.type!=='image'&&<textarea className={block.type==='html'?styles.htmlCode:undefined} rows={block.type==='html'?18:block.type==='list'?5:3} spellCheck={block.type!=='html'} value={block.text} onChange={event=>update(selected,{blocks:current.blocks.map((item,i)=>i===index?{...item,text:event.target.value}:item)})}/>}</div>)}<div className={styles.actions}><button type='button' title='Move up' onClick={()=>move(selected,-1)} disabled={selected===0}><ArrowUp size={16}/></button><button type='button' title='Move down' onClick={()=>move(selected,1)} disabled={selected===document.sections.length-1}><ArrowDown size={16}/></button><button type='button' onClick={()=>{change({sections:document.sections.filter((_,i)=>i!==selected)});setSelected(Math.max(0,selected-1));}}><Trash2 size={16}/> Remove section</button></div><div className={`${styles.preview} ${current.align==='center'?styles.previewCenter:''}`}><small>Section preview</small>{!(current.blocks.length>0&&current.blocks.every(block=>block.type==='html'))&&<h3>{current.title}</h3>}{current.blocks.map((block,index)=><PreviewBlock block={block} assets={assets} key={index}/>)}{current.ctaLabel&&<strong>{current.ctaLabel}</strong>}</div></>:<div className={styles.empty}>Add a section to build the public website.</div>}</div></div>
    <div className={styles.assets}><h3>Footer and social</h3><p>Edit footer links (same-origin paths) and external social profiles.</p>{document.footerLinks.map((link,index)=><div className={styles.row} key={`f-${index}`}><label>Label<input value={link.label} onChange={event=>change({footerLinks:document.footerLinks.map((item,i)=>i===index?{...item,label:event.target.value}:item)})}/></label><label>Path<input value={link.href} onChange={event=>change({footerLinks:document.footerLinks.map((item,i)=>i===index?{...item,href:event.target.value}:item)})}/></label><button type='button' onClick={()=>change({footerLinks:document.footerLinks.filter((_,i)=>i!==index)})}><Trash2 size={16}/></button></div>)}<button type='button' disabled={document.footerLinks.length>=8} onClick={()=>change({footerLinks:[...document.footerLinks,{label:'Link',href:'/signup'}]})}><Plus size={16}/> Footer link</button>{document.socialLinks.map((link,index)=><div className={styles.row} key={`s-${index}`}><label>Network<input value={link.label} onChange={event=>change({socialLinks:document.socialLinks.map((item,i)=>i===index?{...item,label:event.target.value}:item)})}/></label><label>HTTPS URL<input value={link.href} onChange={event=>change({socialLinks:document.socialLinks.map((item,i)=>i===index?{...item,href:event.target.value}:item)})}/></label><button type='button' onClick={()=>change({socialLinks:document.socialLinks.filter((_,i)=>i!==index)})}><Trash2 size={16}/></button></div>)}<button type='button' disabled={document.socialLinks.length>=6} onClick={()=>{const href=window.prompt('HTTPS social profile URL');if(!href)return;change({socialLinks:[...document.socialLinks,{label:'Social profile',href}]})}}><Plus size={16}/> Social link</button></div>
    <div className={styles.assets}><h3>Platform images</h3><div>{['logo','favicon','hero'].map(kind=><div className={styles.asset} key={kind}><strong>{kind}</strong>{assets[kind]?<img src={assets[kind].url} alt={kind}/>:<span>Not uploaded</span>}<label className={styles.file}><Upload size={16}/> Replace<input type='file' accept='image/png,image/jpeg,image/webp' onChange={event=>upload(event,kind)} disabled={busy}/></label>{assets[kind]&&<button type='button' title={'Remove '+kind} onClick={()=>removeAsset(kind)} disabled={busy}><Trash2 size={16}/></button>}</div>)}</div></div>
  </section>;
}
