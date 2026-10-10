import { customFieldsRequest } from '../../../../lib/contact-custom-fields.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return customFieldsRequest(request);
}

export async function POST(request) {
  return customFieldsRequest(request);
}
