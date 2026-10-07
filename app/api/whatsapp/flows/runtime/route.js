import { runtimeSettingsApi } from '@/lib/flow-runtime-api';
import { withWorkspaceFeature } from '@/lib/feature-controls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = withWorkspaceFeature('whatsapp_flows', runtimeSettingsApi);
export const POST = withWorkspaceFeature('whatsapp_flows', runtimeSettingsApi);
