import { retryAudienceTagJob } from '@/lib/audience-bulk-tags.js';
import { withWorkspaceFeature } from '@/lib/feature-controls.js';

export async function POST(request, context) {
  return withWorkspaceFeature('segments', req => retryAudienceTagJob(req, context))(request);
}
