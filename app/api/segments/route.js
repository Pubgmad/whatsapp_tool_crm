import { getAudienceSegments, saveAudienceSegment } from "@/lib/segments";
import { withWorkspaceFeature } from '@/lib/feature-controls';

export const runtime = "nodejs";

export async function GET(request) { return withWorkspaceFeature('segments', getAudienceSegments)(request); }
export async function POST(request) { return withWorkspaceFeature('segments', saveAudienceSegment)(request); }
