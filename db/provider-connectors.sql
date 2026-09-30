CREATE TABLE IF NOT EXISTS provider_connectors (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('shopify','woocommerce')),
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL,
  flow_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id,business_id)
);
CREATE TABLE IF NOT EXISTS provider_connector_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  topic TEXT NOT NULL,
  data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processed','skipped')),
  error_code TEXT NOT NULL DEFAULT '',
  session_id TEXT REFERENCES automation_sessions(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(connector_id,delivery_id),
  UNIQUE(connector_id,body_hash),
  FOREIGN KEY(connector_id,business_id) REFERENCES provider_connectors(id,business_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS provider_connector_records (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL,
  resource TEXT NOT NULL CHECK (resource IN ('order','checkout')),
  external_id TEXT NOT NULL,
  data JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  dispatched BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY(connector_id,resource,external_id),
  FOREIGN KEY(connector_id,business_id) REFERENCES provider_connectors(id,business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_provider_connector_due ON provider_connector_events(received_at,id) WHERE status='queued';
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['provider_connectors','provider_connector_events','provider_connector_records'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',t);
  END LOOP;
END $$;
