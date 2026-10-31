-- Super Admin SMB configuration wave: sync policies, marketplace providers, playbooks, bot templates.
-- Idempotent inserts only (ON CONFLICT DO NOTHING) — never overwrites customized Super Admin values.

INSERT INTO platform_settings (id, key, label, category, value, value_type, is_public, display_order) VALUES
  ('ps_smb_sheets_sync_policy', 'smb_sheets_sync_policy', 'Google Sheets bot sync policy', 'smb_experience',
    '{"pollIntervalMinutes":5,"minIntervalMinutes":2,"maxIntervalMinutes":60,"maxRowsPerSync":5000,"maxBotsPerWorkspace":10,"retryLimit":3,"matchModes":["exact","keyword","normalized"]}'::jsonb,
    'json', FALSE, 510),
  ('ps_smb_marketplace_providers', 'smb_marketplace_providers', 'Connector marketplace provider catalogue', 'smb_experience',
    '[
      {"id":"google_sheets","label":"Google Sheets","kind":"oauth","category":"bots","feature":"sheets_bot","summary":"Use a spreadsheet as your WhatsApp FAQ or product reply brain.","docsPath":"/app/bots","enabled":true,"adapter":"google_sheets"},
      {"id":"zoho_crm","label":"Zoho CRM","kind":"oauth","category":"crm","feature":"crm_sync","summary":"Sync contacts and leads from Zoho into MathStrat.","docsPath":"/app/settings/integrations","enabled":true,"adapter":"zoho_crm"},
      {"id":"zapier","label":"Zapier","kind":"webhook","category":"automation","feature":"connectors","summary":"Send CRM events to Zapier and receive authorized actions via signed webhooks.","docsPath":"/app/settings/integrations","enabled":true,"adapter":"zapier"},
      {"id":"pabbly","label":"Pabbly Connect","kind":"webhook","category":"automation","feature":"connectors","summary":"Connect Pabbly workflows with inbound/outbound WhatsApp CRM webhooks.","docsPath":"/app/settings/integrations","enabled":true,"adapter":"pabbly"},
      {"id":"shopify","label":"Shopify","kind":"oauth","category":"commerce","feature":"connectors","summary":"Orders, checkouts, and ecommerce playbooks.","docsPath":"/app/settings/integrations","enabled":true,"adapter":"shopify"},
      {"id":"woocommerce","label":"WooCommerce","kind":"webhook","category":"commerce","feature":"connectors","summary":"Signed store webhooks for orders and recovery playbooks.","docsPath":"/app/settings/integrations","enabled":true,"adapter":"woocommerce"}
    ]'::jsonb,
    'json', FALSE, 511),
  ('ps_smb_ecommerce_playbooks', 'smb_ecommerce_playbooks', 'Ecommerce-in-a-box playbook catalogue', 'smb_experience',
    '[
      {"id":"abandoned_checkout_recovery","label":"Abandoned checkout recovery","provider":"shopify","description":"Remind eligible shoppers who left checkout.","kind":"checkout_recovery","defaultDelayMinutes":60,"enabled":true,"version":1},
      {"id":"woo_abandoned_checkout_recovery","label":"WooCommerce checkout recovery","provider":"woocommerce","description":"Recover eligible abandoned WooCommerce checkouts.","kind":"checkout_recovery","defaultDelayMinutes":60,"enabled":true,"version":1},
      {"id":"shopify_order_confirmation","label":"Order confirmation","provider":"shopify","description":"Confirm orders over WhatsApp.","kind":"commerce_preset","presetId":"shopify_order_confirmation","defaultDelayMinutes":5,"enabled":true,"version":1},
      {"id":"shopify_shipped_update","label":"Order shipped","provider":"shopify","description":"Notify when fulfillment ships.","kind":"commerce_preset","presetId":"shopify_shipped_update","defaultDelayMinutes":0,"enabled":true,"version":1}
    ]'::jsonb,
    'json', FALSE, 512),
  ('ps_smb_reply_bot_templates', 'smb_reply_bot_templates', 'Low-code reply bot starter templates', 'smb_experience',
    '[
      {"id":"faq_hours","label":"Business hours FAQ","description":"Answer common hours questions.","enabled":true,"version":1,"fallbackText":"Thanks — a teammate will follow up shortly.","rules":[{"matchType":"contains","pattern":"hours","synonyms":["timing","open","closing"],"replyText":"We are open Mon–Sat, 10am–7pm. How can we help?"}]},
      {"id":"pricing_intro","label":"Pricing intro","description":"Acknowledge price questions and ask for the product.","enabled":true,"version":1,"fallbackText":"Thanks — a teammate will share pricing shortly.","rules":[{"matchType":"any_keyword","pattern":"price","synonyms":["cost","fee","rate"],"replyText":"Happy to help with pricing. Which product or service are you asking about?"}]}
    ]'::jsonb,
    'json', FALSE, 513)
  ,
  ('ps_smb_onboarding_goals', 'smb_onboarding_goals', 'Assisted onboarding goals', 'smb_experience',
    '[{"id":"answer_questions","label":"Answer customer questions automatically","next":"bots"},{"id":"leads","label":"Capture leads","next":"campaigns"},{"id":"campaigns","label":"Send promotional campaigns","next":"campaigns"},{"id":"support","label":"Manage WhatsApp customer support","next":"inbox"},{"id":"checkout_recovery","label":"Recover abandoned checkouts","next":"commerce"},{"id":"appointments","label":"Send appointment reminders","next":"automation"}]'::jsonb,
    'json', FALSE, 514),
  ('ps_smb_concierge_topics', 'smb_concierge_topics', 'Concierge request topic options', 'smb_experience',
    '[{"id":"meta_connection","label":"Meta / WhatsApp connection"},{"id":"phone_setup","label":"Phone number setup"},{"id":"templates","label":"Template approval"},{"id":"first_campaign","label":"First campaign"},{"id":"sheets_bot","label":"Google Sheets bot"},{"id":"ecommerce","label":"Ecommerce integration"},{"id":"automation","label":"First automation"}]'::jsonb,
    'json', FALSE, 515),
  ('ps_smb_zoho_sync_policy', 'smb_zoho_sync_policy', 'Zoho CRM sync policy', 'smb_experience',
    '{"intervalMinutes":15,"minIntervalMinutes":5,"maxIntervalMinutes":1440,"modules":["Contacts","Leads"],"accountsHost":"https://accounts.zoho.com","phoneFields":["Phone","Mobile","Other_Phone"],"nameFields":["Full_Name","Last_Name","First_Name","Company","Email"]}'::jsonb,
    'json', FALSE, 516),
  ('ps_smb_default_fallback', 'smb_default_fallback', 'Default bot fallback reply', 'smb_experience',
    '"Thanks — a teammate will follow up shortly."'::jsonb,
    'json', FALSE, 517)
ON CONFLICT (key) DO NOTHING;

-- Align Simple Mode seed with product destinations (idempotent update only when still the original 8-item seed).
UPDATE platform_settings
SET value = '["overview","inbox","contacts","campaigns","bots","integrations","results","billing","onboarding","setup"]'::jsonb,
    updated_at = NOW()
WHERE key = 'smb_simple_nav'
  AND value = '["overview","inbox","contacts","campaigns","bots","integrations","results","billing"]'::jsonb;

ALTER TABLE sheets_bots ADD COLUMN IF NOT EXISTS sync_fail_count INTEGER NOT NULL DEFAULT 0;

-- Workspace Zoho sync cursor / mapping lives on marketplace_connector_installs.config (no schema change required).
