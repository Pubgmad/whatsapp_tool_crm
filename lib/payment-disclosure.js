export const PAYMENT_PATHS = Object.freeze({
  native_whatsapp: {
    id: 'native_whatsapp',
    label: 'WhatsApp native payment',
    description: 'Customer pays inside WhatsApp when your WABA and region support Meta payments.'
  },
  razorpay_hosted: {
    id: 'razorpay_hosted',
    label: 'Razorpay hosted checkout',
    description: 'Customer opens a secure Razorpay page; this is not the same as in-chat native payment.'
  },
  shopify_checkout: {
    id: 'shopify_checkout',
    label: 'Shopify checkout',
    description: 'Order is fulfilled in Shopify; payment status comes from verified Shopify webhooks.'
  }
});

export function paymentPathForOrder(order) {
  if (order?.shopify_order_id) return PAYMENT_PATHS.shopify_checkout;
  if (order?.payment_provider === 'razorpay' || order?.razorpay_payment_id) return PAYMENT_PATHS.razorpay_hosted;
  return PAYMENT_PATHS.native_whatsapp;
}
