import { notFound } from 'next/navigation';
import { buildProductMarketingPage, findProductBySlug } from '../../../lib/cms-document';
import { loadMarketingContext, MarketingPageView, resolvePage } from '../../../lib/marketing-page';

export const dynamic = 'force-dynamic';

export default async function ProductSlugPage({ params }) {
  const { slug } = await params;
  if (!slug) notFound();

  const ctx = await loadMarketingContext();
  const { document } = ctx.site;

  const cmsPage = resolvePage(document, { kind: 'product', slug }) || resolvePage(document, { slug });

  if (cmsPage && (cmsPage.kind === 'product' || cmsPage.kind === 'feature')) {
    return <MarketingPageView {...ctx} page={cmsPage} />;
  }

  const product = findProductBySlug(document, slug);
  if (product) {
    return <MarketingPageView {...ctx} page={buildProductMarketingPage(product)} />;
  }

  notFound();
}
