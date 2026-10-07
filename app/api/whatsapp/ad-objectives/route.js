import { adObjectiveCatalog } from '../../../../lib/whatsapp-ad-objectives.js';
import { requireSession } from '../../../../lib/auth.js';
import { errorJson, json } from '../../../../lib/db.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    await requireSession(request);
    return json(adObjectiveCatalog());
  } catch (error) {
    return errorJson(error);
  }
}
