import { createTemplate } from "@/lib/actions";
export const dynamic = "force-dynamic";
export async function POST(request) { return createTemplate(request); }
