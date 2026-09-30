import {manageRazorpaySubscription} from '@/lib/razorpay-billing';
export const runtime='nodejs';
export async function POST(request){return manageRazorpaySubscription(request);}
