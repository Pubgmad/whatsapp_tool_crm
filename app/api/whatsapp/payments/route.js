import {getMerchantPayments,updateMerchantPayments} from '@/lib/merchant-payments';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request){return getMerchantPayments(request);}
export async function POST(request){return updateMerchantPayments(request);}
