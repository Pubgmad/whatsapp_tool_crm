/**
 * One-click commerce automation presets (Shopify / WhatsApp order journeys).
 * Rules still require an owner-selected manual utility workflow at apply time.
 */
export const COMMERCE_AUTOMATION_PRESETS = Object.freeze([
  {
    id: 'shopify_order_confirmation',
    label: 'Order confirmation (Shopify / catalog)',
    description: 'Send a utility template shortly after an order is received.',
    eventType: 'whatsapp_order_received',
    delayMinutes: 5,
    unpaidOnly: false,
    fulfillmentStatus: ''
  },
  {
    id: 'shopify_payment_reminder',
    label: 'Prepaid payment reminder',
    description: 'Remind the customer if payment is still pending after the order is created.',
    eventType: 'whatsapp_order_received',
    delayMinutes: 120,
    unpaidOnly: true,
    fulfillmentStatus: ''
  },
  {
    id: 'shopify_shipped_update',
    label: 'Shipped notification',
    description: 'Notify when fulfillment moves to shipped.',
    eventType: 'whatsapp_order_fulfillment',
    delayMinutes: 0,
    unpaidOnly: false,
    fulfillmentStatus: 'shipped'
  },
  {
    id: 'shopify_payment_captured',
    label: 'Payment captured thank-you',
    description: 'Confirm payment after capture.',
    eventType: 'whatsapp_payment_captured',
    delayMinutes: 0,
    unpaidOnly: false,
    fulfillmentStatus: ''
  },
  {
    id: 'shopify_cod_confirmation',
    label: 'COD order confirmation (Shopify)',
    description: 'AiSensy-style COD utility message shortly after the order is received.',
    eventType: 'whatsapp_order_received',
    delayMinutes: 5,
    unpaidOnly: false,
    fulfillmentStatus: ''
  },
  {
    id: 'shopify_cod_non_response',
    label: 'COD non-response follow-up (Shopify)',
    description: 'COD follow-up when the customer has not confirmed after order received (unpaid COD orders only).',
    eventType: 'whatsapp_order_received',
    delayMinutes: 180,
    unpaidOnly: true,
    fulfillmentStatus: ''
  },
  {
    id: 'shopify_cod_payment_reminder',
    label: 'COD payment reminder (Shopify)',
    description: 'Remind unpaid COD customers 24 hours after order received.',
    eventType: 'whatsapp_order_received',
    delayMinutes: 24 * 60,
    unpaidOnly: true,
    fulfillmentStatus: ''
  },
  {
    id: 'shopify_prepaid_shipped_update',
    label: 'Prepaid shipped update (Shopify)',
    description: 'Notify prepaid customers as soon as fulfillment is shipped.',
    eventType: 'whatsapp_order_fulfillment',
    delayMinutes: 0,
    unpaidOnly: false,
    fulfillmentStatus: 'shipped'
  }
]);

export function commerceAutomationPreset(id) {
  return COMMERCE_AUTOMATION_PRESETS.find((item) => item.id === id) || null;
}
