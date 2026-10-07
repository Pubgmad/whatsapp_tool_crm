import { manageMetaWebhookQueue } from '@/lib/meta-webhook-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = manageMetaWebhookQueue;
export const POST = manageMetaWebhookQueue;
