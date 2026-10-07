import { manageWidgets } from '@/lib/whatsapp-widget';
import { withWorkspaceFeature } from '@/lib/feature-controls';

export const runtime='nodejs';
export const GET=withWorkspaceFeature('entry_points',manageWidgets);
export const POST=withWorkspaceFeature('entry_points',manageWidgets);
