CREATE TABLE IF NOT EXISTS whatsapp_native_checkouts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  configuration_name TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor>0),
  status TEXT NOT NULL CHECK(status IN ('processing','pending','captured','refunded','failed','unconfirmed')),
  message_id TEXT NOT NULL DEFAULT '',
  provider_order_id TEXT NOT NULL DEFAULT '',
  provider_payment_id TEXT NOT NULL DEFAULT '',
  refunded_minor BIGINT NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (order_id,business_id) REFERENCES whatsapp_orders(id,business_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_native_checkout_order ON whatsapp_native_checkouts(business_id,order_id) WHERE status<>'failed';
CREATE UNIQUE INDEX IF NOT EXISTS idx_native_checkout_payment ON whatsapp_native_checkouts(provider_payment_id) WHERE provider_payment_id<>'';
ALTER TABLE whatsapp_native_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_native_checkouts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_native_checkouts;
CREATE POLICY tenant_isolation ON whatsapp_native_checkouts USING(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),'')) WITH CHECK(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
CREATE TABLE IF NOT EXISTS whatsapp_native_order_updates (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  fulfillment_status TEXT NOT NULL CHECK(fulfillment_status IN ('processing','shipped','completed','cancelled')),
  status TEXT NOT NULL CHECK(status IN ('processing','confirmed','failed','unconfirmed')),
  message_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(order_id,business_id) REFERENCES whatsapp_orders(id,business_id) ON DELETE CASCADE,
  UNIQUE(order_id,fulfillment_status)
);
ALTER TABLE whatsapp_native_order_updates ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS idx_native_order_update_inflight ON whatsapp_native_order_updates(business_id,order_id) WHERE status IN ('processing','unconfirmed');
ALTER TABLE whatsapp_native_order_updates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_native_order_updates;
CREATE POLICY tenant_isolation ON whatsapp_native_order_updates USING(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),'')) WITH CHECK(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
