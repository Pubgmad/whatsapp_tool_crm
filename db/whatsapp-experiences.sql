ALTER TABLE whatsapp_native_flows ADD COLUMN IF NOT EXISTS response_mapping JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS whatsapp_flow_invites (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  flow_id TEXT NOT NULL REFERENCES whatsapp_native_flows(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phone_id TEXT NOT NULL REFERENCES whatsapp_phone_numbers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  mapping JSONB NOT NULL,
  fields JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','sent','unconfirmed','failed','completed')),
  meta_message_id TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id,request_id)
);
CREATE TABLE IF NOT EXISTS whatsapp_flow_submissions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invite_id TEXT NOT NULL UNIQUE REFERENCES whatsapp_flow_invites(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS whatsapp_entry_rules (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone_id TEXT NOT NULL REFERENCES whatsapp_phone_numbers(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  source_name TEXT NOT NULL,
  prefilled_message TEXT NOT NULL,
  workflow_id TEXT REFERENCES automation_flows(id) ON DELETE SET NULL,
  cooldown_minutes INTEGER NOT NULL CHECK(cooldown_minutes BETWEEN 1 AND 43200),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(phone_id,code)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entry_rule_match ON whatsapp_entry_rules(business_id,phone_id,prefilled_message) WHERE enabled;
CREATE TABLE IF NOT EXISTS whatsapp_entry_attributions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL REFERENCES whatsapp_entry_rules(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  session_id TEXT REFERENCES automation_sessions(id) ON DELETE SET NULL,
  workflow_status TEXT NOT NULL,
  matched_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_entry_attribution_cooldown ON whatsapp_entry_attributions(rule_id,contact_id,matched_at DESC);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['whatsapp_flow_invites','whatsapp_flow_submissions','whatsapp_entry_rules','whatsapp_entry_attributions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',t);
  END LOOP;
END $$;
