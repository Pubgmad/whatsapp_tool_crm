CREATE TABLE IF NOT EXISTS whatsapp_calls (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  provider_call_id TEXT NOT NULL DEFAULT '',
  remote_number TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('USER_INITIATED','BUSINESS_INITIATED')),
  status TEXT NOT NULL CHECK (status IN ('processing','ringing','connecting','active','rejected','terminated','failed','unconfirmed')),
  agent_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  remote_session JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT NOT NULL DEFAULT '',
  last_event_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (business_id,phone_number_id) REFERENCES whatsapp_phone_numbers(business_id,phone_number_id) ON DELETE CASCADE,
  UNIQUE (id,business_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_call_provider ON whatsapp_calls(provider_call_id) WHERE provider_call_id<>'';
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_call_agent_live ON whatsapp_calls(business_id,agent_id) WHERE agent_id IS NOT NULL AND status IN ('processing','connecting','active','ringing','unconfirmed');
CREATE INDEX IF NOT EXISTS idx_whatsapp_call_history ON whatsapp_calls(business_id,created_at DESC,id);
CREATE TABLE IF NOT EXISTS whatsapp_call_actions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  call_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('connect','accept','reject','terminate')),
  status TEXT NOT NULL CHECK (status IN ('processing','confirmed','failed','unconfirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (call_id,business_id) REFERENCES whatsapp_calls(id,business_id) ON DELETE CASCADE,
  UNIQUE(call_id,action)
);
CREATE TABLE IF NOT EXISTS whatsapp_call_webhook_buffer (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  provider_call_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (business_id,phone_number_id) REFERENCES whatsapp_phone_numbers(business_id,phone_number_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_call_buffer_provider ON whatsapp_call_webhook_buffer(business_id,provider_call_id,occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_contact_tenant_key ON contacts(id,business_id);
CREATE TABLE IF NOT EXISTS whatsapp_call_permission_requests (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing','confirmed','failed','unconfirmed')),
  message_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (business_id,phone_number_id) REFERENCES whatsapp_phone_numbers(business_id,phone_number_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id,business_id) REFERENCES contacts(id,business_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_permission_inflight ON whatsapp_call_permission_requests(business_id,phone_number_id,contact_id) WHERE status IN ('processing','unconfirmed');
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['whatsapp_calls','whatsapp_call_actions','whatsapp_call_webhook_buffer','whatsapp_call_permission_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',t);
  END LOOP;
END $$;
