-- Publish paid catalogue rows that are still drafts (mathstrat-default-plans-v4).
-- Annual cents are round(monthly rupees * 12 * 0.88) * 100.
-- A row that is already visible, or whose commercial_status is no longer draft, is left unchanged
-- so a later Super Admin edit is not overwritten on the next db:init.

UPDATE subscription_plans AS sp
SET
  description = v.description,
  price_cents = v.monthly_price_cents,
  monthly_price_cents = v.monthly_price_cents,
  yearly_price_cents = v.yearly_price_cents,
  visible = TRUE,
  features = CASE
    WHEN sp.code = 'enterprise' THEN replace(sp.features::text, '"Contact sales for pricing"', '"Published monthly and annual platform price"')::jsonb
    ELSE sp.features
  END,
  metadata = COALESCE(sp.metadata, '{}'::jsonb) || jsonb_build_object(
    'commercial_status', 'published',
    'catalogue_version', 'mathstrat-default-plans-v4',
    'proposed_monthly_inr', v.monthly_inr
  ),
  updated_at = NOW()
FROM (VALUES
  ('starter', 'For small teams that need more seats and light broadcasting. Meta WhatsApp messaging charges remain separate.', 99900, 1054900, 999),
  ('growth', 'For teams running broadcasts, segments, and store connectors. Meta WhatsApp messaging charges remain separate.', 249900, 2638900, 2499),
  ('professional', 'For advanced automation, Flows, AI drafts, and CRM sync. Meta WhatsApp messaging charges remain separate.', 599900, 6334900, 5999),
  ('enterprise', 'For custom limits and governance, with a published platform price. Meta WhatsApp messaging charges remain separate.', 1500000, 15840000, 15000)
) AS v(code, description, monthly_price_cents, yearly_price_cents, monthly_inr)
WHERE sp.code = v.code
  AND sp.visible = FALSE
  AND COALESCE(sp.metadata->>'commercial_status', 'draft') = 'draft';
