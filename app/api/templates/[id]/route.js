import { patchTemplate } from "@/lib/actions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(request, context) { return patchTemplate(request, { params: await context.params }); }


