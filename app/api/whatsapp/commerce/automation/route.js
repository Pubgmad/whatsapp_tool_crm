import {commerceAutomationSettings} from '@/lib/commerce-automation';
import {withWorkspaceFeature} from '@/lib/feature-controls';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=withWorkspaceFeature('commerce',commerceAutomationSettings);
export const POST=withWorkspaceFeature('commerce',commerceAutomationSettings);
