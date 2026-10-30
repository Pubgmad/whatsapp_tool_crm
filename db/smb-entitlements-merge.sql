-- Merge SMB competitive entitlement keys into existing published catalogue plans.
-- Idempotent: only appends missing keys; never removes Super Admin marketing bullets.

WITH base_keys AS (
  SELECT ARRAY['reply_bots','sheets_bot','assisted_onboarding','simple_mode']::text[] AS keys
),
growth_keys AS (
  SELECT ARRAY['reply_bots','sheets_bot','assisted_onboarding','simple_mode','ecommerce_playbooks']::text[] AS keys
)
UPDATE subscription_plans sp
SET features = (
  SELECT COALESCE(jsonb_agg(to_jsonb(elem) ORDER BY ord), '[]'::jsonb)
  FROM (
    SELECT elem, MIN(ord) AS ord
    FROM (
      SELECT value AS elem, ordinality AS ord
      FROM jsonb_array_elements_text(COALESCE(sp.features, '[]'::jsonb)) WITH ORDINALITY
      UNION ALL
      SELECT k, 1000 + i
      FROM unnest(
        CASE
          WHEN lower(sp.code) IN ('growth', 'professional', 'enterprise') THEN (SELECT keys FROM growth_keys)
          ELSE (SELECT keys FROM base_keys)
        END
      ) WITH ORDINALITY AS u(k, i)
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(sp.features, '[]'::jsonb)) e(value)
        WHERE e.value = u.k
      )
    ) merged
    GROUP BY elem
  ) distinct_elems
),
updated_at = NOW()
WHERE lower(code) IN ('free', 'starter', 'growth', 'professional', 'enterprise');
