import {getCalling,updateCalling} from '@/lib/whatsapp-calling';
import {withWorkspaceFeature} from '@/lib/feature-controls';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=withWorkspaceFeature('calling',getCalling);
export const POST=withWorkspaceFeature('calling',updateCalling);
