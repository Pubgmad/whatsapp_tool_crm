import { notFound } from 'next/navigation';
import { loadMarketingContext, MarketingPageView, resolvePage } from '../../lib/marketing-page';

export const dynamic = 'force-dynamic';

export default async function ContactPage() {
  const ctx = await loadMarketingContext();
  const page = resolvePage(ctx.site.document, { kind: 'contact' }) || resolvePage(ctx.site.document, { slug: 'contact' });
  if (!page) notFound();
  return <MarketingPageView {...ctx} page={page} />;
}
