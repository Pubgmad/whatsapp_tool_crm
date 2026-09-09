import { exportContacts } from "@/lib/actions";

export const runtime = "nodejs";

export async function GET(request) {
  return exportContacts(request);
}