ALTER TABLE crm_connections ADD COLUMN IF NOT EXISTS sync_outbound_objects_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE crm_field_mappings ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS crm_object_push_queue (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_object_push_run ON crm_object_push_queue(run_at);

CREATE TABLE IF NOT EXISTS flow_screen_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  flow_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  screen_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('view', 'complete')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flow_screen_events_flow ON flow_screen_events(business_id, flow_id, screen_id, created_at DESC);

ALTER TABLE flow_screen_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_screen_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON flow_screen_events;
CREATE POLICY tenant_isolation ON flow_screen_events
  USING (COALESCE(current_setting('app.system_access', true), '') = 'true' OR business_id = COALESCE(current_setting('app.business_id', true), ''))
  WITH CHECK (COALESCE(current_setting('app.system_access', true), '') = 'true' OR business_id = COALESCE(current_setting('app.business_id', true), ''));

ALTER TABLE crm_object_push_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_object_push_queue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON crm_object_push_queue;
CREATE POLICY tenant_isolation ON crm_object_push_queue
  USING (COALESCE(current_setting('app.system_access', true), '') = 'true' OR business_id = COALESCE(current_setting('app.business_id', true), ''))
  WITH CHECK (COALESCE(current_setting('app.system_access', true), '') = 'true' OR business_id = COALESCE(current_setting('app.business_id', true), ''));
