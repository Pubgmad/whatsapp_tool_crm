import {listPublicContacts,upsertPublicContact} from '@/lib/public-workspace-api';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const PUT=upsertPublicContact;
export const POST=upsertPublicContact;
export const GET=listPublicContacts;
