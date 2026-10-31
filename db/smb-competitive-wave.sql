-- SMB competitive wave: Sheets bot, reply bots, onboarding, concierge, experience mode, playbooks.
-- Idempotent; applied from db-init after feature-completion-wave.

INSERT INTO platform_settings (id, key, label, category, value, value_type, is_public, display_order) VALUES
  ('ps_feature_sheets_bot_enabled', 'feature_sheets_bot_enabled', 'Google Sheets bot brain', 'feature_controls', 'true'::jsonb, 'boolean', FALSE, 430),
  ('ps_feature_reply_bots_enabled', 'feature_reply_bots_enabled', 'Low-code reply bots', 'feature_controls', 'true'::jsonb, 'boolean', FALSE, 431),
  ('ps_feature_assisted_onboarding_enabled', 'feature_assisted_onboarding_enabled', 'Assisted WhatsApp onboarding', 'feature_controls', 'true'::jsonb, 'boolean', FALSE, 432),
  ('ps_feature_simple_mode_enabled', 'feature_simple_mode_enabled', 'SMB Simple Mode experience', 'feature_controls', 'true'::jsonb, 'boolean', FALSE, 433),
  ('ps_feature_ecommerce_playbooks_enabled', 'feature_ecommerce_playbooks_enabled', 'Ecommerce-in-a-box playbooks', 'feature_controls', 'true'::jsonb, 'boolean', FALSE, 434),
  ('ps_smb_sheets_schemas', 'smb_sheets_schemas', 'Google Sheets bot schema templates', 'smb_experience',
    '[{"id":"faq","label":"FAQ bot","fields":[{"key":"question","label":"Question","required":true},{"key":"answer","label":"Answer","required":true},{"key":"keywords","label":"Keywords","required":false},{"key":"enabled","label":"Enabled","required":false}]},{"id":"product","label":"Product enquiry","fields":[{"key":"product","label":"Product","required":true},{"key":"description","label":"Description","required":false},{"key":"price","label":"Price","required":false},{"key":"reply","label":"Reply","required":true},{"key":"enabled","label":"Enabled","required":false}]},{"id":"appointment","label":"Appointment info","fields":[{"key":"service","label":"Service","required":true},{"key":"hours","label":"Working hours","required":false},{"key":"location","label":"Location","required":false},{"key":"booking_link","label":"Booking link","required":false},{"key":"reply","label":"Reply","required":true}]}]'::jsonb,
    'json', FALSE, 500),
  ('ps_smb_onboarding_steps', 'smb_onboarding_steps', 'Assisted onboarding steps', 'smb_experience',
    '[{"id":"business","label":"Tell us about your business","help":"Share a short description so we can recommend the right setup."},{"id":"connect","label":"Connect WhatsApp","help":"Use Meta Embedded Signup to link your Business number."},{"id":"verify","label":"Verify connection","help":"Confirm WABA and phone readiness."},{"id":"goal","label":"Choose your goal","help":"Pick what you want to achieve first."},{"id":"setup","label":"Set up your first feature","help":"Activate a starter bot, campaign, or store playbook."},{"id":"test","label":"Test","help":"Preview replies or send an authorized test."},{"id":"live","label":"Go live","help":"Activate only when prerequisites are met."}]'::jsonb,
    'json', FALSE, 501),
  ('ps_smb_simple_nav', 'smb_simple_nav', 'Simple Mode primary destinations', 'smb_experience',
    '["overview","inbox","contacts","campaigns","bots","integrations","results","billing","onboarding","setup"]'::jsonb,
    'json', FALSE, 502),
  ('ps_smb_concierge_enabled', 'smb_concierge_enabled', 'Concierge assistance requests enabled', 'smb_experience', 'true'::jsonb, 'boolean', FALSE, 503)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS experience_mode TEXT NOT NULL DEFAULT 'advanced'
  CHECK (experience_mode IN ('simple', 'advanced'));
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS onboarding_state JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS reply_bots (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused')),
  fallback_text TEXT NOT NULL DEFAULT '',
  handoff_on_fallback BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 100,
  phone_number_id TEXT NOT NULL DEFAULT '',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reply_bots_biz ON reply_bots (business_id, status, priority);

CREATE TABLE IF NOT EXISTS reply_bot_rules (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL REFERENCES reply_bots(id) ON DELETE CASCADE,
  match_type TEXT NOT NULL DEFAULT 'contains' CHECK (match_type IN ('exact', 'contains', 'any_keyword', 'regex')),
  pattern TEXT NOT NULL,
  synonyms JSONB NOT NULL DEFAULT '[]'::jsonb,
  reply_text TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reply_bot_rules_bot ON reply_bot_rules (bot_id, enabled, sort_order);

CREATE TABLE IF NOT EXISTS reply_bot_executions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL,
  rule_id TEXT,
  conversation_id TEXT,
  inbound_message_id TEXT,
  matched_text TEXT NOT NULL DEFAULT '',
  reply_text TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT 'matched',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reply_bot_exec_biz ON reply_bot_executions (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sheets_bot_connections (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  google_account_email TEXT NOT NULL DEFAULT '',
  access_token_encrypted TEXT NOT NULL DEFAULT '',
  refresh_token_encrypted TEXT NOT NULL DEFAULT '',
  token_expires_at TIMESTAMPTZ,
  scopes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connected', 'expired', 'error')),
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id)
);

CREATE TABLE IF NOT EXISTS sheets_bots (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES sheets_bot_connections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  schema_id TEXT NOT NULL DEFAULT 'faq',
  spreadsheet_id TEXT NOT NULL,
  spreadsheet_title TEXT NOT NULL DEFAULT '',
  sheet_name TEXT NOT NULL DEFAULT '',
  column_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused')),
  fallback_text TEXT NOT NULL DEFAULT '',
  match_mode TEXT NOT NULL DEFAULT 'keyword' CHECK (match_mode IN ('exact', 'keyword', 'normalized')),
  sync_mode TEXT NOT NULL DEFAULT 'poll' CHECK (sync_mode IN ('poll', 'manual')),
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT NOT NULL DEFAULT '',
  last_sync_error TEXT NOT NULL DEFAULT '',
  sync_version INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sheets_bots_biz ON sheets_bots (business_id, status);

CREATE TABLE IF NOT EXISTS sheets_bot_rows (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL REFERENCES sheets_bots(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_text TEXT NOT NULL DEFAULT '',
  reply_text TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sync_version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bot_id, row_index)
);
CREATE INDEX IF NOT EXISTS idx_sheets_bot_rows_search ON sheets_bot_rows (bot_id, enabled);

CREATE TABLE IF NOT EXISTS concierge_requests (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  request_type TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  assignee_note TEXT NOT NULL DEFAULT '',
  resolution_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_concierge_biz ON concierge_requests (business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_concierge_status ON concierge_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS ecommerce_playbook_activations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  playbook_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'shopify',
  connector_id TEXT NOT NULL DEFAULT '',
  template_id TEXT NOT NULL DEFAULT '',
  flow_id TEXT NOT NULL DEFAULT '',
  delay_minutes INTEGER NOT NULL DEFAULT 60,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ecom_playbooks_biz ON ecommerce_playbook_activations (business_id, status);

CREATE TABLE IF NOT EXISTS marketplace_connector_installs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'error')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_encrypted TEXT NOT NULL DEFAULT '',
  last_activity_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, provider)
);

-- RLS tenant policies (system access for workers)
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'reply_bots','reply_bot_rules','reply_bot_executions',
    'sheets_bot_connections','sheets_bots','sheets_bot_rows',
    'concierge_requests','ecommerce_playbook_activations','marketplace_connector_installs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_tenant ON %I USING (
        COALESCE(current_setting(''app.system_access'', true), '''') = ''true''
        OR business_id = NULLIF(current_setting(''app.business_id'', true), '''')
      ) WITH CHECK (
        COALESCE(current_setting(''app.system_access'', true), '''') = ''true''
        OR business_id = NULLIF(current_setting(''app.business_id'', true), '''')
      )', t, t);
  END LOOP;
END $$;
