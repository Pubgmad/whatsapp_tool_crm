import {receiveMerchantPaymentWebhook} from '@/lib/merchant-payments';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request,{params}){return receiveMerchantPaymentWebhook(request,(await params).businessId);}
