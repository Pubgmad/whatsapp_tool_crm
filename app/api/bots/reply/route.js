import { listReplyBots, manageReplyBot } from '@/lib/reply-bots.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return listReplyBots(request);
}

export async function POST(request) {
  return manageReplyBot(request);
}
