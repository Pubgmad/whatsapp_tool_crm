import { deleteWhatsAppMedia, uploadWhatsAppMedia } from "@/lib/whatsapp-operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) { return uploadWhatsAppMedia(request); }
export async function DELETE(request) { return deleteWhatsAppMedia(request); }
