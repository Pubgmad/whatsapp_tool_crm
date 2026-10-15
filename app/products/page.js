import Link from 'next/link';
import MarketingChrome from '../../components/marketing-chrome';
import { MarketingFooter, MarketingProductShowcase } from '../../components/marketing-blocks';
import { loadMarketingContext } from '../../lib/marketing-page';
import styles from '../marketing.module.css';

export const dynamic = 'force-dynamic';

export default async function ProductsDiscoveryPage() {
  const ctx = await loadMarketingContext();
  const { platform, site, assets, style } = ctx;
  const products = site.document.products || [];

  return (
    <div style={style}>
      <MarketingChrome
        brandName={platform.brand_name}
        logo={assets.logo}
        navigation={site.document.navigation}
        signInLabel={platform.public_signin_label || 'Sign in'}
        signupLabel={platform.public_signup_label || 'Create workspace'}
      >
        <section className={`${styles.hero} ${styles.heroSolo}`}>
          <div>
            <p className={styles.eyebrow}>Products</p>
            <h1>WhatsApp suites built for revenue and support teams</h1>
            <p className={styles.heroLead}>
              Explore CRM, broadcasting, automation, and growth products — each backed by publishable feature pages you control from Super Admin.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.btnPrimary} href="/signup">{platform.public_signup_label || 'Create workspace'}</Link>
              <Link className={styles.btnSecondary} href="/features" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.35)', background: 'rgba(255,255,255,.08)' }}>
                Feature library
              </Link>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.padNormal} ${styles.productShowcaseSection}`}>
          <div className={styles.inner}>
            <div className={styles.sectionHead}>
              <p className={styles.eyebrow}>Catalog</p>
              <h2>Choose your starting point</h2>
              <p className={styles.sectionLead}>Every card links to a primary feature page or product URL configured in the CMS.</p>
            </div>
            <MarketingProductShowcase products={products} />
            <p className={styles.sectionCta}>
              <Link className={styles.btnText} href="/features">Browse individual features</Link>
            </p>
          </div>
        </section>

        <MarketingFooter brandName={platform.brand_name} footer={site.document.footer} supportEmail={platform.support_email} />
      </MarketingChrome>
    </div>
  );
}
