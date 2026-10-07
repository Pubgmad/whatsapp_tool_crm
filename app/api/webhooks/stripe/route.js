export const runtime = 'nodejs';

export async function POST() {
  return Response.json(
    {
      error: 'Stripe billing was removed from this platform. Configure Razorpay webhooks at /api/webhooks/razorpay.',
      code: 'BILLING_PROVIDER_DEPRECATED'
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}
