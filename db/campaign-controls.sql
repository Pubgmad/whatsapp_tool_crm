ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS frequency_hours INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS source_campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaigns'::regclass AND conname='campaigns_approval_check') THEN
    ALTER TABLE campaigns ADD CONSTRAINT campaigns_approval_check CHECK (approval_status IN ('not_required','draft','pending','approved','rejected'));
    ALTER TABLE campaigns ADD CONSTRAINT campaigns_frequency_check CHECK (frequency_hours BETWEEN 0 AND 8760);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_tenant_key ON contacts(id,business_id);
CREATE TABLE IF NOT EXISTS campaign_policies (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  min_marketing_interval_hours INTEGER NOT NULL DEFAULT 0 CHECK (min_marketing_interval_hours BETWEEN 0 AND 8760),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE campaign_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON campaign_policies;
CREATE POLICY tenant_isolation ON campaign_policies
USING (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''))
WITH CHECK (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_tenant_key ON campaigns(id,business_id);
CREATE TABLE IF NOT EXISTS campaign_delivery_reservations (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reserved_until TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (business_id,contact_id),
  FOREIGN KEY (contact_id,business_id) REFERENCES contacts(id,business_id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id,business_id) REFERENCES campaigns(id,business_id) ON DELETE CASCADE
);
ALTER TABLE campaign_delivery_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_delivery_reservations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON campaign_delivery_reservations;
CREATE POLICY tenant_isolation ON campaign_delivery_reservations
USING (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''))
WITH CHECK (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
