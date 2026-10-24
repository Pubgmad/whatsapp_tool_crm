# P2-003 — CMS republish on production database

**Status:** Ops — [PRODUCTION_RUNBOOK.md](../docs/PRODUCTION_RUNBOOK.md) § P2-003  
**Priority:** P2  
**Type:** Super Admin / content  

## Context

Marketing site is CMS-driven (`lib/cms-document.js`). UX reports (`docs/UX_OVERHAUL_REPORT.txt`, `WEBSITE_PRODUCT_UX_TRANSFORMATION_REPORT.md`) shipped richer defaults on `main`, but **existing production DB** may still have thin published pages until **Reset defaults → review → Publish**.

## Tasks

1. Super Admin → CMS: compare live pages vs expected product/feature depth
2. Run controlled reset or merge new default sections
3. Publish navigation, footer, SEO, feature pages
4. Smoke: `/`, `/products`, `/features/whatsapp-broadcasting`, `/pricing`

## Acceptance criteria

- [ ] Public site matches Ocean Blue / feature-first IA documented in UX reports
- [ ] No accidental wipe of custom legal copy without review
- [ ] Google / SEO fields populated on key landings

## References

- `docs/WEBSITE_PRODUCT_UX_TRANSFORMATION_REPORT.md` §12
- `CONTEXT.md` P2 item 13, §6 Super Admin
