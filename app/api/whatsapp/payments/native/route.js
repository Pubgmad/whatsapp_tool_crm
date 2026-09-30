import {getNativePayments,updateNativePayments} from '@/lib/whatsapp-native-payments';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=getNativePayments;
export const POST=updateNativePayments;
