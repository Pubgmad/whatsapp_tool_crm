import { listBillingPlans } from '@/lib/billing';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request) { return listBillingPlans(request); }
