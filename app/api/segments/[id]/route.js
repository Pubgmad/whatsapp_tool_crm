import { deleteAudienceSegment, saveAudienceSegment } from "@/lib/segments";
import { withWorkspaceFeature } from '@/lib/feature-controls';

export const runtime = "nodejs";

export async function PUT(request, context) {
  const params = await context.params;
  return withWorkspaceFeature('segments', (req) => saveAudienceSegment(req, { params }))(request);
}
export async function DELETE(request, context) {
  const params = await context.params;
  return withWorkspaceFeature('segments', (req) => deleteAudienceSegment(req, { params }))(request);
}
