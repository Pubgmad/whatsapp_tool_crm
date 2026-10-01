import {providerConnectorSettings} from '@/lib/provider-connectors';
import {withWorkspaceFeature} from '@/lib/feature-controls';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=withWorkspaceFeature('connectors',providerConnectorSettings);
export const POST=withWorkspaceFeature('connectors',providerConnectorSettings);
