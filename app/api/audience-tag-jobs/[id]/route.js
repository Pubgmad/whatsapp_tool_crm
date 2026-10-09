import { getAudienceTagJob } from '@/lib/audience-bulk-tags.js';
import { withWorkspaceFeature } from '@/lib/feature-controls.js';

export async function GET(request, context) {
  return withWorkspaceFeature('segments', req => getAudienceTagJob(req, context))(request);
}
