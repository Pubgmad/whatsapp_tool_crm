CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_account_tenant_key ON whatsapp_accounts(id,business_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversion_conversation_tenant_key ON conversations(id,business_id);
CREATE TABLE IF NOT EXISTS whatsapp_conversion_settings (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  whatsapp_account_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (whatsapp_account_id,business_id) REFERENCES whatsapp_accounts(id,business_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whatsapp_conversion_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL CHECK (event_name IN ('Lead','Purchase')),
  dataset_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing','accepted','failed','unconfirmed')),
  submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  consent_confirmed BOOLEAN NOT NULL CHECK (consent_confirmed),
  error_code TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id,event_id),
  FOREIGN KEY (conversation_id,business_id) REFERENCES conversations(id,business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversions_business ON whatsapp_conversion_events(business_id,created_at DESC,id);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['whatsapp_conversion_settings','whatsapp_conversion_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))', t);
  END LOOP;
END $$;
