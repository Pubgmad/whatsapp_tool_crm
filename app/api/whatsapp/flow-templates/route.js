import {flowTemplates} from '@/lib/flow-templates';
import { withWorkspaceFeature } from '@/lib/feature-controls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = withWorkspaceFeature('whatsapp_flows', flowTemplates);
export const POST = withWorkspaceFeature('whatsapp_flows', flowTemplates);
