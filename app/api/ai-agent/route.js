import { supportAgentSettings } from '@/lib/ai-support';
import { withWorkspaceFeature } from '@/lib/feature-controls';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = withWorkspaceFeature('ai_agent', supportAgentSettings);
export const POST = withWorkspaceFeature('ai_agent', supportAgentSettings);
