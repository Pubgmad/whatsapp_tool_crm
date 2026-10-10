import { submitWebviewForm } from '../../../../../../lib/webview-form-submissions.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request, context) {
  return submitWebviewForm(request, context);
}
