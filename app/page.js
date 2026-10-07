import Link from 'next/link';
import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {authenticateSessionToken,SESSION_COOKIE_NAME} from '../lib/auth';
import {isSessionFailure} from '../lib/auth-navigation';
import {query} from '../lib/db';
import {getPublicPlatformConfig} from '../lib/platform';
import {brandAssets,getPublishedSite} from '../lib/public-site';
import styles from './public-site.module.css';

export const dynamic='force-dynamic';

function TextBlock({block}){
  const content=block.emphasis==='bold'?<strong>{block.text}</strong>:block.emphasis==='italic'?<em>{block.text}</em>:block.text;
  if(block.type==='heading')return <h3>{content}</h3>;
  if(block.type==='quote')return <blockquote>{content}</blockquote>;
  if(block.type==='list')return <ul>{block.text.split('\n').map((line,index)=><li key={index}>{line}</li>)}</ul>;
  return <p>{content}</p>;
}

export default async function HomePage(){
  const token=(await cookies()).get(SESSION_COOKIE_NAME)?.value;
  let authenticated=false;
  try{await authenticateSessionToken(token);authenticated=true;}
  catch(error){if(!isSessionFailure(error))throw error;}
  if(authenticated)redirect('/app/dashboard');
  const [platform,site,assets,plans]=await Promise.all([
    getPublicPlatformConfig(),getPublishedSite(),brandAssets(),
    query('SELECT id,name,description,currency,monthly_price_cents,yearly_price_cents,features FROM subscription_plans WHERE is_active AND visible ORDER BY display_order,name LIMIT 12').then(result=>result.rows)
  ]);
  const sections=site.document.sections.filter(section=>section.visible&&section.kind!=='terms');
  const termsPublished=site.document.sections.some(section=>section.visible&&section.kind==='terms');
  return <main className={styles.site}>
    <header className={styles.header}><Link href='/' className={styles.brand}>{assets.logo?<img src={assets.logo.url} alt={platform.brand_name} width={assets.logo.width} height={assets.logo.height}/>:<span>{platform.brand_name}</span>}</Link><nav aria-label='Public navigation'>{sections.map(section=><a href={'#'+section.id} key={section.id}>{section.title}</a>)}{plans.length>0&&<a href='#pricing'>{platform.public_pricing_heading}</a>}<Link href='/login'>Sign in</Link></nav><Link className={styles.headerAction} href='/signup'>{platform.public_signup_label}</Link></header>
    <div className={styles.intro} style={assets.hero?{backgroundImage:`linear-gradient(90deg,rgba(10,27,29,.92),rgba(10,27,29,.42)),url("${assets.hero.url}")`}:undefined}><div className={styles.inner}><p className={styles.eyebrow}>{platform.product_tagline}</p><h1>{platform.brand_name}</h1><p>{platform.workspace_intro}</p><div className={styles.actions}><Link className={styles.primary} href='/signup'>{platform.public_signup_label}</Link><Link className={styles.secondary} href='/login'>Sign in</Link></div></div></div>
    {sections.map(section=><section className={`${styles.section} ${styles[section.layout]} ${styles[section.align]}`} id={section.id} key={section.id}><div className={styles.inner}><p className={styles.eyebrow}>{section.eyebrow||section.kind.replaceAll('-',' ')}</p><h2>{section.title}</h2><div className={styles.blocks}>{section.blocks.map((block,index)=><TextBlock block={block} key={index}/>)}</div>{section.ctaLabel&&<Link className={styles.textAction} href={section.ctaHref}>{section.ctaLabel} <span aria-hidden>&rarr;</span></Link>}</div></section>)}
    {plans.length>0&&<section className={styles.pricing} id='pricing'><div className={styles.inner}><h2>{platform.public_pricing_heading}</h2><div className={styles.planGrid}>{plans.map(plan=><article className={styles.plan} key={plan.id}><h3>{plan.name}</h3>{plan.description&&<p>{plan.description}</p>}<strong>{new Intl.NumberFormat(undefined,{style:'currency',currency:plan.currency}).format(plan.monthly_price_cents/100)} <small>/ month</small></strong>{Array.isArray(plan.features)&&plan.features.length>0&&<ul>{plan.features.map((feature,index)=><li key={index}>{feature}</li>)}</ul>}<Link href='/signup'>{platform.public_signup_label} <span aria-hidden>&rarr;</span></Link></article>)}</div></div></section>}
    <footer className={styles.footer}><div className={styles.inner}><strong>{platform.brand_name}</strong><div><Link href='/privacy-policy'>Privacy</Link>{termsPublished&&<Link href='/terms'>Terms</Link>}<Link href='/login'>Sign in</Link>{platform.support_email&&<a href={'mailto:'+platform.support_email}>Contact</a>}</div><small>{platform.company_name}</small></div></footer>
  </main>;
}
