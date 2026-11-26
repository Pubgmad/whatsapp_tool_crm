-- WhatsApp Automation production release: ensure Simple Mode surfaces Bots + Automation.
-- Idempotent. Safe to re-run. Does not delete Advanced Mode destinations.

INSERT INTO platform_settings (id, key, label, category, value, value_type, is_secret, sort_order)
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
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = NOW()
WHERE platform_settings.key = 'smb_simple_nav';
