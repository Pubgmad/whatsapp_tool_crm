import { crmFieldMapRequest } from '@/lib/crm-field-map-api.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return crmFieldMapRequest(request);
}

export async function PUT(request) {
  return crmFieldMapRequest(request);
}
