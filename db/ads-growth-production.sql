-- Ads & Growth production hardening (CTWA, insights, leadgen, attribution, journeys, OAuth)

-- Unique Meta Page → tenant mapping (one CRM workspace owns a Page for ads/leadgen)
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_ads_connections_page_unique
  ON whatsapp_ads_connections(page_id);

ALTER TABLE whatsapp_ads_connections ADD COLUMN IF NOT EXISTS token_scopes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE whatsapp_ads_connections ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
ALTER TABLE whatsapp_ads_connections ADD COLUMN IF NOT EXISTS leadgen_subscribed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE whatsapp_ads_connections ADD COLUMN IF NOT EXISTS permissions_checked_at TIMESTAMPTZ;
ALTER TABLE whatsapp_ads_connections ADD COLUMN IF NOT EXISTS connection_method TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE whatsapp_ads_connections ADD COLUMN IF NOT EXISTS last_permission_report JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS ad_campaign_limit INTEGER;

-- Idempotent Meta leadgen submissions
CREATE TABLE IF NOT EXISTS meta_leadgen_submissions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  field_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, lead_id)
);
CREATE INDEX IF NOT EXISTS idx_meta_leadgen_submissions_business
  ON meta_leadgen_submissions(business_id, ingested_at DESC);

-- Cached Meta campaign insights (on-demand sync + worker refresh)
CREATE TABLE IF NOT EXISTS whatsapp_ads_insight_snapshots (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  since_date DATE NOT NULL,
  until_date DATE NOT NULL,
  currency TEXT NOT NULL DEFAULT '',
  impressions NUMERIC,
  reach NUMERIC,
  clicks NUMERIC,
  spend NUMERIC,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (operation_id, since_date, until_date),
  FOREIGN KEY (operation_id, business_id) REFERENCES whatsapp_ads_operations(id, business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_ads_insight_snapshots_business
  ON whatsapp_ads_insight_snapshots(business_id, synced_at DESC);

CREATE TABLE IF NOT EXISTS ads_oauth_states (
  state_hash TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ads_oauth_states_expiry ON ads_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS ads_oauth_pending (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  token_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_expires_at TIMESTAMPTZ,
  permission_report JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['meta_leadgen_submissions','whatsapp_ads_insight_snapshots','ads_oauth_states','ads_oauth_pending'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',
      t
    );
  END LOOP;
END $$;
