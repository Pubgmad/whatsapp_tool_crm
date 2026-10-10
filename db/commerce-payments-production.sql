-- Commerce & Payments production hardening (Catalog/Orders, Shopify, Woo, Recovery, Razorpay)

ALTER TABLE provider_connectors ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_connectors ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
ALTER TABLE provider_connectors ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE provider_connectors ADD COLUMN IF NOT EXISTS recovery_max_attempts INTEGER NOT NULL DEFAULT 1;
ALTER TABLE provider_connectors DROP CONSTRAINT IF EXISTS provider_connectors_recovery_max_attempts_check;
ALTER TABLE provider_connectors ADD CONSTRAINT provider_connectors_recovery_max_attempts_check
  CHECK (recovery_max_attempts BETWEEN 1 AND 3);
ALTER TABLE provider_connectors ADD COLUMN IF NOT EXISTS recovery_step_minutes INTEGER NOT NULL DEFAULT 1440;
ALTER TABLE provider_connectors DROP CONSTRAINT IF EXISTS provider_connectors_recovery_step_minutes_check;
ALTER TABLE provider_connectors ADD CONSTRAINT provider_connectors_recovery_step_minutes_check
  CHECK (recovery_step_minutes BETWEEN 15 AND 10080);

ALTER TABLE provider_connector_records ADD COLUMN IF NOT EXISTS recovery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_connector_records ADD COLUMN IF NOT EXISTS recovery_next_at TIMESTAMPTZ;
ALTER TABLE provider_connector_records DROP CONSTRAINT IF EXISTS provider_connector_records_recovery_status_check;
ALTER TABLE provider_connector_records ADD CONSTRAINT provider_connector_records_recovery_status_check
  CHECK (recovery_status IN ('pending','queued','skipped','recovered'));

-- Unified store-order mirror for inbox / agent visibility (authoritative source remains the connector or WhatsApp order)
CREATE TABLE IF NOT EXISTS commerce_store_orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  connector_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('shopify','woocommerce','whatsapp_catalog','hosted','native')),
  external_id TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  total_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unknown',
  fulfillment_status TEXT NOT NULL DEFAULT 'unknown',
  source_label TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, provider, external_id),
  FOREIGN KEY (connector_id, business_id) REFERENCES provider_connectors(id, business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commerce_store_orders_business ON commerce_store_orders(business_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_commerce_store_orders_contact ON commerce_store_orders(business_id, contact_id, occurred_at DESC)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commerce_store_orders_phone ON commerce_store_orders(business_id, customer_phone)
  WHERE customer_phone <> '';

-- Merchant Razorpay → WhatsApp automation activity bindings (AiSensy-style event→campaign mapping)
CREATE TABLE IF NOT EXISTS merchant_payment_activities (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  razorpay_event TEXT NOT NULL CHECK (razorpay_event IN (
    'payment_link.paid','payment_link.expired','payment_link.cancelled','refund.processed'
  )),
  flow_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, name),
  FOREIGN KEY (flow_id, business_id) REFERENCES automation_flows(id, business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_merchant_payment_activities_business ON merchant_payment_activities(business_id, enabled);

-- Checkout recovery analytics rollups (tenant-scoped event log)
CREATE TABLE IF NOT EXISTS checkout_recovery_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL,
  checkout_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'detected','eligible','ineligible','queued','sent','suppressed_purchase','skipped','recovered'
  )),
  reason TEXT NOT NULL DEFAULT '',
  amount NUMERIC(18,6),
  currency TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (connector_id, business_id) REFERENCES provider_connectors(id, business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_checkout_recovery_events_business ON checkout_recovery_events(business_id, created_at DESC);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['commerce_store_orders','merchant_payment_activities','checkout_recovery_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',
      t
    );
  END LOOP;
END $$;
