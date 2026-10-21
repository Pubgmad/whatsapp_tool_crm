import { cookies } from 'next/headers';
import MarketingChrome from '../components/marketing-chrome';
import { MarketingFooter, MarketingHero, MarketingSection } from '../components/marketing-blocks';
import { authenticateSessionToken, SESSION_COOKIE_NAME } from './auth';
import { isSessionFailure } from './auth-navigation';
import {
  isGenericSignupHref,
  resolveLaunchCta,
  withAuthReturn,
  workspacePathForMarketingPage,
  workspacePathForPublicHref
} from './auth-return';
import { query } from './db';
import { findPublishedPage, publicPathForPage } from './cms-document';
import { getPublicPlatformConfig } from './platform';
import { brandAssets, getPublishedSite } from './public-site';
import { planMarketingFeatures } from './plan-features.js';
import styles from '../app/marketing.module.css';

/** CTAs that must not replace a feature launch (catalog / browse destinations). */
function isCatalogOrAuthHref(href) {
  const value = String(href || '').trim().toLowerCase();
  if (!value) return true;
  if (isGenericSignupHref(value)) return true;
  if (value === '/features' || value.startsWith('/features?')) return true;
  if (value === '/products' || value.startsWith('/products?')) return true;
  if (value === '/' || value === '/pricing') return true;
  return false;
}

function applyAuthAwarePageCtas(page, authenticated) {
  if (!page) return page;
  const launch = resolveLaunchCta({ page, authenticated });
  const hasWorkspace = Boolean(workspacePathForMarketingPage(page));
  const hero = page.hero ? { ...page.hero } : null;
  // Feature/product pages always use the launch CTA as the primary hero action
  // (including product heroes that deep-link to /features/{slug} marketing pages).
  const heroHref = String(hero?.ctaHref || '');
  const heroPointsAtFeatureMarketing = heroHref === '/features' || heroHref.startsWith('/features/') || heroHref.startsWith('/features?');
  if (hero && (hasWorkspace || isCatalogOrAuthHref(hero.ctaHref) || heroPointsAtFeatureMarketing)) {
    hero.ctaHref = launch.href;
    if (hasWorkspace || !String(hero.ctaLabel || '').trim() || /create workspace|get started|sign up|sign in|see all features|browse|explore/i.test(hero.ctaLabel || '')) {
      hero.ctaLabel = launch.label;
    }
  }
  const rewriteWorkspaceHref = (href, label = '') => {
    const workspace = workspacePathForPublicHref(href);
    if (!workspace) return null;
    const openIntent = /^(open|use|start|launch|try)\b/i.test(String(label || '').trim());
    // Always send authenticated users to the dedicated workspace for feature deep-links.
    // Guests keep the public feature URL unless the CTA is an explicit open/use action.
    if (authenticated) return workspace;
    if (openIntent) return withAuthReturn('/login', workspace);
    return null;
  };

  const sections = Array.isArray(page.sections)
    ? page.sections.map((section) => {
      const next = { ...section };
      if (hasWorkspace && isCatalogOrAuthHref(next.ctaHref)) {
        next.ctaHref = launch.href;
        next.ctaLabel = next.ctaLabel && !/see all features|browse features|browse products/i.test(next.ctaLabel)
          ? next.ctaLabel
          : launch.label;
      } else if (next.ctaHref && isGenericSignupHref(next.ctaHref)) {
        next.ctaHref = launch.href;
        if (!next.ctaLabel) next.ctaLabel = launch.label;
      } else {
        const rewritten = rewriteWorkspaceHref(next.ctaHref, next.ctaLabel);
        if (rewritten) next.ctaHref = rewritten;
      }
      if (Array.isArray(next.blocks)) {
        next.blocks = next.blocks.map((block) => {
          if (!block?.href) return block;
          const blockRewrite = rewriteWorkspaceHref(block.href, block.title || block.label || '');
          if (blockRewrite) return { ...block, href: blockRewrite };
          // Keep remaining cross-links to other public feature pages for discovery.
          if (String(block.href).startsWith('/features/')) return block;
          if (!isCatalogOrAuthHref(block.href) && !isGenericSignupHref(block.href)) return block;
          return { ...block, href: launch.href };
        });
      }
      return next;
    })
    : page.sections;
  return { ...page, hero, sections };
}

function treatAsGuest(error) {
  return isSessionFailure(error) || error?.code === 'EMAIL_NOT_VERIFIED' || error?.code === 'ACCOUNT_SUSPENDED';
}

export async function loadMarketingContext() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  let authenticated = false;
  try {
    if (token) {
      await authenticateSessionToken(token);
      authenticated = true;
    }
  } catch (error) {
    if (!treatAsGuest(error)) throw error;
    authenticated = false;
  }

  const [platform, site, assets, plans] = await Promise.all([
    getPublicPlatformConfig(),
    getPublishedSite(),
    brandAssets(),
    query('SELECT id,code,name,description,currency,monthly_price_cents,yearly_price_cents,features FROM subscription_plans WHERE is_active AND visible ORDER BY display_order,name LIMIT 12').then((result) => result.rows)
  ]);

  const theme = site.document.theme || {};
  const style = {
    ['--mk-primary']: theme.primary || '#0f766e',
    ['--mk-accent']: theme.accent || '#ea580c',
    ['--mk-surface']: theme.surface || '#f6f8f7',
    ['--mk-ink']: theme.ink || '#142429'
  };

  return { platform, site, assets, plans, style, authenticated };
}

export function MarketingPageView({ platform, site, assets, plans = [], page, style, showPricing = false, authenticated = false }) {
  if (!page) return null;
  const viewPage = applyAuthAwarePageCtas(page, authenticated);
  const pricingHref = authenticated
    ? '/app/settings/whatsapp'
    : withAuthReturn('/signup', '/app/settings/whatsapp');
  const pricingLabel = authenticated ? 'Connect WhatsApp' : (platform.public_signup_label || 'Get started');
  return (
    <div style={style}>
      <MarketingChrome
        brandName={platform.brand_name}
        logo={assets.logo}
        navigation={site.document.navigation}
        signInLabel={platform.public_signin_label || 'Sign in'}
        signupLabel={platform.public_signup_label || 'Get started'}
        authenticated={authenticated}
      >
        <MarketingHero page={viewPage} assets={assets} signupLabel={platform.public_signup_label} authenticated={authenticated} />
        {(viewPage.sections || []).map((section) => (
          <MarketingSection section={section} assets={assets} products={site.document.products || []} key={section.id} />
        ))}
        {showPricing && plans.length > 0 && (
          <section className={styles.pricing} id="pricing">
            <div className={styles.inner}>
              <div className={styles.sectionHead}>
                <p className={styles.eyebrow}>Pricing</p>
                <h2>{platform.public_pricing_heading || 'Plans'}</h2>
                <p className={styles.sectionLead}>
                  Platform subscription prices are managed in Super Admin. WhatsApp messaging charges from Meta are separate and vary by destination and category.
                </p>
              </div>
              <div className={styles.planGrid}>
                {plans.map((plan) => (
                  <article className={styles.plan} key={plan.id}>
                    <h3>{plan.name}</h3>
                    {plan.description ? <p>{plan.description}</p> : null}
                    <strong>
                      {new Intl.NumberFormat(undefined, { style: 'currency', currency: plan.currency }).format(plan.monthly_price_cents / 100)}
                      <small> / month</small>
                    </strong>
                    {planMarketingFeatures(plan.features).length > 0 && (
                      <ul>{planMarketingFeatures(plan.features).map((feature, index) => <li key={index}>{feature}</li>)}</ul>
                    )}
                    <a className={styles.btnPrimary} href={pricingHref}>{pricingLabel}</a>
                  </article>
                ))}
              </div>
              <p className={styles.sectionLead} style={{ marginTop: '1.5rem' }}>
                <a href="/pricing">Full pricing details</a> — including how platform fees relate to WhatsApp conversation charges.
              </p>
            </div>
          </section>
        )}
        <MarketingFooter brandName={platform.brand_name} footer={site.document.footer} supportEmail={platform.support_email} logo={assets.logo} />
      </MarketingChrome>
    </div>
  );
}

export function resolvePage(document, { kind, slug } = {}) {
  if (kind) {
    const byKind = findPublishedPage(document, (page) => page.kind === kind && (slug == null || page.slug === slug));
    if (byKind) return byKind;
  }
  if (slug != null) {
    return findPublishedPage(document, (page) => page.slug === slug || publicPathForPage(page) === `/${slug}` || (page.kind === 'feature' && page.slug === slug) || (page.kind === 'solution' && page.slug === slug) || (page.kind === 'resource' && page.slug === slug));
  }
  return null;
}
