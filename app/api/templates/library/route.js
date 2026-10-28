import { listTemplateLibrary, useTemplateLibraryItem } from '@/lib/template-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return listTemplateLibrary(request);
}

export async function POST(request) {
  return useTemplateLibraryItem(request);
}
