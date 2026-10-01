import {getNativePayments,updateNativePayments} from '@/lib/whatsapp-native-payments';
import {withWorkspaceFeature} from '@/lib/feature-controls';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=withWorkspaceFeature('commerce',getNativePayments);
export const POST=withWorkspaceFeature('commerce',updateNativePayments);
