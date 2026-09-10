import { getWhatsAppOperations, updateWhatsAppOperations } from "@/lib/whatsapp-operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) { return getWhatsAppOperations(request); }
export async function POST(request) { return updateWhatsAppOperations(request); }
