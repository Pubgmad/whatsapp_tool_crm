import { getAssistedOnboarding, updateAssistedOnboarding } from '@/lib/assisted-onboarding.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return getAssistedOnboarding(request);
}

export async function POST(request) {
  return updateAssistedOnboarding(request);
}
