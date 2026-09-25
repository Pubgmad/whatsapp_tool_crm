import { AppError, enterSystemContext, query } from "@/lib/db";
import { decryptSecret } from "@/lib/meta";
import { decryptFlowRequest, encryptFlowResponse, verifyFlowSignature } from "@/lib/whatsapp-flow-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const rawBody = await request.text();
  if (rawBody.length > 350000) return new Response(null, { status: 413 });
  if (!verifyFlowSignature(rawBody, request.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET)) {
    return new Response(null, { status: 432 });
  }
  try {
    const { flowId } = await params;
    enterSystemContext();
    const result = await query(
      `SELECT f.endpoint_responses, f.endpoint_uri, p.flow_private_key_encrypted
       FROM whatsapp_native_flows f
       JOIN whatsapp_phone_numbers p ON p.id=f.endpoint_phone_id AND p.business_id=f.business_id
       JOIN whatsapp_accounts a ON a.id=f.whatsapp_account_id AND a.id=p.whatsapp_account_id AND a.business_id=f.business_id
       WHERE f.id=$1`,
      [flowId]
    );
    const flow = result.rows[0];
    if (!flow?.flow_private_key_encrypted || new URL(flow.endpoint_uri).pathname !== new URL(request.url).pathname) {
      return new Response(null, { status: 404 });
    }
    const { request: payload, aesKey, iv } = decryptFlowRequest(JSON.parse(rawBody), decryptSecret(flow.flow_private_key_encrypted));
    let response;
    if (payload.action === "ping") {
      response = { data: { status: "active" } };
    } else {
      const key = payload.action === "INIT" ? "INIT" : `${payload.action}:${payload.screen || ""}`;
      response = flow.endpoint_responses?.[key];
      if (!response) {
        return new Response(encryptFlowResponse({ error_msg: "This Flow step is not configured." }, aesKey, iv), { status: 427, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
      }
    }
    return new Response(encryptFlowResponse(response, aesKey, iv), { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AppError) return new Response(null, { status: error.status });
    return new Response(null, { status: 400 });
  }
}
