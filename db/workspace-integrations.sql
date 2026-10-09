CREATE TABLE IF NOT EXISTS workspace_api_keys (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  allowed_flow_ids JSONB NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE workspace_api_keys ALTER COLUMN allowed_flow_ids SET DEFAULT '[]'::jsonb;
ALTER TABLE workspace_api_keys ADD COLUMN IF NOT EXISTS scopes JSONB NOT NULL DEFAULT '["workflows:execute"]'::jsonb;
ALTER TABLE workspace_api_keys ADD COLUMN IF NOT EXISTS active_from TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE workspace_api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE workspace_api_keys ADD COLUMN IF NOT EXISTS ip_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE workspace_api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER NOT NULL DEFAULT 60;
ALTER TABLE workspace_api_keys ADD COLUMN IF NOT EXISTS previous_token_hash TEXT;
ALTER TABLE workspace_api_keys ADD COLUMN IF NOT EXISTS previous_token_valid_until TIMESTAMPTZ;
ALTER TABLE workspace_api_keys DROP CONSTRAINT IF EXISTS workspace_api_keys_rate_limit_check;
ALTER TABLE workspace_api_keys ADD CONSTRAINT workspace_api_keys_rate_limit_check CHECK (rate_limit_per_minute BETWEEN 1 AND 1000);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_api_keys_previous_hash ON workspace_api_keys(previous_token_hash) WHERE previous_token_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS workspace_api_requests (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL REFERENCES workspace_api_keys(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  session_id TEXT REFERENCES automation_sessions(id) ON DELETE SET NULL,
  job_id TEXT REFERENCES automation_jobs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id,id)
);
ALTER TABLE workspace_api_requests ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT 'workflow.execute';
ALTER TABLE workspace_api_requests ADD COLUMN IF NOT EXISTS resource_id TEXT;
ALTER TABLE workspace_api_requests ADD COLUMN IF NOT EXISTS response_status INTEGER;
ALTER TABLE workspace_api_requests ADD COLUMN IF NOT EXISTS response_body JSONB;
ALTER TABLE workspace_api_requests ADD COLUMN IF NOT EXISTS request_payload JSONB;
ALTER TABLE workspace_api_requests ADD COLUMN IF NOT EXISTS dispatch_status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE workspace_api_requests ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE workspace_api_requests ADD COLUMN IF NOT EXISTS error_code TEXT;
ALTER TABLE workspace_api_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE workspace_api_requests ADD COLUMN IF NOT EXISTS lease_token TEXT;
ALTER TABLE workspace_api_requests DROP CONSTRAINT IF EXISTS workspace_api_requests_dispatch_status_check;
ALTER TABLE workspace_api_requests ADD CONSTRAINT workspace_api_requests_dispatch_status_check CHECK (dispatch_status IN ('reserved','sending','provider_accepted','completed','failed','unconfirmed'));
CREATE TABLE IF NOT EXISTS workspace_webhooks (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  event_types JSONB NOT NULL,
  signing_secret_encrypted TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE workspace_webhooks ADD COLUMN IF NOT EXISTS previous_signing_secret_encrypted TEXT;
ALTER TABLE workspace_webhooks ADD COLUMN IF NOT EXISTS previous_secret_valid_until TIMESTAMPTZ;
ALTER TABLE workspace_webhooks ADD COLUMN IF NOT EXISTS schema_version TEXT NOT NULL DEFAULT '2026-10-01';
ALTER TABLE workspace_webhooks ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 8;
ALTER TABLE workspace_webhooks ADD COLUMN IF NOT EXISTS initial_backoff_seconds INTEGER NOT NULL DEFAULT 30;
ALTER TABLE workspace_webhooks ADD COLUMN IF NOT EXISTS secret_rotated_at TIMESTAMPTZ;
ALTER TABLE workspace_webhooks DROP CONSTRAINT IF EXISTS workspace_webhooks_max_attempts_check;
ALTER TABLE workspace_webhooks ADD CONSTRAINT workspace_webhooks_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 20);
ALTER TABLE workspace_webhooks DROP CONSTRAINT IF EXISTS workspace_webhooks_backoff_check;
ALTER TABLE workspace_webhooks ADD CONSTRAINT workspace_webhooks_backoff_check CHECK (initial_backoff_seconds BETWEEN 5 AND 3600);
CREATE TABLE IF NOT EXISTS workspace_webhook_deliveries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  webhook_id TEXT NOT NULL REFERENCES workspace_webhooks(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','delivered','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  error_code TEXT NOT NULL DEFAULT '',
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  UNIQUE (webhook_id,event_id)
);
ALTER TABLE workspace_webhook_deliveries DROP CONSTRAINT IF EXISTS workspace_webhook_deliveries_status_check;
ALTER TABLE workspace_webhook_deliveries ADD CONSTRAINT workspace_webhook_deliveries_status_check CHECK (status IN ('queued','processing','delivered','failed','dead_letter'));
ALTER TABLE workspace_webhook_deliveries ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE workspace_webhook_deliveries ADD COLUMN IF NOT EXISTS replay_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_workspace_hooks_due ON workspace_webhook_deliveries(status,run_at);
CREATE OR REPLACE FUNCTION enqueue_workspace_event_webhooks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO workspace_webhook_deliveries (id,business_id,webhook_id,event_id,payload)
  SELECT h.id||':'||NEW.id,NEW.business_id,h.id,NEW.id,
    jsonb_build_object('schemaVersion',h.schema_version,'id',NEW.id,'type',NEW.type,'eventType',NEW.type,
      'workspaceId',NEW.business_id,'contactId',NEW.contact_id,'occurredAt',NEW.at,
      'data',COALESCE(NEW.metadata,'{}'::jsonb))
  FROM workspace_webhooks h WHERE h.business_id=NEW.business_id AND h.enabled AND h.event_types ? NEW.type
  ON CONFLICT (webhook_id,event_id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_event_webhooks ON events;
CREATE TRIGGER workspace_event_webhooks AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION enqueue_workspace_event_webhooks();
CREATE OR REPLACE FUNCTION record_workspace_order_events() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_type TEXT;
BEGIN
  IF TG_OP='INSERT' THEN event_type:='whatsapp_order_received';
  ELSIF NEW.payment_status='captured' AND OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN event_type:='whatsapp_payment_captured';
  ELSIF OLD.fulfillment_status IS DISTINCT FROM NEW.fulfillment_status THEN event_type:='whatsapp_order_fulfillment';
  ELSE RETURN NEW;
  END IF;
  INSERT INTO events (id,business_id,type,metadata)
  VALUES ('order_event_'||md5(NEW.id||clock_timestamp()::text||random()::text),NEW.business_id,event_type,
    jsonb_build_object('orderId',NEW.id,'status',CASE WHEN event_type='whatsapp_order_fulfillment' THEN NEW.fulfillment_status ELSE NEW.payment_status END));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_order_events ON whatsapp_orders;
CREATE TRIGGER workspace_order_events AFTER INSERT OR UPDATE ON whatsapp_orders FOR EACH ROW EXECUTE FUNCTION record_workspace_order_events();
CREATE OR REPLACE FUNCTION record_workspace_message_events() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workspace_id TEXT; contact_id TEXT; campaign_id TEXT;
BEGIN
  IF NEW.direction<>'incoming' AND NEW.campaign_recipient_id IS NULL THEN RETURN NEW; END IF;
  SELECT cv.business_id,cv.contact_id INTO workspace_id,contact_id FROM conversations cv WHERE cv.id=NEW.conversation_id;
  SELECT cr.campaign_id INTO campaign_id FROM campaign_recipients cr WHERE cr.id=NEW.campaign_recipient_id;
  INSERT INTO events (id,business_id,type,contact_id,metadata)
  VALUES ('message_event_'||NEW.id,workspace_id,CASE WHEN NEW.direction='incoming' THEN 'incoming_message' ELSE 'campaign_sent' END,contact_id,
    jsonb_build_object('messageId',NEW.id,'campaignId',campaign_id));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_message_events ON messages;
CREATE TRIGGER workspace_message_events AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION record_workspace_message_events();
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['workspace_api_keys','workspace_api_requests','workspace_webhooks','workspace_webhook_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',t);
  END LOOP;
END $$;
