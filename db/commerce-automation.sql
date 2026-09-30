CREATE TABLE IF NOT EXISTS commerce_automation_rules (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  flow_id TEXT NOT NULL REFERENCES automation_flows(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('whatsapp_order_received','whatsapp_order_fulfillment','whatsapp_payment_captured')),
  fulfillment_status TEXT NOT NULL DEFAULT '',
  unpaid_only BOOLEAN NOT NULL DEFAULT FALSE,
  delay_minutes INTEGER NOT NULL CHECK (delay_minutes BETWEEN 0 AND 43200),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id,business_id)
);
CREATE TABLE IF NOT EXISTS commerce_automation_tasks (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','started','skipped','failed')),
  error_code TEXT NOT NULL DEFAULT '',
  session_id TEXT REFERENCES automation_sessions(id) ON DELETE SET NULL,
  run_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(rule_id,event_id),
  FOREIGN KEY (rule_id,business_id) REFERENCES commerce_automation_rules(id,business_id) ON DELETE CASCADE,
  FOREIGN KEY (order_id,business_id) REFERENCES whatsapp_orders(id,business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commerce_automation_due ON commerce_automation_tasks(status,run_at);
CREATE OR REPLACE FUNCTION enqueue_commerce_automation_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type NOT IN ('whatsapp_order_received','whatsapp_order_fulfillment','whatsapp_payment_captured') THEN RETURN NEW; END IF;
  INSERT INTO commerce_automation_tasks (id,business_id,rule_id,order_id,event_id,run_at)
  SELECT r.id||':'||NEW.id,NEW.business_id,r.id,NEW.metadata->>'orderId',NEW.id,NOW()+(r.delay_minutes*INTERVAL '1 minute')
  FROM commerce_automation_rules r WHERE r.business_id=NEW.business_id AND r.enabled AND r.event_type=NEW.type
    AND (r.fulfillment_status='' OR r.fulfillment_status=NEW.metadata->>'status')
  ON CONFLICT (rule_id,event_id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS commerce_automation_events ON events;
CREATE TRIGGER commerce_automation_events AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION enqueue_commerce_automation_event();
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['commerce_automation_rules','commerce_automation_tasks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',t);
  END LOOP;
END $$;
