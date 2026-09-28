import { getCommerce, updateCommerceOrder } from '@/lib/whatsapp-commerce';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = getCommerce;
export const POST = updateCommerceOrder;
