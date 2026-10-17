import { notFound } from 'next/navigation';
import { loadMarketingContext, MarketingPageView, resolvePage } from '../../../lib/marketing-page';

export const dynamic = 'force-dynamic';

export default async function ResourceDetailPage({ params }) {
  const { slug } = await params;
  const ctx = await loadMarketingContext();
  const page = resolvePage(ctx.site.document, { kind: 'resource', slug }) || resolvePage(ctx.site.document, { slug });
  if (!page || page.kind !== 'resource') notFound();
  return <MarketingPageView {...ctx} page={page} />;
}
