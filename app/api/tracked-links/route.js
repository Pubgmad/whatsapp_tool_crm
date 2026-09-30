import {trackedLinksRequest} from '@/lib/click-tracking';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request){return trackedLinksRequest(request);}
export function POST(request){return trackedLinksRequest(request);}
