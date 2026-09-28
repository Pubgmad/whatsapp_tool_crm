CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_phone_tenant_key ON whatsapp_phone_numbers(id,business_id);
CREATE TABLE IF NOT EXISTS whatsapp_orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  catalog_id TEXT NOT NULL,
  items JSONB NOT NULL,
  currency TEXT NOT NULL,
  total_amount NUMERIC(24,6) NOT NULL CHECK (total_amount >= 0),
  reference_id TEXT,
  checkout_message_id TEXT,
  fulfillment_status TEXT NOT NULL DEFAULT 'pending' CHECK (fulfillment_status IN ('pending','processing','shipped','completed','cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','pending','captured','failed')),
  payment_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, source_message_id),
  UNIQUE (business_id, reference_id),
  UNIQUE (id,business_id),
  FOREIGN KEY (phone_id,business_id) REFERENCES whatsapp_phone_numbers(id,business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_orders_business ON whatsapp_orders(business_id,created_at DESC,id);
CREATE TABLE IF NOT EXISTS whatsapp_payment_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','captured','failed')),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (order_id,business_id) REFERENCES whatsapp_orders(id,business_id) ON DELETE CASCADE
);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['whatsapp_orders','whatsapp_payment_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))', t);
  END LOOP;
END $$;
