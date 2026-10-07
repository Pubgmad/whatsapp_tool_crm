import {notFound} from 'next/navigation';
import {getPublishedSite} from '../../lib/public-site';
import styles from '../public-site.module.css';

export const dynamic='force-dynamic';
export const metadata={title:'Terms'};
export default async function TermsPage(){
  const {document}=await getPublishedSite();
  const section=document.sections.find(item=>item.kind==='terms'&&item.visible);
  if(!section)notFound();
  return <main className={styles.site}><article className={styles.section}><div className={styles.inner}><a href='/'>Home</a><h1>{section.title}</h1><div className={styles.blocks}>{section.blocks.map((block,index)=>block.type==='heading'?<h2 key={index}>{block.text}</h2>:block.type==='list'?<ul key={index}>{block.text.split('\n').map((line,i)=><li key={i}>{line}</li>)}</ul>:block.type==='quote'?<blockquote key={index}>{block.text}</blockquote>:<p key={index}>{block.text}</p>)}</div></div></article></main>;
}
