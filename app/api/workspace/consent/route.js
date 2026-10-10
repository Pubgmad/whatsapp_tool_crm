import { consentManagementRequest } from '../../../../lib/consent-management.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return consentManagementRequest(request);
}

export async function POST(request) {
  return consentManagementRequest(request);
}

export async function PUT(request) {
  return consentManagementRequest(request);
}

export async function PATCH(request) {
  return consentManagementRequest(request);
}
