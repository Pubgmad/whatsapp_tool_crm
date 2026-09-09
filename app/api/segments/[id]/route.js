import { deleteAudienceSegment, saveAudienceSegment } from "@/lib/segments";

export const runtime = "nodejs";

export async function PUT(request, context) { return saveAudienceSegment(request, { params: await context.params }); }
export async function DELETE(request, context) { return deleteAudienceSegment(request, { params: await context.params }); }