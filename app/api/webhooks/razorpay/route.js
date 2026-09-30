import {receiveRazorpayBillingWebhook} from '@/lib/razorpay-billing';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request){return receiveRazorpayBillingWebhook(request);}
