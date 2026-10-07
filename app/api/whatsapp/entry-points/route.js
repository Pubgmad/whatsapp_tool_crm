import {getEntryPoints,updateEntryPoints} from '@/lib/whatsapp-entry-points';
import { withWorkspaceFeature } from '@/lib/feature-controls';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=withWorkspaceFeature('entry_points',getEntryPoints);
export const POST=withWorkspaceFeature('entry_points',updateEntryPoints);
