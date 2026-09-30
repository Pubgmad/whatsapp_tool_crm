CREATE TABLE IF NOT EXISTS merchant_payment_settings (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL,
  key_secret_encrypted TEXT NOT NULL,
  webhook_secret_encrypted TEXT NOT NULL,
  webhook_secret_previous_encrypted TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS merchant_checkouts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor>0),
  currency TEXT NOT NULL,
  provider_link_id TEXT UNIQUE,
  checkout_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('processing','pending','captured','failed','expired','cancelled','unconfirmed')),
  message_state TEXT NOT NULL DEFAULT 'none' CHECK (message_state IN ('none','processing','sent','failed','unconfirmed')),
  meta_message_id TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (order_id,business_id) REFERENCES whatsapp_orders(id,business_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_checkout_active_order ON merchant_checkouts(business_id,order_id) WHERE status NOT IN ('failed','expired','cancelled');
CREATE INDEX IF NOT EXISTS merchant_checkout_business ON merchant_checkouts(business_id,created_at DESC);
CREATE TABLE IF NOT EXISTS merchant_payment_webhooks (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS razorpay_billing_plans (
  version TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  provider_plan_id TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'processing' CHECK(state IN ('processing','ready')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS razorpay_subscription_checkouts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  billing_interval TEXT NOT NULL CHECK(billing_interval IN ('monthly','yearly')),
  provider_plan_id TEXT NOT NULL,
  provider_subscription_id TEXT UNIQUE,
  checkout_url TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'processing',
  total_count INTEGER NOT NULL CHECK(total_count>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS razorpay_pending_subscription ON razorpay_subscription_checkouts(business_id) WHERE state IN ('processing','created','authenticated','unconfirmed');
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['merchant_payment_settings','merchant_checkouts','merchant_payment_webhooks','razorpay_subscription_checkouts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',t);
  END LOOP;
END $$;
