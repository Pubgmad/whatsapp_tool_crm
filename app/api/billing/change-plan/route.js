import { changeSubscriptionPlan } from '@/lib/billing';

export const runtime = 'nodejs';
export async function POST(request) { return changeSubscriptionPlan(request); }
