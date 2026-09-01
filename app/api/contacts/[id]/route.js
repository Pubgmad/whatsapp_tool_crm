import { deleteContact, patchContact } from "@/lib/actions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(request, context) { return patchContact(request, { params: await context.params }); }
export async function DELETE(request, context) { return deleteContact(request, { params: await context.params }); }


