import { createBillingPortal } from '@/lib/billing';
export const runtime = 'nodejs';
export async function POST(request) { return createBillingPortal(request); }
