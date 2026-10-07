CREATE TABLE IF NOT EXISTS availability_connections (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('shopify','google_calendar')),
  source TEXT NOT NULL,
  credential_encrypted TEXT NOT NULL DEFAULT '',
  refresh_encrypted TEXT NOT NULL DEFAULT '',
  granted_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id,business_id),
  UNIQUE(business_id,provider,source)
);
ALTER TABLE availability_connections ADD COLUMN IF NOT EXISTS granted_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE availability_connections ADD COLUMN IF NOT EXISTS order_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE availability_connections ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
ALTER TABLE availability_connections ADD COLUMN IF NOT EXISTS refresh_expires_at TIMESTAMPTZ;
ALTER TABLE availability_connections ADD COLUMN IF NOT EXISTS auth_method TEXT NOT NULL DEFAULT 'manual' CHECK(auth_method IN ('manual','oauth'));
CREATE TABLE IF NOT EXISTS shopify_oauth_states (
  state_hash TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shopify_oauth_states_expiry ON shopify_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS availability_oauth_states (
  state_hash TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_verifier_encrypted TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'availability' CHECK(mode IN ('availability','booking')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE availability_oauth_states ADD COLUMN IF NOT EXISTS code_verifier_encrypted TEXT NOT NULL DEFAULT '';
ALTER TABLE availability_oauth_states ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'availability' CHECK(mode IN ('availability','booking'));
CREATE INDEX IF NOT EXISTS availability_oauth_expiry ON availability_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS availability_mappings (
  resource_id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  write_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(resource_id,business_id) REFERENCES flow_runtime_resources(id,business_id) ON DELETE CASCADE,
  FOREIGN KEY(connection_id,business_id) REFERENCES availability_connections(id,business_id) ON DELETE CASCADE
);
ALTER TABLE availability_mappings ADD COLUMN IF NOT EXISTS write_enabled BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS availability_mappings_connection ON availability_mappings(business_id,connection_id);
CREATE TABLE IF NOT EXISTS availability_fulfillments (
  reservation_id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  connection_id TEXT,
  provider TEXT NOT NULL CHECK(provider IN ('google_calendar')),
  external_target TEXT NOT NULL,
  external_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','processing','confirmed','cancel_pending','cancelling','cancelled','needs_reconnect','failed')),
  requested_action TEXT NOT NULL DEFAULT 'create' CHECK(requested_action IN ('create','cancel')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(reservation_id,business_id) REFERENCES flow_runtime_reservations(id,business_id) ON DELETE CASCADE,
  FOREIGN KEY(connection_id,business_id) REFERENCES availability_connections(id,business_id) ON DELETE SET NULL (connection_id)
);
ALTER TABLE availability_fulfillments ADD COLUMN IF NOT EXISTS requested_action TEXT NOT NULL DEFAULT 'create' CHECK(requested_action IN ('create','cancel'));
ALTER TABLE availability_fulfillments DROP CONSTRAINT IF EXISTS availability_fulfillments_status_check;
ALTER TABLE availability_fulfillments ADD CONSTRAINT availability_fulfillments_status_check CHECK(status IN ('pending','processing','confirmed','cancel_pending','cancelling','cancelled','needs_reconnect','failed'));
DROP INDEX IF EXISTS availability_fulfillments_due;
CREATE INDEX availability_fulfillments_due ON availability_fulfillments(status,next_attempt_at) WHERE status IN ('pending','processing','cancel_pending','cancelling');
CREATE TABLE IF NOT EXISTS shopify_draft_intents (
  order_id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  connection_id TEXT,
  source TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity>0),
  tag TEXT NOT NULL,
  draft_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('unknown','drafted','rejected','conflict')),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id,tag),
  FOREIGN KEY(order_id,business_id) REFERENCES whatsapp_orders(id,business_id) ON DELETE CASCADE,
  FOREIGN KEY(connection_id,business_id) REFERENCES availability_connections(id,business_id) ON DELETE SET NULL (connection_id)
);
ALTER TABLE shopify_draft_intents ADD COLUMN IF NOT EXISTS shopify_order_id TEXT;
ALTER TABLE shopify_draft_intents ADD COLUMN IF NOT EXISTS shopify_order_status TEXT;
ALTER TABLE shopify_draft_intents ADD COLUMN IF NOT EXISTS shopify_financial_status TEXT;
ALTER TABLE shopify_draft_intents ADD COLUMN IF NOT EXISTS shopify_total_amount NUMERIC(24,6);
ALTER TABLE shopify_draft_intents ALTER COLUMN shopify_total_amount TYPE NUMERIC(24,6);
ALTER TABLE shopify_draft_intents ADD COLUMN IF NOT EXISTS shopify_currency TEXT;
ALTER TABLE shopify_draft_intents ADD COLUMN IF NOT EXISTS shopify_checked_at TIMESTAMPTZ;
ALTER TABLE shopify_draft_intents ADD COLUMN IF NOT EXISTS shopify_next_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE shopify_draft_intents ADD COLUMN IF NOT EXISTS shopify_check_claimed_at TIMESTAMPTZ;
ALTER TABLE shopify_draft_intents ADD COLUMN IF NOT EXISTS shopify_check_attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS shopify_order_check_due ON shopify_draft_intents(shopify_next_check_at) WHERE status='drafted';
CREATE TABLE IF NOT EXISTS shopify_order_settlements (
  order_id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  connection_id TEXT,
  shopify_order_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  received_amount NUMERIC(24,6) NOT NULL CHECK(received_amount>=0),
  refunded_amount NUMERIC(24,6) NOT NULL CHECK(refunded_amount>=0 AND refunded_amount<=received_amount),
  state TEXT NOT NULL CHECK(state IN ('captured','partially_refunded','refunded')),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(order_id,business_id) REFERENCES whatsapp_orders(id,business_id) ON DELETE CASCADE,
  FOREIGN KEY(connection_id,business_id) REFERENCES availability_connections(id,business_id) ON DELETE SET NULL (connection_id)
);
CREATE TABLE IF NOT EXISTS shopify_payment_transactions (
  transaction_id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  shopify_order_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('SALE','CAPTURE','REFUND')),
  amount NUMERIC(24,6) NOT NULL CHECK(amount>0),
  currency TEXT NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(order_id,business_id) REFERENCES whatsapp_orders(id,business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS shopify_payment_transactions_order ON shopify_payment_transactions(business_id,order_id,created_at);
ALTER TABLE whatsapp_orders DROP CONSTRAINT IF EXISTS whatsapp_orders_payment_status_check;
ALTER TABLE whatsapp_orders ADD CONSTRAINT whatsapp_orders_payment_status_check CHECK(payment_status IN ('unpaid','pending','captured','partially_refunded','refunded','failed'));
CREATE UNIQUE INDEX IF NOT EXISTS templates_tenant_identity ON templates(id,business_id);
CREATE TABLE IF NOT EXISTS availability_booking_notice_rules (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('confirmed','cancelled')),
  template_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(business_id,kind),
  FOREIGN KEY(template_id,business_id) REFERENCES templates(id,business_id)
);
CREATE TABLE IF NOT EXISTS availability_booking_notices (
  reservation_id TEXT NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('confirmed','cancelled')),
  template_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','unconfirmed','skipped')),
  claimed_at TIMESTAMPTZ,
  meta_message_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(reservation_id,kind),
  FOREIGN KEY(reservation_id,business_id) REFERENCES flow_runtime_reservations(id,business_id) ON DELETE CASCADE,
  FOREIGN KEY(template_id,business_id) REFERENCES templates(id,business_id)
);
CREATE INDEX IF NOT EXISTS availability_booking_notices_due ON availability_booking_notices(status,created_at) WHERE status IN ('queued','sending');
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['availability_connections','availability_oauth_states','shopify_oauth_states','availability_mappings','availability_fulfillments','shopify_draft_intents','shopify_order_settlements','shopify_payment_transactions','availability_booking_notice_rules','availability_booking_notices'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',t);
  END LOOP;
END $$;
