import { callingSettingsRequest } from '@/lib/calling-settings-api.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return callingSettingsRequest(request);
}

export async function PATCH(request) {
  return callingSettingsRequest(request);
}
