-- Widget interaction analytics + coexistence completion helpers

CREATE TABLE IF NOT EXISTS whatsapp_widget_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  widget_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('impression','click')),
  origin TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_widget_events_business
  ON whatsapp_widget_events(business_id, widget_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_widget_events_kind
  ON whatsapp_widget_events(business_id, event_kind, created_at DESC);

DO $$ BEGIN
  ALTER TABLE whatsapp_widget_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE whatsapp_widget_events FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON whatsapp_widget_events;
  CREATE POLICY tenant_isolation ON whatsapp_widget_events
    USING (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''))
    WITH CHECK (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
