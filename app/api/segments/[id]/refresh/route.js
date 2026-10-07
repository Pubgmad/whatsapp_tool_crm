import { refreshRetargetAudienceSegment } from '@/lib/segments.js';
import { withWorkspaceFeature } from '@/lib/feature-controls.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request, context) {
  return withWorkspaceFeature('segments', (req) => refreshRetargetAudienceSegment(req, context))(request);
}
