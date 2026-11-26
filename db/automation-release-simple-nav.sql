-- WhatsApp Automation production release: ensure Simple Mode surfaces Bots + Automation.
-- Idempotent. Safe to re-run.
-- Preserves Super Admin customizations: never replaces an existing smb_simple_nav array;
-- only appends missing "bots" / "automation" entries.

INSERT INTO platform_settings (id, key, label, category, value, value_type, is_public, display_order)
VALUES (
  'ps_smb_simple_nav',
  'smb_simple_nav',
  'Simple Mode primary destinations',
  'smb_experience',
  '["setup","onboarding","inbox","contacts","templates","bots","automation","campaigns","ads","results","unsubscribes","billing"]'::jsonb,
  'json',
  FALSE,
  502
)
ON CONFLICT (key) DO NOTHING;

-- Append bots/automation only when missing from the current array.
UPDATE platform_settings
SET value = COALESCE(value, '[]'::jsonb)
            || CASE WHEN EXISTS (
                 SELECT 1 FROM jsonb_array_elements_text(COALESCE(value, '[]'::jsonb)) e(v) WHERE v = 'bots'
               ) THEN '[]'::jsonb ELSE '["bots"]'::jsonb END
            || CASE WHEN EXISTS (
                 SELECT 1 FROM jsonb_array_elements_text(COALESCE(value, '[]'::jsonb)) e(v) WHERE v = 'automation'
               ) THEN '[]'::jsonb ELSE '["automation"]'::jsonb END,
    updated_at = NOW()
WHERE key = 'smb_simple_nav'
  AND jsonb_typeof(COALESCE(value, '[]'::jsonb)) = 'array'
  AND (
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(value, '[]'::jsonb)) e(v) WHERE v = 'bots')
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(value, '[]'::jsonb)) e(v) WHERE v = 'automation')
  );
