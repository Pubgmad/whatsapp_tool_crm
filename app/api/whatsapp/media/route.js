import { deleteWhatsAppMedia, uploadWhatsAppMedia } from "@/lib/whatsapp-operations";
import { withWorkspaceFeature } from "@/lib/feature-controls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  return withWorkspaceFeature("templates", uploadWhatsAppMedia)(request);
}
export async function DELETE(request) {
  return withWorkspaceFeature("templates", deleteWhatsAppMedia)(request);
}
