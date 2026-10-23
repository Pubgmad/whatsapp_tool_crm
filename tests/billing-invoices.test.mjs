import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRazorpayInvoiceRow } from '../lib/billing.js';

test('mapRazorpayInvoiceRow normalizes Razorpay invoice fields', () => {
  const row = mapRazorpayInvoiceRow({
    id: 'inv_test',
    status: 'paid',
    amount_paid: 49900,
    currency: 'INR',
    paid_at: 1_700_000_000,
    billing_start: 1_699_000_000,
    billing_end: 1_702_000_000,
    payment_id: 'pay_test'
  });
  assert.equal(row.id, 'inv_test');
  assert.equal(row.status, 'paid');
  assert.equal(row.amountPaid, 49900);
  assert.equal(row.paymentId, 'pay_test');
  assert.ok(row.paidAt);
});
