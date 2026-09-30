import {visitTrackedLink} from '@/lib/click-tracking';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request,context){return visitTrackedLink(request,context);}
export function POST(request,context){return visitTrackedLink(request,context);}
