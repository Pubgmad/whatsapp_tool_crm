-- Additive WhatsApp Automation entitlement repair for Free/Pro.
-- Prior smb-entitlements-merge.sql appended only reply_bots/sheets_bot/etc.,
-- which made planEntitlementKeys() non-empty and accidentally denied inbox/segments/templates.
-- This merge appends the intended catalogue keys without removing marketing bullets.

WITH free_keys AS (
  SELECT ARRAY[
    'inbox','templates','segments','automation','entry_points',
    'reply_bots','sheets_bot','assisted_onboarding','simple_mode'
  ]::text[] AS keys
),
pro_keys AS (
  SELECT ARRAY[
    'inbox','templates','segments','automation','campaigns','marketing_messages',
    'entry_points','whatsapp_flows','webviews','connectors','ai_agent','ai_auto_reply',
    'dialogflow_bot','reply_bots','sheets_bot','assisted_onboarding','simple_mode'
  ]::text[] AS keys
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
      SELECT k, 2000 + i
      FROM unnest(
        CASE
          WHEN lower(sp.code) = 'pro' THEN (SELECT keys FROM pro_keys)
          ELSE (SELECT keys FROM free_keys)
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
WHERE lower(code) IN ('free', 'pro');
