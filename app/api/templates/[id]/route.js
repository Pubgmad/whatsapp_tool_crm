import { patchTemplate } from "@/lib/actions";
export const dynamic = "force-dynamic";
export async function PATCH(request, context) { return patchTemplate(request, { params: await context.params }); }
