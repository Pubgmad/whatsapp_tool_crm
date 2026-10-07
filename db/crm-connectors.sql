CREATE TABLE IF NOT EXISTS crm_connections (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('hubspot','salesforce')),
  external_account_id TEXT NOT NULL,
  instance_url TEXT NOT NULL DEFAULT '',
  access_encrypted TEXT NOT NULL,
  refresh_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  cursor TEXT NOT NULL DEFAULT '',
  last_sync_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  sync_claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id,business_id),
  UNIQUE(provider,external_account_id),
  UNIQUE(business_id,provider)
);
ALTER TABLE crm_connections ADD COLUMN IF NOT EXISTS instance_url TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_connections ADD COLUMN IF NOT EXISTS sync_leads_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE crm_connections ADD COLUMN IF NOT EXISTS lead_cursor TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_connections ADD COLUMN IF NOT EXISTS contact_watermark TIMESTAMPTZ;
ALTER TABLE crm_connections ADD COLUMN IF NOT EXISTS lead_watermark TIMESTAMPTZ;
ALTER TABLE crm_connections ADD COLUMN IF NOT EXISTS sync_objects_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE crm_connections DROP CONSTRAINT IF EXISTS crm_connections_provider_check;
ALTER TABLE crm_connections ADD CONSTRAINT crm_connections_provider_check CHECK(provider IN ('hubspot','salesforce'));
CREATE TABLE IF NOT EXISTS crm_oauth_states (
  state_hash TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_verifier_encrypted TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE crm_oauth_states ADD COLUMN IF NOT EXISTS code_verifier_encrypted TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS crm_oauth_expiry ON crm_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS crm_contact_links (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  phone_snapshot TEXT NOT NULL,
  external_updated_at TIMESTAMPTZ,
  local_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(connection_id,external_id),
  UNIQUE(connection_id,contact_id),
  FOREIGN KEY(connection_id,business_id) REFERENCES crm_connections(id,business_id) ON DELETE CASCADE,
  FOREIGN KEY(contact_id,business_id) REFERENCES contacts(id,business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS crm_contact_links_contact ON crm_contact_links(business_id,contact_id);
ALTER TABLE crm_contact_links ADD COLUMN IF NOT EXISTS external_object_type TEXT NOT NULL DEFAULT 'Contact';
ALTER TABLE crm_contact_links ADD COLUMN IF NOT EXISTS account_external_id TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_contact_links DROP CONSTRAINT IF EXISTS crm_contact_links_object_type_check;
ALTER TABLE crm_contact_links ADD CONSTRAINT crm_contact_links_object_type_check CHECK(external_object_type IN ('Contact','Lead'));
CREATE TABLE IF NOT EXISTS crm_object_records (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('company','deal')),
  external_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_updated_at TIMESTAMPTZ NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(connection_id,kind,external_id),
  UNIQUE(connection_id,business_id,kind,external_id),
  FOREIGN KEY(connection_id,business_id) REFERENCES crm_connections(id,business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS crm_object_records_business ON crm_object_records(business_id,connection_id,kind,updated_at DESC);
CREATE TABLE IF NOT EXISTS crm_object_contacts (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  PRIMARY KEY(connection_id,kind,external_id,contact_id),
  FOREIGN KEY(connection_id,business_id,kind,external_id) REFERENCES crm_object_records(connection_id,business_id,kind,external_id) ON DELETE CASCADE,
  FOREIGN KEY(contact_id,business_id) REFERENCES contacts(id,business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS crm_object_contacts_contact ON crm_object_contacts(business_id,contact_id);
CREATE TABLE IF NOT EXISTS crm_object_cursors (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('company','deal')),
  cursor TEXT NOT NULL DEFAULT '',
  archived_cursor TEXT NOT NULL DEFAULT '',
  watermark TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(connection_id,kind),
  FOREIGN KEY(connection_id,business_id) REFERENCES crm_connections(id,business_id) ON DELETE CASCADE
);
ALTER TABLE crm_object_cursors ADD COLUMN IF NOT EXISTS archived_cursor TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS crm_field_mappings (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('company','deal')),
  source_field TEXT NOT NULL,
  attribute_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(connection_id,kind,source_field),
  UNIQUE(connection_id,attribute_key),
  FOREIGN KEY(connection_id,business_id) REFERENCES crm_connections(id,business_id) ON DELETE CASCADE
);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['crm_connections','crm_oauth_states','crm_contact_links','crm_object_records','crm_object_contacts','crm_object_cursors','crm_field_mappings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',t);
  END LOOP;
END $$;
