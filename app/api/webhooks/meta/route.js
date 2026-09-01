import { receiveMetaWebhook, verifyMetaWebhook } from "@/lib/actions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request) { return verifyMetaWebhook(request); }
export async function POST(request) { return receiveMetaWebhook(request); }


