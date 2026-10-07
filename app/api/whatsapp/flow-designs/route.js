import {flowDesignLibrary} from '@/lib/flow-design-library';
import { withWorkspaceFeature } from '@/lib/feature-controls';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=withWorkspaceFeature('whatsapp_flows',flowDesignLibrary);
export const POST=withWorkspaceFeature('whatsapp_flows',flowDesignLibrary);
