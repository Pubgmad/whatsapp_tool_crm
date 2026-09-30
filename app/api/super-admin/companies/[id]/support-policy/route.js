import {supportPolicyRequest} from '@/lib/support-policy';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request,context){return supportPolicyRequest(request,context,true);}
export function POST(request,context){return supportPolicyRequest(request,context,true);}
