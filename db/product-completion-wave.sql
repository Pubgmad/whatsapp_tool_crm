ALTER TABLE crm_connections ADD COLUMN IF NOT EXISTS sync_outbound_create_objects_enabled BOOLEAN NOT NULL DEFAULT FALSE;
