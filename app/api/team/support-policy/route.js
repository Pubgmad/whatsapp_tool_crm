import {supportPolicyRequest} from '@/lib/support-policy';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request){return supportPolicyRequest(request);}
export function POST(request){return supportPolicyRequest(request);}
