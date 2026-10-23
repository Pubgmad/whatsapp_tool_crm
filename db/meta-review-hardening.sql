-- Meta review hardening: single-use ads OAuth attempts, authorization linkage, deletion workflow.
-- Additive. Does not delete customer rows.

CREATE TABLE IF NOT EXISTS ads_oauth_attempts (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 0,
  requested_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  redirect_uri TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ads_oauth_attempts_status_check CHECK (status IN ('pending', 'claimed', 'consumed', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_ads_oauth_attempts_business ON ads_oauth_attempts(business_id, created_at DESC);

ALTER TABLE ads_oauth_pending ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ads_oauth_pending ADD COLUMN IF NOT EXISTS requested_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ads_oauth_pending ADD COLUMN IF NOT EXISTS attempt_id TEXT NOT NULL DEFAULT '';

ALTER TABLE whatsapp_ads_connections ADD COLUMN IF NOT EXISTS authorization_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE meta_authorizations ADD COLUMN IF NOT EXISTS integration TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE meta_authorizations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE meta_authorizations ADD COLUMN IF NOT EXISTS principal_kind TEXT NOT NULL DEFAULT 'meta_user';
ALTER TABLE meta_authorizations ADD COLUMN IF NOT EXISTS assets JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE meta_authorizations ADD COLUMN IF NOT EXISTS meta_user_id_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE meta_authorizations ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE meta_authorizations ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE meta_authorizations DROP CONSTRAINT IF EXISTS meta_authorizations_business_id_meta_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS meta_authorizations_business_user_integration
  ON meta_authorizations (business_id, meta_user_id, integration);

ALTER TABLE meta_data_deletion_requests DROP CONSTRAINT IF EXISTS meta_data_deletion_status_check;
ALTER TABLE meta_data_deletion_requests ADD CONSTRAINT meta_data_deletion_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed'));
ALTER TABLE meta_data_deletion_requests ADD COLUMN IF NOT EXISTS result_code TEXT NOT NULL DEFAULT '';
ALTER TABLE meta_data_deletion_requests ADD COLUMN IF NOT EXISTS work_log JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE meta_data_deletion_requests ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meta_data_deletion_requests ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['ads_oauth_attempts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',
      t
    );
  END LOOP;
END $$;

DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON ads_oauth_attempts TO CURRENT_USER;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ads_oauth_states TO CURRENT_USER;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ads_oauth_pending TO CURRENT_USER;
  GRANT SELECT, INSERT, UPDATE, DELETE ON meta_authorizations TO CURRENT_USER;
  GRANT SELECT, INSERT, UPDATE, DELETE ON meta_data_deletion_requests TO CURRENT_USER;
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
