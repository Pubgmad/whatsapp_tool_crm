import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getPublicPlatformConfig } from '../../lib/platform';
import { brandAssets, getPublishedSite } from '../../lib/public-site';
import styles from '../public-site.module.css';

export const dynamic = 'force-dynamic';

function TextBlock({ block }) {
  const content =
    block.emphasis === 'bold' ? <strong>{block.text}</strong> : block.emphasis === 'italic' ? <em>{block.text}</em> : block.text;
  if (block.type === 'heading') return <h3>{content}</h3>;
  if (block.type === 'quote') return <blockquote>{content}</blockquote>;
  if (block.type === 'list') return <ul>{block.text.split('\n').map((line, index) => <li key={index}>{line}</li>)}</ul>;
  return <p>{content}</p>;
}

export default async function AboutPage() {
  const [platform, site, assets] = await Promise.all([getPublicPlatformConfig(), getPublishedSite(), brandAssets()]);
  const section =
    site.document.sections?.find((item) => item.visible && item.kind === 'about') ||
    site.document.sections?.find((item) => item.visible && item.id === 'about');
  if (!section) redirect('/#about');
  return (
    <main className={styles.site}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          {assets.logo ? <img src={assets.logo.url} alt={platform.brand_name} width={assets.logo.width} height={assets.logo.height} /> : <span>{platform.brand_name}</span>}
        </Link>
        <nav aria-label="About navigation">
          <Link href="/">Home</Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </header>
      <section className={`${styles.section} ${styles[section.layout]} ${styles[section.align]}`}>
        <div className={styles.inner}>
          <p className={styles.eyebrow}>{section.eyebrow || 'About'}</p>
          <h1>{section.title}</h1>
          <div className={styles.blocks}>{section.blocks.map((block, index) => <TextBlock block={block} key={index} />)}</div>
          {section.ctaLabel && <Link className={styles.textAction} href={section.ctaHref}>{section.ctaLabel}</Link>}
        </div>
      </section>
    </main>
  );
}
