import { getConversions, updateConversions } from '@/lib/whatsapp-conversions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = getConversions;
export const POST = updateConversions;
