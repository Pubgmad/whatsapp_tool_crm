import { listBillingInvoices } from '@/lib/billing';
export const runtime = 'nodejs';
export async function GET(request) {
  return listBillingInvoices(request);
}
