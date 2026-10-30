import { listEcommercePlaybooks, manageEcommercePlaybook } from '@/lib/ecommerce-playbooks.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return listEcommercePlaybooks(request);
}

export async function POST(request) {
  return manageEcommercePlaybook(request);
}
