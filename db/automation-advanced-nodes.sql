CREATE TABLE IF NOT EXISTS automation_outbound_connections (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('GET','POST')),
  credential_encrypted TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_automation_outbound_business ON automation_outbound_connections(business_id);
ALTER TABLE automation_outbound_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_outbound_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON automation_outbound_connections;
CREATE POLICY tenant_isolation ON automation_outbound_connections
  USING (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''))
  WITH CHECK (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
