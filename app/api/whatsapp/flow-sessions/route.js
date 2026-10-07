import {flowSessions} from '../../../../lib/whatsapp-experiences.js';
import { withWorkspaceFeature } from '@/lib/feature-controls';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=withWorkspaceFeature('whatsapp_flows',flowSessions);
export const POST=withWorkspaceFeature('whatsapp_flows',flowSessions);
