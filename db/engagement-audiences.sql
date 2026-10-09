CREATE INDEX IF NOT EXISTS idx_audience_campaign_events ON campaign_recipients(campaign_id,status,contact_id);
CREATE INDEX IF NOT EXISTS idx_audience_campaign_replies ON messages(campaign_recipient_id,at) WHERE direction='incoming' AND campaign_recipient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audience_paid_orders_v2 ON whatsapp_orders(business_id,customer_phone,payment_event_at) WHERE payment_status IN ('captured','partially_refunded');

CREATE TABLE IF NOT EXISTS audience_tag_jobs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL REFERENCES audience_segments(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('add','remove')),
  tags JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
  total_contacts INTEGER NOT NULL DEFAULT 0,
  processed_contacts INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id,business_id),
  UNIQUE(business_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS audience_tag_job_contacts (
  job_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  PRIMARY KEY(job_id,contact_id),
  FOREIGN KEY(job_id,business_id) REFERENCES audience_tag_jobs(id,business_id) ON DELETE CASCADE,
  FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audience_tag_jobs_business_created ON audience_tag_jobs(business_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audience_tag_snapshot_business ON audience_tag_job_contacts(business_id,job_id);

ALTER TABLE audience_tag_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audience_tag_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audience_tag_jobs;
CREATE POLICY tenant_isolation ON audience_tag_jobs
  USING (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''))
  WITH CHECK (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));

ALTER TABLE audience_tag_job_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audience_tag_job_contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audience_tag_job_contacts;
CREATE POLICY tenant_isolation ON audience_tag_job_contacts
  USING (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''))
  WITH CHECK (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
