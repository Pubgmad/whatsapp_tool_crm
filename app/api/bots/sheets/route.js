import { manageSheetsBot, sheetsBotStatus, startSheetsOAuth } from '@/lib/sheets-bot.js';
import { readJsonBodyLimited } from '@/lib/security.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return sheetsBotStatus(request);
}

export async function POST(request) {
  const body = await readJsonBodyLimited(request, 65536);
  if (body?.action === 'startOAuth') {
    // Rebuild a Request-like path: startSheetsOAuth does not need the body.
    return startSheetsOAuth(request);
  }
  // manageSheetsBot expects to read JSON itself — pass a synthetic request with the already-parsed body.
  const synthetic = new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(body)
  });
  return manageSheetsBot(synthetic);
}
