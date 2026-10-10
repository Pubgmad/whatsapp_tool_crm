import { loadMarketingContext, MarketingPageView, resolvePage } from '../lib/marketing-page';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const ctx = await loadMarketingContext();
  const page = resolvePage(ctx.site.document, { kind: 'home' }) || ctx.site.document.pages?.[0];
  return <MarketingPageView {...ctx} page={page} showPricing />;
}
