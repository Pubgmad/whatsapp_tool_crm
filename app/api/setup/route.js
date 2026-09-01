import { updateSetup } from "@/lib/actions";
export const dynamic = "force-dynamic";
export async function PUT(request) { return updateSetup(request); }
