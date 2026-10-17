import Link from 'next/link';
import { Bot, Box, FileText, Grid3x3, Megaphone, MessageCircle, Phone, Puzzle, Shield, Sparkles, Workflow } from 'lucide-react';
import PublicHtmlBlock from './public-html-block';
import styles from '../app/marketing.module.css';

const PRODUCT_ICONS = {
  message: MessageCircle,
  phone: Phone,
  megaphone: Megaphone,
  bot: Bot,
  spark: Sparkles,
  workflow: Workflow,
  form: FileText,
  grid: Grid3x3,
  shield: Shield,
  integrations: Puzzle,
  products: Box,
  automation: Workflow
};

function productExploreHref(product) {
  if (product.href) return product.href;
  if (product.slug) return `/products/${product.slug}`;
  return '/products';
}

export function MarketingProductShowcase({ products = [], compact = false }) {
  const visible = (Array.isArray(products) ? products : []).filter((product) => product.visible !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!visible.length) return null;
  return (
    <div className={`${styles.productShowcase} ${compact ? styles.productShowcaseCompact : ''}`}>
      <div className={styles.productGrid}>
        {visible.map((product) => {
          const Icon = PRODUCT_ICONS[product.icon] || Box;
          const href = product.ctaHref || productExploreHref(product);
          const cta = product.ctaLabel || 'Explore';
          return (
            <article className={styles.productCard} key={product.id}>
              <div className={styles.productIcon} aria-hidden><Icon size={22} /></div>
              <h3>{product.title}</h3>
              {product.summary ? <p>{product.summary}</p> : null}
              {Array.isArray(product.benefits) && product.benefits.length > 0 && (
                <ul className={styles.productBenefits}>
                  {product.benefits.slice(0, 3).map((line) => <li key={line}>{line}</li>)}
                </ul>
              )}
              <Link className={`${styles.btnSecondary} ${styles.productCta}`} href={href}>{cta}</Link>
            </article>
          );
        })}
      </div>
    </div>
  );
}

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

function sectionBlocks(section, assets, products) {
  if (section.preset === 'product-showcase') {
    return <MarketingProductShowcase products={products} />;
  }
  const cards = section.blocks.filter((block) => block.type === 'card' || block.type === 'feature-item');
  const stats = section.blocks.filter((block) => block.type === 'stat');
  const faqs = section.blocks.filter((block) => block.type === 'faq-item');
  const rest = section.blocks.filter((block) => !['card', 'feature-item', 'stat', 'faq-item'].includes(block.type));
  const image = rest.find((block) => block.type === 'image');
  const copy = rest.filter((block) => block.type !== 'image');

  if (section.preset === 'feature-grid' || section.preset === 'cards' || section.preset === 'steps') {
    return (
      <>
        {copy.length > 0 && <div className={styles.blocks}>{copy.map((block, index) => <MarketingBlock block={block} assets={assets} key={`c-${index}`} />)}</div>}
        <div className={`${styles.grid} ${section.preset === 'feature-grid' ? styles.gridFeatures : section.preset === 'steps' ? styles.gridSteps : styles.gridCards}`}>
          {cards.map((block, index) => (
            <div className={section.preset === 'steps' ? styles.stepCard : undefined} key={`g-${index}`}>
              {section.preset === 'steps' ? <span className={styles.stepIndex} aria-hidden="true">{index + 1}</span> : null}
              <MarketingBlock block={block} assets={assets} />
            </div>
          ))}
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

export function MarketingSection({ section, assets, products = [] }) {
  if (!section || section.visible === false) return null;
  const className = [
    styles.section,
    styles[`pad-${section.padding || 'normal'}`],
    styles[`bg-${section.background || 'default'}`],
    styles[`align-${section.align || 'left'}`],
    section.preset === 'cta-band' ? styles.ctaBand : '',
    section.preset === 'steps' ? styles.stepsSection : '',
    section.preset === 'feature-grid' ? styles.capabilitySection : '',
    section.preset === 'product-showcase' ? styles.productShowcaseSection : ''
  ].filter(Boolean).join(' ');

  return (
    <section className={className} id={section.id}>
      <div className={styles.inner}>
        {(section.eyebrow || section.title) && (
          <div className={styles.sectionHead}>
            {section.eyebrow ? <p className={styles.eyebrow}>{section.eyebrow}</p> : null}
            {section.title ? <h2>{section.title}</h2> : null}
            {section.summary ? <p className={styles.sectionLead}>{section.summary}</p> : null}
          </div>
        )}
        {sectionBlocks(section, assets, products)}
        {section.ctaLabel && section.ctaHref ? (
          <p className={styles.sectionCta}>
            <Link className={styles.btnPrimary} href={section.ctaHref}>{section.ctaLabel}</Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}

function resolveHeroImageUrl(hero, assets) {
  if (!hero) return '';
  if (hero.image === 'custom') return String(hero.imageUrl || '').trim();
  if (hero.image === 'hero') return String(assets?.hero?.url || '').trim();
  return '';
}

function resolveSecondaryHeroCta(page, hero) {
  if (hero?.secondaryCTA?.href) {
    return {
      href: hero.secondaryCTA.href,
      label: hero.secondaryCTA.label || 'Learn more'
    };
  }
  const kind = page?.kind;
  if (kind === 'feature') return { href: '/features', label: 'Browse features' };
  if (kind === 'product') return { href: '/products', label: 'All products' };
  if (kind === 'integrations' || kind === 'integration') return { href: '/integrations', label: 'All integrations' };
  if (kind === 'solution') return { href: '/solutions', label: 'All solutions' };
  if (kind === 'home') return { href: '/products', label: 'Explore products' };
  if (kind === 'pricing') return { href: '/contact', label: 'Talk to us' };
  return { href: '/login', label: 'Sign in' };
}

function HeroShowcase({ kind, title }) {
  const label = kind === 'solution' ? 'Use case' : kind === 'product' ? 'Product suite' : kind === 'integrations' ? 'Connector' : 'Capability';
  return (
    <div className={styles.heroVisual} aria-hidden="true">
      <div className={styles.heroVisualFrame}>
        <div className={styles.heroVisualBar}>
          <span /><span /><span />
          <em>{label}</em>
        </div>
        <div className={styles.heroVisualBody}>
          <strong>{title || 'WhatsApp CRM'}</strong>
          <div className={styles.heroVisualRows}>
            <i /><i /><i />
          </div>
          <div className={styles.heroVisualCards}>
            <b /><b /><b />
          </div>
        </div>
      </div>
    </div>
  );
}

export function MarketingHero({ page, assets }) {
  const hero = page?.hero;
  if (!hero?.enabled) return null;
  const imageUrl = resolveHeroImageUrl(hero, assets);
  // Custom uploaded images get a photo panel; site "hero" assets only tint the background.
  const showPhotoPanel = hero.image === 'custom' && Boolean(imageUrl);
  const isDetail = ['feature', 'product', 'solution', 'integrations', 'integration'].includes(page?.kind);
  // Detail pages always keep a right-column visual so solo heroes are not a left strip + void.
  const showVisual = showPhotoPanel || isDetail;
  const secondary = resolveSecondaryHeroCta(page, hero);
  const primaryHref = String(hero.ctaHref || '').trim();
  const showSecondary = secondary.href && secondary.href !== primaryHref;
  return (
    <section
      className={`${styles.hero} ${showVisual ? '' : styles.heroSolo} ${isDetail ? styles.heroFeature : ''}`}
      style={imageUrl ? { ['--hero-image']: `url("${imageUrl}")` } : undefined}
    >
      <div>
        {(page.eyebrow || hero.title) && <p className={styles.eyebrow}>{page.eyebrow || 'Product'}</p>}
        <h1>{hero.title || page.title}</h1>
        {hero.subtitle ? <p className={styles.heroLead}>{hero.subtitle}</p> : page.summary ? <p className={styles.heroLead}>{page.summary}</p> : null}
        <div className={styles.heroActions}>
          {hero.ctaLabel && primaryHref ? (
            <Link className={styles.btnPrimary} href={primaryHref}>{hero.ctaLabel}</Link>
          ) : null}
          {showSecondary ? (
            <Link
              className={styles.btnSecondary}
              href={secondary.href}
              style={{ color: '#fff', borderColor: 'rgba(255,255,255,.35)', background: 'rgba(255,255,255,.08)' }}
            >
              {secondary.label}
            </Link>
          ) : null}
        </div>
      </div>
      {showPhotoPanel ? (
        <div className={styles.heroPanel} aria-hidden />
      ) : isDetail ? (
        <HeroShowcase kind={page.kind} title={hero.title || page.title} />
      ) : null}
    </section>
  );
}

export function MarketingFooter({ brandName, footer, supportEmail, logo }) {
  const links = footer?.links || [];
  const social = footer?.socialLinks || [];
  const columns = (footer?.columns || []).filter((column) => column.visible !== false && Array.isArray(column.links) && column.links.length);
  const year = new Date().getFullYear();
  const copyright = footer?.copyright || `© ${year} ${brandName}. All rights reserved.`;
  const showCta = Boolean(footer?.ctaLabel && footer?.ctaHref);

  return (
    <footer className={styles.footer}>
      <div className={styles.footerAccent} aria-hidden />
      {showCta ? (
        <div className={styles.footerCta}>
          <div className={styles.footerCtaCopy}>
            <strong>{footer.ctaLabel}</strong>
            {footer.ctaText ? <p>{footer.ctaText}</p> : null}
          </div>
          <Link className={styles.btnPrimary} href={footer.ctaHref}>{footer.ctaLabel}</Link>
        </div>
      ) : null}
      <div className={styles.footerTop} style={{ ['--footer-cols']: Math.max(2, columns.length + 1) }}>
        <div className={styles.footerBrand}>
          {logo?.url ? (
            <img className={styles.footerLogo} src={logo.url} alt={brandName} width={logo.width} height={logo.height} />
          ) : (
            <strong className={styles.footerBrandName}>{brandName}</strong>
          )}
          {footer?.blurb ? <p>{footer.blurb}</p> : null}
          {supportEmail ? <a className={styles.footerSupport} href={`mailto:${supportEmail}`}>{supportEmail}</a> : null}
          {social.length > 0 ? (
            <div className={styles.social}>
              {social.map((link) => (
                <a href={link.href} key={link.href} rel="noopener noreferrer" target="_blank">{link.label}</a>
              ))}
            </div>
          ) : null}
        </div>
        {columns.map((column) => (
          <nav className={styles.footerCol} key={column.id || column.title} aria-label={column.title}>
            <strong>{column.title}</strong>
            {column.links.map((link) => (
              link.href.startsWith('http')
                ? <a href={link.href} key={link.href + link.label} rel="noopener noreferrer" target="_blank">{link.label}</a>
                : <Link href={link.href} key={link.href + link.label}>{link.label}</Link>
            ))}
          </nav>
        ))}
      </div>
      <div className={styles.footerBottom}>
        <small>{copyright}</small>
        <div className={styles.footerLegal}>
          {links.map((link) => <Link href={link.href} key={link.href + link.label}>{link.label}</Link>)}
          <Link href="/login">Sign in</Link>
        </div>
      </div>
    </footer>
  );
}
