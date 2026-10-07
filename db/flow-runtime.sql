-- Apply after schema.sql and whatsapp-commerce.sql. No demo inventory is inserted.
CREATE UNIQUE INDEX IF NOT EXISTS flow_runtime_flow_tenant ON whatsapp_native_flows(id,business_id);
CREATE UNIQUE INDEX IF NOT EXISTS flow_runtime_contact_tenant ON contacts(id,business_id);
CREATE UNIQUE INDEX IF NOT EXISTS flow_runtime_phone_tenant ON whatsapp_phone_numbers(id,business_id);

CREATE TABLE IF NOT EXISTS flow_runtime_configs (
  flow_id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  config JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE(flow_id,business_id),
  FOREIGN KEY(flow_id,business_id) REFERENCES whatsapp_native_flows(id,business_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS flow_runtime_resources (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('product','slot')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  capacity INTEGER NOT NULL CHECK(capacity BETWEEN 0 AND 1000000),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  catalog_id TEXT NOT NULL DEFAULT '',
  retailer_id TEXT NOT NULL DEFAULT '',
  unit_price NUMERIC(18,6) NOT NULL CHECK(unit_price >= 0),
  currency TEXT NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  UNIQUE(id,business_id),
  CHECK((kind='slot' AND starts_at IS NOT NULL AND ends_at>starts_at AND catalog_id='' AND retailer_id='')
     OR (kind='product' AND starts_at IS NULL AND ends_at IS NULL AND catalog_id ~ '^[0-9]{1,32}$' AND length(retailer_id) BETWEEN 1 AND 256))
);
CREATE UNIQUE INDEX IF NOT EXISTS flow_runtime_product_key ON flow_runtime_resources(business_id,catalog_id,retailer_id) WHERE kind='product';
CREATE TABLE IF NOT EXISTS flow_runtime_sessions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  flow_id TEXT NOT NULL,
  phone_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL,
  screen TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(id,business_id),
  FOREIGN KEY(flow_id,business_id) REFERENCES flow_runtime_configs(flow_id,business_id) ON DELETE CASCADE,
  FOREIGN KEY(phone_id,business_id) REFERENCES whatsapp_phone_numbers(id,business_id) ON DELETE CASCADE,
  FOREIGN KEY(contact_id,business_id) REFERENCES contacts(id,business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS flow_runtime_sessions_contact ON flow_runtime_sessions(business_id,contact_id,id);
CREATE TABLE IF NOT EXISTS flow_runtime_reservations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
  snapshot JSONB NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('held','pending_external','confirmed','cancel_pending','external_failed','cancelled','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  order_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id,business_id),
  FOREIGN KEY(session_id,business_id) REFERENCES flow_runtime_sessions(id,business_id) ON DELETE CASCADE,
  FOREIGN KEY(resource_id,business_id) REFERENCES flow_runtime_resources(id,business_id),
  FOREIGN KEY(order_id,business_id) REFERENCES whatsapp_orders(id,business_id)
);
ALTER TABLE flow_runtime_reservations DROP CONSTRAINT IF EXISTS flow_runtime_reservations_status_check;
ALTER TABLE flow_runtime_reservations ADD CONSTRAINT flow_runtime_reservations_status_check CHECK(status IN ('held','pending_external','confirmed','cancel_pending','external_failed','cancelled','expired'));
CREATE UNIQUE INDEX IF NOT EXISTS flow_runtime_reservations_tenant_identity ON flow_runtime_reservations(id,business_id);
DROP INDEX IF EXISTS flow_runtime_active_reservation;
CREATE UNIQUE INDEX flow_runtime_active_reservation ON flow_runtime_reservations(session_id) WHERE status IN ('held','pending_external','confirmed','cancel_pending','external_failed');
CREATE INDEX IF NOT EXISTS flow_runtime_capacity ON flow_runtime_reservations(business_id,resource_id,status,expires_at);
CREATE INDEX IF NOT EXISTS flow_runtime_reservations_session_recent ON flow_runtime_reservations(business_id,session_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS flow_runtime_requests (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  response JSONB NOT NULL,
  PRIMARY KEY(session_id,request_id),
  FOREIGN KEY(session_id,business_id) REFERENCES flow_runtime_sessions(id,business_id) ON DELETE CASCADE
);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['flow_runtime_configs','flow_runtime_resources','flow_runtime_sessions','flow_runtime_reservations','flow_runtime_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',t);
  END LOOP;
END $$;
