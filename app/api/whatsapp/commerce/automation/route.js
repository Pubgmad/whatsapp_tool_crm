import {commerceAutomationSettings} from '@/lib/commerce-automation';
import {withWorkspaceFeature} from '@/lib/feature-controls';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// Worker requires both commerce and automation — mirror that at the API boundary.
export const GET=withWorkspaceFeature('commerce',withWorkspaceFeature('automation',commerceAutomationSettings));
export const POST=withWorkspaceFeature('commerce',withWorkspaceFeature('automation',commerceAutomationSettings));
