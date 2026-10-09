CREATE TABLE IF NOT EXISTS campaign_send_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  campaign_recipient_id TEXT NOT NULL,
  job_id TEXT,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('failure', 'rate_limited')),
  http_status INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  retryable BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS campaign_send_events_tenant_time ON campaign_send_events(business_id, created_at DESC);
ALTER TABLE campaign_send_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_send_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON campaign_send_events;
CREATE POLICY tenant_isolation ON campaign_send_events
  USING (COALESCE(current_setting('app.system_access', true), '') = 'true' OR business_id = COALESCE(current_setting('app.business_id', true), ''))
  WITH CHECK (COALESCE(current_setting('app.system_access', true), '') = 'true' OR business_id = COALESCE(current_setting('app.business_id', true), ''));

-- tracked_link_tokens is created in click-tracking.sql (runs later). Guard for fresh DBs.
DO $$ BEGIN
  IF to_regclass('public.tracked_link_tokens') IS NOT NULL THEN
    ALTER TABLE tracked_link_tokens ADD COLUMN IF NOT EXISTS parameter_slot TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS tracked_link_tokens_slot ON tracked_link_tokens(business_id, definition_id, parameter_slot) WHERE confirmed_at IS NOT NULL;
  END IF;
END $$;
