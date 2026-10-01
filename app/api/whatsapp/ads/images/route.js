import {uploadAdImage} from '@/lib/whatsapp-ads';
import {withWorkspaceFeature} from '@/lib/feature-controls';
export const runtime='nodejs';
export const POST=withWorkspaceFeature('ads',uploadAdImage);
