import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import MarketingChrome from '../components/marketing-chrome';
import { MarketingFooter, MarketingHero, MarketingSection } from '../components/marketing-blocks';
import { authenticateSessionToken, SESSION_COOKIE_NAME } from './auth';
import { isSessionFailure } from './auth-navigation';
import { query } from './db';
import { findPublishedPage, publicPathForPage } from './cms-document';
import { getPublicPlatformConfig } from './platform';
import { brandAssets, getPublishedSite } from './public-site';
import styles from '../app/marketing.module.css';

export async function loadMarketingContext() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  let authenticated = false;
  try {
    await authenticateSessionToken(token);
    authenticated = true;
  } catch (error) {
    if (!isSessionFailure(error)) throw error;
  }
  if (authenticated) redirect('/app/dashboard');

  const [platform, site, assets, plans] = await Promise.all([
    getPublicPlatformConfig(),
    getPublishedSite(),
    brandAssets(),
    query('SELECT id,name,description,currency,monthly_price_cents,yearly_price_cents,features FROM subscription_plans WHERE is_active AND visible ORDER BY display_order,name LIMIT 12').then((result) => result.rows)
  ]);

  const theme = site.document.theme || {};
  const style = {
    ['--mk-primary']: theme.primary || '#0f766e',
    ['--mk-accent']: theme.accent || '#ea580c',
    ['--mk-surface']: theme.surface || '#f6f8f7',
    ['--mk-ink']: theme.ink || '#142429'
  };

  return { platform, site, assets, plans, style };
}

export function MarketingPageView({ platform, site, assets, plans = [], page, style, showPricing = false }) {
  if (!page) return null;
  return (
    <div style={style}>
      <MarketingChrome
        brandName={platform.brand_name}
        logo={assets.logo}
        navigation={site.document.navigation}
        signInLabel={platform.public_signin_label || 'Sign in'}
        signupLabel={platform.public_signup_label || 'Create workspace'}
      >
        <MarketingHero page={page} assets={assets} signupLabel={platform.public_signup_label} />
        {(page.sections || []).map((section) => <MarketingSection section={section} assets={assets} key={section.id} />)}
        {showPricing && plans.length > 0 && (
          <section className={styles.pricing} id="pricing">
            <div className={styles.inner}>
              <div className={styles.sectionHead}>
                <p className={styles.eyebrow}>Pricing</p>
                <h2>{platform.public_pricing_heading || 'Plans'}</h2>
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
                    {Array.isArray(plan.features) && plan.features.length > 0 && (
                      <ul>{plan.features.map((feature, index) => <li key={index}>{feature}</li>)}</ul>
                    )}
                    <a className={styles.btnPrimary} href="/signup">{platform.public_signup_label}</a>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}
        <MarketingFooter brandName={platform.brand_name} footer={site.document.footer} supportEmail={platform.support_email} />
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
    return findPublishedPage(document, (page) => page.slug === slug || publicPathForPage(page) === `/${slug}` || (page.kind === 'feature' && page.slug === slug));
  }
  return null;
}
