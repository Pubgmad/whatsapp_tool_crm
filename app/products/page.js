import Link from 'next/link';
import MarketingChrome from '../../components/marketing-chrome';
import { MarketingFooter, MarketingProductShowcase } from '../../components/marketing-blocks';
import { loadMarketingContext } from '../../lib/marketing-page';
import styles from '../marketing.module.css';

export const dynamic = 'force-dynamic';

export default async function ProductsDiscoveryPage() {
  const ctx = await loadMarketingContext();
  const { platform, site, assets, style, authenticated } = ctx;
  const products = site.document.products || [];

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
        <section className={`${styles.hero} ${styles.heroSolo}`}>
          <div>
            <p className={styles.eyebrow}>Products</p>
            <h1>WhatsApp suites built for revenue and support teams</h1>
            <p className={styles.heroLead}>
              Explore CRM, broadcasting, automation, and growth products — each backed by publishable feature pages you control from Super Admin.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.btnPrimary} href="#catalog">Explore catalog</Link>
              <Link className={styles.btnSecondary} href="/features" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.35)', background: 'rgba(255,255,255,.08)' }}>
                Browse features
              </Link>
            </div>
          </div>
        </section>

        <section id="catalog" className={`${styles.section} ${styles.padNormal} ${styles.productShowcaseSection}`}>
          <div className={styles.inner}>
            <div className={styles.sectionHead}>
              <p className={styles.eyebrow}>Catalog</p>
              <h2>Choose your starting point</h2>
              <p className={styles.sectionLead}>Every card opens a public product or feature page — no sign-in required to explore.</p>
            </div>
            <MarketingProductShowcase products={products} />
            <p className={styles.sectionCta}>
              <Link className={styles.btnText} href="/features">Browse individual features</Link>
            </p>
          </div>
        </section>

        <MarketingFooter brandName={platform.brand_name} footer={site.document.footer} supportEmail={platform.support_email} logo={assets.logo} />
      </MarketingChrome>
    </div>
  );
}
