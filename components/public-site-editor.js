'use client';

import {useEffect,useState} from 'react';
import {ArrowDown,ArrowUp,Eye,Plus,Save,Trash2,Upload} from 'lucide-react';
import styles from './public-site-editor.module.css';

const kinds=['overview','features','integrations','about','faq','security','contact','terms'];
const layouts=['plain','split','columns'];
const blockTypes=['paragraph','heading','list','quote'];
const newSection=()=>({id:`section-${Date.now()}`,kind:'overview',title:'New section',eyebrow:'',visible:true,layout:'plain',align:'left',blocks:[{type:'paragraph',text:'Add section content here.',emphasis:'none'}],ctaLabel:'',ctaHref:''});

function PreviewBlock({block}){
  const content=block.emphasis==='bold'?<strong>{block.text}</strong>:block.emphasis==='italic'?<em>{block.text}</em>:block.text;
  if(block.type==='heading')return <h4>{content}</h4>;
  if(block.type==='quote')return <blockquote>{content}</blockquote>;
  if(block.type==='list')return <ul>{block.text.split('\n').map((line,index)=><li key={index}>{line}</li>)}</ul>;
  return <p>{content}</p>;
}

export default function PublicSiteEditor({api,notify}){
  const [snapshot,setSnapshot]=useState(null);
  const [document,setDocument]=useState({sections:[]});
  const [assets,setAssets]=useState({});
  const [selected,setSelected]=useState(0);
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const load=async()=>{const result=await api('/api/super-admin/site');setSnapshot(result.site);setDocument(result.site.document);setAssets(result.assets);setDirty(false);};
  useEffect(()=>{load().catch(reason=>setError(reason.message));},[]);
  const change=sections=>{setDocument({sections});setDirty(true);};
  const update=(index,patch)=>change(document.sections.map((section,i)=>i===index?{...section,...patch}:section));
  const move=(index,by)=>{const next=[...document.sections];const target=index+by;if(target<0||target>=next.length)return;[next[index],next[target]]=[next[target],next[index]];change(next);setSelected(target);};
  const persist=async publish=>{
    if(!snapshot)return;
    setBusy(true);setError('');
    try{
      let next=snapshot;
      if(dirty){next=(await api('/api/super-admin/site',{method:'POST',body:JSON.stringify({action:'save',revision:next.revision,document})})).site;setSnapshot(next);setDocument(next.document);setDirty(false);}
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
    <div className={styles.header}><div><h2>Public website</h2><p>Draft revision {snapshot.revision} | Published revision {snapshot.publishedRevision||'none'}</p></div><div className={styles.actions}><a href='/' target='_blank' rel='noreferrer' title='Open published website'><Eye size={17}/> View site</a><button type='button' onClick={()=>persist(false)} disabled={busy||!dirty}><Save size={17}/> Save draft</button><button type='button' className={styles.publish} onClick={()=>persist(true)} disabled={busy}><Upload size={17}/> Publish</button></div></div>
    {error&&<p className={styles.error} role='alert'>{error}</p>}
    <div className={styles.grid}><div className={styles.sectionList}><h3>Sections</h3>{document.sections.map((section,index)=><button type='button' className={selected===index?styles.active:''} onClick={()=>setSelected(index)} key={section.id}><strong>{section.title}</strong><small>{section.kind} | {section.visible?'Visible':'Hidden'}</small></button>)}<button type='button' className={styles.add} onClick={()=>{change([...document.sections,newSection()]);setSelected(document.sections.length);}} disabled={document.sections.length>=14}><Plus size={16}/> Add section</button></div>
      <div className={styles.fields}>{current?<><div className={styles.row}><label>Section type<select value={current.kind} onChange={event=>update(selected,{kind:event.target.value})}>{kinds.map(kind=><option key={kind}>{kind}</option>)}</select></label><label>Layout<select value={current.layout} onChange={event=>update(selected,{layout:event.target.value})}>{layouts.map(layout=><option key={layout}>{layout}</option>)}</select></label><label>Alignment<select value={current.align} onChange={event=>update(selected,{align:event.target.value})}><option>left</option><option>center</option></select></label></div><div className={styles.row}><label>Anchor ID<input value={current.id} onChange={event=>update(selected,{id:event.target.value})}/></label><label>Eyebrow<input value={current.eyebrow} onChange={event=>update(selected,{eyebrow:event.target.value})}/></label></div><label>Heading<input value={current.title} onChange={event=>update(selected,{title:event.target.value})}/></label><div className={styles.row}><label>CTA label<input value={current.ctaLabel} onChange={event=>update(selected,{ctaLabel:event.target.value})}/></label><label>CTA destination<input value={current.ctaHref} placeholder='/signup' onChange={event=>update(selected,{ctaHref:event.target.value})}/></label></div><label className={styles.checkbox}><input type='checkbox' checked={current.visible} onChange={event=>update(selected,{visible:event.target.checked})}/> Visible on public website</label><div className={styles.blocksHeader}><h3>Content blocks</h3><button type='button' onClick={()=>update(selected,{blocks:[...current.blocks,{type:'paragraph',text:'New paragraph',emphasis:'none'}]})} disabled={current.blocks.length>=12}><Plus size={16}/> Add block</button></div>{current.blocks.map((block,index)=><div className={styles.block} key={index}><div className={styles.row}><label>Format<select value={block.type} onChange={event=>update(selected,{blocks:current.blocks.map((item,i)=>i===index?{...item,type:event.target.value}:item)})}>{blockTypes.map(type=><option key={type}>{type}</option>)}</select></label><label>Emphasis<select value={block.emphasis} onChange={event=>update(selected,{blocks:current.blocks.map((item,i)=>i===index?{...item,emphasis:event.target.value}:item)})}><option>none</option><option>bold</option><option>italic</option></select></label><button type='button' title='Remove block' onClick={()=>update(selected,{blocks:current.blocks.filter((_,i)=>i!==index)})}><Trash2 size={16}/></button></div><textarea rows={block.type==='list'?5:3} value={block.text} onChange={event=>update(selected,{blocks:current.blocks.map((item,i)=>i===index?{...item,text:event.target.value}:item)})}/></div>)}<div className={styles.actions}><button type='button' title='Move up' onClick={()=>move(selected,-1)} disabled={selected===0}><ArrowUp size={16}/></button><button type='button' title='Move down' onClick={()=>move(selected,1)} disabled={selected===document.sections.length-1}><ArrowDown size={16}/></button><button type='button' onClick={()=>{change(document.sections.filter((_,i)=>i!==selected));setSelected(Math.max(0,selected-1));}}><Trash2 size={16}/> Remove section</button></div><div className={`${styles.preview} ${current.align==='center'?styles.previewCenter:''}`}><small>Section preview</small><h3>{current.title}</h3>{current.blocks.map((block,index)=><PreviewBlock block={block} key={index}/>)}{current.ctaLabel&&<strong>{current.ctaLabel}</strong>}</div></>:<div className={styles.empty}>Add a section to build the public website.</div>}</div></div>
    <div className={styles.assets}><h3>Platform images</h3><div>{['logo','favicon','hero'].map(kind=><div className={styles.asset} key={kind}><strong>{kind}</strong>{assets[kind]?<img src={assets[kind].url} alt={kind}/>:<span>Not uploaded</span>}<label className={styles.file}><Upload size={16}/> Replace<input type='file' accept='image/png,image/jpeg,image/webp' onChange={event=>upload(event,kind)} disabled={busy}/></label>{assets[kind]&&<button type='button' title={'Remove '+kind} onClick={()=>removeAsset(kind)} disabled={busy}><Trash2 size={16}/></button>}</div>)}</div></div>
  </section>;
}
