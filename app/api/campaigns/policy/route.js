import {campaignPolicyEndpoint} from '@/lib/campaign-controls';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request){return campaignPolicyEndpoint(request);}
export async function PUT(request){return campaignPolicyEndpoint(request);}
