import { superAdminConcierge } from '@/lib/assisted-onboarding.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return superAdminConcierge(request);
}

export async function POST(request) {
  return superAdminConcierge(request);
}
