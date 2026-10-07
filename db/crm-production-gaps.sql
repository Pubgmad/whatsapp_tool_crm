ALTER TABLE crm_connections ADD COLUMN IF NOT EXISTS sync_outbound_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE ai_agent_settings ADD COLUMN IF NOT EXISTS intent_routing_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_agent_settings ADD COLUMN IF NOT EXISTS intent_routes JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS recurring_interval_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS recurring_parent_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_recurring_interval_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_recurring_interval_check CHECK (recurring_interval_days BETWEEN 0 AND 365);

ALTER TABLE templates ADD COLUMN IF NOT EXISTS content_revision INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS whatsapp_ad_experiments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  meta_campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  hypothesis TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  baseline_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, meta_campaign_id, started_at)
);
CREATE INDEX IF NOT EXISTS idx_ad_experiments_business ON whatsapp_ad_experiments(business_id, status, started_at DESC);
ALTER TABLE whatsapp_ad_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_ad_experiments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_ad_experiments;
CREATE POLICY tenant_isolation ON whatsapp_ad_experiments
  USING (COALESCE(current_setting('app.system_access', true), '') = 'true' OR business_id = COALESCE(current_setting('app.business_id', true), ''))
  WITH CHECK (COALESCE(current_setting('app.system_access', true), '') = 'true' OR business_id = COALESCE(current_setting('app.business_id', true), ''));
