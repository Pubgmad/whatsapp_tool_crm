import { notFound } from 'next/navigation';
import { loadMarketingContext, MarketingPageView, resolvePage } from '../../lib/marketing-page';

export const dynamic = 'force-dynamic';

const RESERVED = new Set([
  'app', 'api', 'login', 'signup', 'super-admin', 'admin', 'about', 'contact', 'features', 'terms',
  'privacy-policy', 'forgot-password', 'reset-password', 'verify-email', 'resend-verification',
  'invite', 'data-deletion', 'opengraph-image', 'favicon.ico', 'w', 'r'
]);

export default async function CmsSlugPage({ params }) {
  const { slug } = await params;
  if (!slug || RESERVED.has(slug)) notFound();
  const ctx = await loadMarketingContext();
  const page = resolvePage(ctx.site.document, { slug });
  if (!page || page.kind === 'home' || page.kind === 'feature') notFound();
  return <MarketingPageView {...ctx} page={page} />;
}
