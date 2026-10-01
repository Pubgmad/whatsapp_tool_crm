import {getWhatsAppAds,updateWhatsAppAds} from '@/lib/whatsapp-ads';
import {withWorkspaceFeature} from '@/lib/feature-controls';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=withWorkspaceFeature('ads',getWhatsAppAds);
export const POST=withWorkspaceFeature('ads',updateWhatsAppAds);
