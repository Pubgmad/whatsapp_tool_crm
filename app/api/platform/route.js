import { errorJson, json } from "../../../lib/db";
import { getPublicPlatformConfig } from "../../../lib/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json({ platform: await getPublicPlatformConfig() });
  } catch (error) {
    return errorJson(error);
  }
}
