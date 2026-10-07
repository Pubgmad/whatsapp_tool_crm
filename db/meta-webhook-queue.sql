CREATE TABLE IF NOT EXISTS meta_webhook_queue (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  waba_id TEXT NOT NULL,
  field TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  lock_token TEXT,
  error_code TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
ALTER TABLE meta_webhook_queue ADD COLUMN IF NOT EXISTS lock_token TEXT;
CREATE INDEX IF NOT EXISTS idx_meta_webhook_queue_due ON meta_webhook_queue (run_at,id) WHERE status='queued';
CREATE INDEX IF NOT EXISTS idx_meta_webhook_queue_queued_age ON meta_webhook_queue (received_at) WHERE status='queued';
CREATE INDEX IF NOT EXISTS idx_meta_webhook_queue_failed ON meta_webhook_queue (received_at DESC,id) WHERE status='failed';
ALTER TABLE meta_webhook_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_webhook_queue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON meta_webhook_queue;
CREATE POLICY tenant_isolation ON meta_webhook_queue
  USING (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''))
  WITH CHECK (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
