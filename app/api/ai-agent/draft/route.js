import { draftSupportReply } from '@/lib/ai-support';
import { withWorkspaceFeature } from '@/lib/feature-controls';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = withWorkspaceFeature('ai_agent', draftSupportReply);
