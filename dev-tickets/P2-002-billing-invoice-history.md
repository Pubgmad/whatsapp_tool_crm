# P2-002 — Billing UI: invoice history (Razorpay)

**Status:** Open  
**Priority:** P2  
**Type:** Engineering  

## Context

Workspace billing uses Razorpay subscriptions (`lib/razorpay-billing.js`, `components/razorpay-subscription-actions.js`). `CONTEXT.md` notes **invoices history** if/when Razorpay API exposes usable invoice list for the integration pattern used.

## Scope

1. Confirm Razorpay API capabilities for subscription invoices
2. If available: API route + Billing UI section (owner-only)
3. If not: document limitation in UI (honest limits)

## Acceptance criteria

- [ ] Owners see past invoices or clear “contact support / Razorpay portal” path
- [ ] No PCI/key leakage to browser

## References

- `CONTEXT.md` P2 item 12
- `README.md` Razorpay SaaS billing
