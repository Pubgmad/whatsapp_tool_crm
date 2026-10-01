import { supportAgentAvailability } from '@/lib/ai-support';
import { withWorkspaceFeature } from '@/lib/feature-controls';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = withWorkspaceFeature('ai_agent', supportAgentAvailability);
