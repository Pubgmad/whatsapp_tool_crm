import { manageWebviews } from '@/lib/whatsapp-webviews';
import { withWorkspaceFeature } from '@/lib/feature-controls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withWorkspaceFeature('webviews', manageWebviews);
export const POST = withWorkspaceFeature('webviews', manageWebviews);
