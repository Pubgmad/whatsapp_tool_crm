import Link from 'next/link';
import PublicHtmlBlock from './public-html-block';
import styles from '../app/marketing.module.css';

function hrefFor(block) {
  return block.href || '#';
}

function ActionLink({ block, className }) {
  const href = hrefFor(block);
  const classNames = className || (block.style === 'secondary' ? styles.btnSecondary : block.style === 'text' ? styles.btnText : styles.btnPrimary);
  if (block.linkType === 'external' || href.startsWith('http')) {
    return <a className={classNames} href={href} target={block.openInNewTab ? '_blank' : undefined} rel="noopener noreferrer">{block.label}</a>;
  }
  return <Link className={classNames} href={href}>{block.label}</Link>;
}

export function MarketingBlock({ block, assets }) {
  if (!block) return null;
  if (block.type === 'html') return <PublicHtmlBlock markup={block.text} className={styles.htmlEmbed} title="Designed section" />;
  if (block.type === 'video') {
    return (
      <div className={styles.videoEmbed}>
        <iframe title={block.title || 'Video'} src={block.href} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
      </div>
    );
  }
  if (block.type === 'link' || block.type === 'button') return <p><ActionLink block={block} /></p>;
  if (block.type === 'image') {
    const src = block.asset === 'logo' ? assets?.logo?.url : block.asset === 'hero' ? assets?.hero?.url : block.href;
    if (!src) return null;
    return (
      <figure className={`${styles.blockImage} ${styles[`img-${block.width || 'normal'}`] || ''}`}>
        <img src={src} alt={block.alt || ''} width={assets?.[block.asset]?.width} height={assets?.[block.asset]?.height} />
      </figure>
    );
  }
  if (block.type === 'card' || block.type === 'feature-item') {
    const body = (
      <>
        <h3>{block.title}</h3>
        {block.text ? <p>{block.text}</p> : null}
      </>
    );
    return (
      <article className={block.type === 'feature-item' ? styles.featureCard : styles.card}>
        {block.href ? (block.href.startsWith('http') ? <a href={block.href} rel="noopener noreferrer">{body}</a> : <Link href={block.href}>{body}</Link>) : body}
      </article>
    );
  }
  if (block.type === 'faq-item') {
    return (
      <details>
        <summary>{block.title}</summary>
        <p>{block.text}</p>
      </details>
    );
  }
  if (block.type === 'stat') {
    return (
      <article className={styles.statCard}>
        <strong>{block.title}</strong>
        <span>{block.text}</span>
      </article>
    );
  }
  const content = block.emphasis === 'bold' ? <strong>{block.text}</strong> : block.emphasis === 'italic' ? <em>{block.text}</em> : block.text;
  if (block.type === 'heading') return <h3>{content}</h3>;
  if (block.type === 'quote') return <blockquote className={styles.quote}>{content}</blockquote>;
  if (block.type === 'list') return <ul className={styles.list}>{String(block.text || '').split('\n').filter(Boolean).map((line, index) => <li key={index}>{line}</li>)}</ul>;
  return <p>{content}</p>;
}

function sectionBlocks(section, assets) {
  const cards = section.blocks.filter((block) => block.type === 'card' || block.type === 'feature-item');
  const stats = section.blocks.filter((block) => block.type === 'stat');
  const faqs = section.blocks.filter((block) => block.type === 'faq-item');
  const rest = section.blocks.filter((block) => !['card', 'feature-item', 'stat', 'faq-item'].includes(block.type));
  const image = rest.find((block) => block.type === 'image');
  const copy = rest.filter((block) => block.type !== 'image');

  if (section.preset === 'feature-grid' || section.preset === 'cards') {
    return (
      <>
        {copy.length > 0 && <div className={styles.blocks}>{copy.map((block, index) => <MarketingBlock block={block} assets={assets} key={`c-${index}`} />)}</div>}
        <div className={`${styles.grid} ${section.preset === 'feature-grid' ? styles.gridFeatures : styles.gridCards}`}>
          {cards.map((block, index) => <MarketingBlock block={block} assets={assets} key={`g-${index}`} />)}
        </div>
      </>
    );
  }
  if (section.preset === 'stats') {
    return <div className={`${styles.grid} ${styles.gridStats}`}>{stats.map((block, index) => <MarketingBlock block={block} assets={assets} key={index} />)}</div>;
  }
  if (section.preset === 'faq') {
    return <div className={`${styles.blocks} ${styles.faq}`}>{faqs.map((block, index) => <MarketingBlock block={block} assets={assets} key={index} />)}</div>;
  }
  if (section.preset === 'split-media' && image) {
    const splitClass = section.mediaSide === 'left' ? styles.splitMediaLeft : styles.splitMediaRight;
    return (
      <div className={`${styles.split} ${splitClass}`}>
        <div className={`${styles.blocks} copy`}>{copy.map((block, index) => <MarketingBlock block={block} assets={assets} key={index} />)}</div>
        <MarketingBlock block={image} assets={assets} />
      </div>
    );
  }
  if (section.preset === 'columns') {
    return <div className={styles.blocks} style={{ columns: 2, columnGap: 28 }}>{section.blocks.map((block, index) => <MarketingBlock block={block} assets={assets} key={index} />)}</div>;
  }
  return <div className={styles.blocks}>{section.blocks.map((block, index) => <MarketingBlock block={block} assets={assets} key={index} />)}</div>;
}

export function MarketingSection({ section, assets }) {
  if (!section || section.visible === false) return null;
  const className = [
    styles.section,
    styles[`pad-${section.padding || 'normal'}`],
    styles[`bg-${section.background || 'default'}`],
    styles[`align-${section.align || 'left'}`],
    section.preset === 'cta-band' ? styles.ctaBand : ''
  ].filter(Boolean).join(' ');

  return (
    <section className={className} id={section.id}>
      <div className={styles.inner}>
        {(section.eyebrow || section.title) && (
          <div className={styles.sectionHead}>
            {section.eyebrow ? <p className={styles.eyebrow}>{section.eyebrow}</p> : null}
            {section.title ? <h2>{section.title}</h2> : null}
          </div>
        )}
        {sectionBlocks(section, assets)}
        {section.ctaLabel && section.ctaHref ? (
          <p style={{ marginTop: 22 }}>
            <Link className={styles.btnPrimary} href={section.ctaHref}>{section.ctaLabel}</Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function MarketingHero({ page, assets, signupLabel }) {
  const hero = page?.hero;
  if (!hero?.enabled) return null;
  const imageUrl = hero.image === 'custom' ? hero.imageUrl : hero.image === 'hero' ? assets?.hero?.url : '';
  return (
    <section
      className={`${styles.hero} ${imageUrl ? '' : styles.heroSolo}`}
      style={imageUrl ? { ['--hero-image']: `url("${imageUrl}")` } : undefined}
    >
      <div>
        {(page.eyebrow || hero.title) && <p className={styles.eyebrow}>{page.eyebrow || 'Product'}</p>}
        <h1>{hero.title || page.title}</h1>
        {hero.subtitle ? <p className={styles.heroLead}>{hero.subtitle}</p> : page.summary ? <p className={styles.heroLead}>{page.summary}</p> : null}
        <div className={styles.heroActions}>
          {hero.ctaLabel && hero.ctaHref ? <Link className={styles.btnPrimary} href={hero.ctaHref}>{hero.ctaLabel}</Link> : null}
          <Link className={styles.btnSecondary} href="/login" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.35)', background: 'rgba(255,255,255,.08)' }}>
            {signupLabel ? 'Sign in' : 'Sign in'}
          </Link>
        </div>
      </div>
      {imageUrl ? <div className={styles.heroPanel} aria-hidden /> : null}
    </section>
  );
}

export function MarketingFooter({ brandName, footer, supportEmail }) {
  const links = footer?.links || [];
  const social = footer?.socialLinks || [];
  const columns = footer?.columns || [];
  return (
    <footer className={styles.footer}>
      <div className={styles.footerTop}>
        <div>
          <strong>{brandName}</strong>
          {footer?.blurb ? <p>{footer.blurb}</p> : null}
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <strong>{column.title}</strong>
            {column.links?.map((link) => <Link href={link.href} key={link.href + link.label}>{link.label}</Link>)}
          </div>
        ))}
        <div>
          <strong>Explore</strong>
          {links.map((link) => <Link href={link.href} key={link.href + link.label}>{link.label}</Link>)}
          <Link href="/login">Sign in</Link>
          {supportEmail ? <a href={`mailto:${supportEmail}`}>Contact</a> : null}
        </div>
      </div>
      <div className={styles.footerBottom}>
        {social.length > 0 && (
          <div className={styles.social}>
            {social.map((link) => <a href={link.href} key={link.href} rel="noopener noreferrer" target="_blank">{link.label}</a>)}
          </div>
        )}
        <small>{brandName}</small>
      </div>
    </footer>
  );
}
