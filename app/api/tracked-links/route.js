import {trackedLinksRequest} from '@/lib/click-tracking';
import { withWorkspaceFeature } from '@/lib/feature-controls';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request){return withWorkspaceFeature('segments',trackedLinksRequest)(request);}
export function POST(request){return withWorkspaceFeature('segments',trackedLinksRequest)(request);}
