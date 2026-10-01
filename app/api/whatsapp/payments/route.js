import {getMerchantPayments,updateMerchantPayments} from '@/lib/merchant-payments';
import {withWorkspaceFeature} from '@/lib/feature-controls';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=withWorkspaceFeature('commerce',getMerchantPayments);
export const POST=withWorkspaceFeature('commerce',updateMerchantPayments);
