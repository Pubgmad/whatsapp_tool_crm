import { notFound } from 'next/navigation';
import { loadMarketingContext, MarketingPageView, resolvePage } from '../../../lib/marketing-page';

export const dynamic = 'force-dynamic';

export default async function SolutionDetailPage({ params }) {
  const { slug } = await params;
  const ctx = await loadMarketingContext();
  const page = resolvePage(ctx.site.document, { kind: 'solution', slug }) || resolvePage(ctx.site.document, { slug });
  if (!page || page.kind !== 'solution') notFound();
  return <MarketingPageView {...ctx} page={page} />;
}
