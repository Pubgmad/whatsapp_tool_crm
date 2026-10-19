import { loadMarketingContext, MarketingPageView, resolvePage } from '../../lib/marketing-page';
import styles from '../marketing.module.css';
import MarketingChrome from '../../components/marketing-chrome';
import { MarketingFooter, MarketingHero } from '../../components/marketing-blocks';
import PricingPlans from '../../components/pricing-plans';
import { withAuthReturn } from '../../lib/auth-return';
import { PRICING_ARCHITECTURE } from '../../lib/pricing-architecture';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Pricing',
  description: 'MathStrat platform plans are separate from WhatsApp messaging charges. Plans are Super Admin configurable.'
};

export default async function PricingPage() {
  const ctx = await loadMarketingContext();
  const cmsPage = resolvePage(ctx.site.document, { kind: 'pricing' }) || resolvePage(ctx.site.document, { slug: 'pricing' });
  if (cmsPage) {
    return <MarketingPageView {...ctx} page={cmsPage} showPricing />;
  }

  const { platform, site, assets, plans, style, authenticated } = ctx;
  const ctaHref = authenticated ? '/app/settings/whatsapp' : withAuthReturn('/signup', '/app/settings/whatsapp');
  const ctaLabel = authenticated ? 'Open workspace' : (platform.public_signup_label || 'Get started');
  const page = {
    kind: 'pricing',
    title: 'Pricing',
    eyebrow: 'Pricing',
    summary: 'Platform subscription is separate from WhatsApp messaging charges.',
    hero: {
      enabled: true,
      title: platform.public_pricing_heading || 'Plans for WhatsApp CRM teams',
      subtitle: 'Choose a MathStrat platform plan managed by Super Admin. WhatsApp conversation charges from Meta are billed separately and can vary by country and message category.',
      ctaLabel,
      ctaHref,
      image: 'none',
      imageUrl: ''
    },
    sections: []
  };

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
        <MarketingHero page={page} assets={assets} />
        <section className={styles.pricing} id="pricing">
          <div className={styles.inner}>
            <div className={styles.sectionHead}>
              <p className={styles.eyebrow}>Platform subscription</p>
              <h2>MathStrat plans</h2>
              <p className={styles.sectionLead}>
                Prices below come from Super Admin–managed subscription plans ({PRICING_ARCHITECTURE.status}).
                They do not include Meta WhatsApp messaging fees, taxes, or optional add-ons unless listed on the plan.
              </p>
            </div>
            <PricingPlans plans={plans} ctaHref={ctaHref} ctaLabel={ctaLabel} />

            <div className={styles.sectionHead} style={{ marginTop: '3rem' }}>
              <p className={styles.eyebrow}>How charges separate</p>
              <h2>Not one misleading sticker price</h2>
              <p className={styles.sectionLead}>
                {PRICING_ARCHITECTURE.competitorNote}
              </p>
            </div>
            <div className={styles.gridCards}>
              {PRICING_ARCHITECTURE.chargeLayers.map((layer) => (
                <article className={styles.card} key={layer.id}>
                  <h3>{layer.title}</h3>
                  <p>{layer.description}</p>
                </article>
              ))}
            </div>

            <div className={styles.sectionHead} style={{ marginTop: '3rem' }}>
              <p className={styles.eyebrow}>FAQ</p>
              <h2>Pricing questions</h2>
            </div>
            <div className={styles.faqList}>
              {PRICING_ARCHITECTURE.faq.map((item) => (
                <details className={styles.faqItem} key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
        <MarketingFooter brandName={platform.brand_name} footer={site.document.footer} supportEmail={platform.support_email} logo={assets.logo} />
      </MarketingChrome>
    </div>
  );
}
