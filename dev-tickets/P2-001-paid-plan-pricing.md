# P2-001 — Publish paid subscription plan prices

**Status:** Blocked (commercial approval) — Super Admin after pricing sign-off  
**Priority:** P2  
**Type:** Commercial + Super Admin  

## Context

`db:init` seeds **Free Forever** (visible) and **hidden draft** paid tiers (`starter`, `growth`, `professional`, `enterprise`) with ₹0 until Super Admin sets prices (`lib/default-plans.js`). Proposed reference INR in `CONTEXT.md` is **not** live charges — commercial approval required.

## Tasks

1. Business approval on plan names, limits, INR/USD prices
2. Super Admin → Plans: set `priceCents`, `visible`, `is_active` per tier
3. Razorpay plan alignment if using hosted checkout
4. Update public `/pricing` CMS copy if needed

## Acceptance criteria

- [ ] Only commercially approved plans are visible on `/pricing`
- [ ] Checkout amounts match Super Admin catalogue at purchase time
- [ ] Free Forever remains default for new signups

## References

- `CONTEXT.md` §3 Billing, P2 item 11
- `lib/pricing-architecture.js`
