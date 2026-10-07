ALTER TABLE crm_connections ADD COLUMN IF NOT EXISTS sync_outbound_create_objects_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE flow_screen_events DROP CONSTRAINT IF EXISTS flow_screen_events_event_kind_check;
ALTER TABLE flow_screen_events ADD CONSTRAINT flow_screen_events_event_kind_check
  CHECK (event_kind IN ('view', 'complete', 'abandon'));
