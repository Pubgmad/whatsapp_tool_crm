import { getCommerce, updateCommerceOrder } from '@/lib/whatsapp-commerce';
import { withWorkspaceFeature } from '@/lib/feature-controls';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = withWorkspaceFeature('commerce', getCommerce);
export const POST = withWorkspaceFeature('commerce', updateCommerceOrder);
