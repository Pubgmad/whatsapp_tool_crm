import { getConversions, updateConversions } from '@/lib/whatsapp-conversions';
import { withWorkspaceFeature } from '@/lib/feature-controls';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = withWorkspaceFeature('conversions', getConversions);
export const POST = withWorkspaceFeature('conversions', updateConversions);
