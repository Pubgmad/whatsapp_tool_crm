import { listWhatsAppGroups, mutateWhatsAppGroups } from '@/lib/whatsapp-groups.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = listWhatsAppGroups;
export const POST = mutateWhatsAppGroups;
