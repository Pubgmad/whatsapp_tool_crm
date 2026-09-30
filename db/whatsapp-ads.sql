CREATE TABLE IF NOT EXISTS whatsapp_ads_connections (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  ad_account_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (business_id,phone_number_id) REFERENCES whatsapp_phone_numbers(business_id,phone_number_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whatsapp_ads_operations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ad_account_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('processing','paused','active','partial','unconfirmed','archived')),
  stage TEXT NOT NULL DEFAULT 'campaign' CHECK(stage IN ('campaign','adset','creative','ad','complete')),
  campaign_id TEXT NOT NULL DEFAULT '',
  adset_id TEXT NOT NULL DEFAULT '',
  creative_id TEXT NOT NULL DEFAULT '',
  ad_id TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_ads_operations_history ON whatsapp_ads_operations(business_id,created_at DESC,id);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_ads_operations_tenant_key ON whatsapp_ads_operations(id,business_id);
CREATE TABLE IF NOT EXISTS whatsapp_ads_creative_edits (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  previous_creative_id TEXT NOT NULL,
  creative_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK(state IN ('creating','created','applying','unconfirmed','complete','rejected')),
  error_code TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (operation_id,business_id) REFERENCES whatsapp_ads_operations(id,business_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_ads_one_pending_creative_edit ON whatsapp_ads_creative_edits(operation_id) WHERE state NOT IN ('complete','rejected');
CREATE INDEX IF NOT EXISTS whatsapp_ads_creative_edits_tenant ON whatsapp_ads_creative_edits(business_id,operation_id,created_at DESC);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['whatsapp_ads_connections','whatsapp_ads_operations','whatsapp_ads_creative_edits'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',t);
  END LOOP;
END $$;
