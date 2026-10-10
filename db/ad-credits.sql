-- Prepaid Meta Ads credit wallet (AiSensy-style Buy Credits)

CREATE TABLE IF NOT EXISTS ad_credit_wallets (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'INR',
  balance_minor BIGINT NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  reserved_minor BIGINT NOT NULL DEFAULT 0 CHECK (reserved_minor >= 0),
  starter_granted BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ad_credit_packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  credits_minor BIGINT NOT NULL CHECK (credits_minor > 0),
  price_minor BIGINT NOT NULL CHECK (price_minor > 0),
  display_order INTEGER NOT NULL DEFAULT 100,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ad_credit_purchases (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  package_id TEXT REFERENCES ad_credit_packages(id) ON DELETE SET NULL,
  currency TEXT NOT NULL,
  credits_minor BIGINT NOT NULL CHECK (credits_minor > 0),
  price_minor BIGINT NOT NULL CHECK (price_minor > 0),
  status TEXT NOT NULL CHECK (status IN ('processing','pending','captured','failed','cancelled','expired','unconfirmed')),
  provider_link_id TEXT NOT NULL DEFAULT '',
  checkout_url TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, id)
);
CREATE INDEX IF NOT EXISTS idx_ad_credit_purchases_business ON ad_credit_purchases(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ad_credit_ledger (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'purchase','starter_grant','admin_grant','admin_adjust',
    'reserve','release','spend_settle','refund'
  )),
  amount_minor BIGINT NOT NULL,
  balance_after_minor BIGINT NOT NULL CHECK (balance_after_minor >= 0),
  reserved_after_minor BIGINT NOT NULL CHECK (reserved_after_minor >= 0),
  currency TEXT NOT NULL,
  operation_id TEXT,
  purchase_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_credit_ledger_business ON ad_credit_ledger(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ad_credit_reservations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  reserved_minor BIGINT NOT NULL CHECK (reserved_minor >= 0),
  settled_minor BIGINT NOT NULL DEFAULT 0 CHECK (settled_minor >= 0),
  status TEXT NOT NULL CHECK (status IN ('active','released','exhausted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, operation_id),
  FOREIGN KEY (operation_id, business_id) REFERENCES whatsapp_ads_operations(id, business_id) ON DELETE CASCADE,
  CHECK (settled_minor <= reserved_minor)
);

INSERT INTO ad_credit_packages (id, name, currency, credits_minor, price_minor, display_order)
VALUES
  ('adp_starter', 'Starter ₹1,000', 'INR', 100000, 100000, 10),
  ('adp_growth', 'Growth ₹5,000', 'INR', 500000, 500000, 20),
  ('adp_scale', 'Scale ₹10,000', 'INR', 1000000, 1000000, 30),
  ('adp_pro', 'Pro ₹25,000', 'INR', 2500000, 2500000, 40)
ON CONFLICT (id) DO NOTHING;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['ad_credit_wallets','ad_credit_packages','ad_credit_purchases','ad_credit_ledger','ad_credit_reservations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    IF t = 'ad_credit_packages' THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (TRUE) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'')',
        t
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',
        t
      );
    END IF;
  END LOOP;
END $$;
