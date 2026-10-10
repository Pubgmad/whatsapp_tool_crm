import { inboxStreamRequest } from '../../../../../lib/inbox-realtime.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return inboxStreamRequest(request);
}
