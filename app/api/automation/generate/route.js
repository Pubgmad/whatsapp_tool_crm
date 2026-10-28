import { generateAutomationFlow } from '@/lib/automation-flow-generator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  return generateAutomationFlow(request);
}
