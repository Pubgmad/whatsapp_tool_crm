import { getAudienceSegments, saveAudienceSegment } from "@/lib/segments";

export const runtime = "nodejs";

export async function GET(request) { return getAudienceSegments(request); }
export async function POST(request) { return saveAudienceSegment(request); }