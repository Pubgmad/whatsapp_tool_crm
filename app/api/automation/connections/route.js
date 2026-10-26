import { outboundConnectionSettings } from '../../../../lib/automation-outbound.js';
import { withWorkspaceFeature } from '@/lib/feature-controls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withWorkspaceFeature('automation', outboundConnectionSettings);
export const POST = withWorkspaceFeature('automation', outboundConnectionSettings);
