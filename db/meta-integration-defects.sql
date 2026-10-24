-- Meta integration defect remediation (additive).

ALTER TABLE meta_leadgen_submissions ADD COLUMN IF NOT EXISTS meta_user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE meta_leadgen_submissions ADD COLUMN IF NOT EXISTS principal_kind TEXT NOT NULL DEFAULT 'meta_user';
ALTER TABLE meta_leadgen_submissions ADD COLUMN IF NOT EXISTS ingested_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_meta_leadgen_submissions_meta_user
  ON meta_leadgen_submissions(business_id, meta_user_id);

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS meta_lead_lineage JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS meta_lead_only BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE meta_authorizations ADD COLUMN IF NOT EXISTS authorization_seq BIGINT NOT NULL DEFAULT 1;

ALTER TABLE meta_data_deletion_requests ADD COLUMN IF NOT EXISTS cycle_key TEXT NOT NULL DEFAULT '';
ALTER TABLE meta_data_deletion_requests ADD COLUMN IF NOT EXISTS scope_max_authorization_seq JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE meta_data_deletion_requests ADD COLUMN IF NOT EXISTS supersedes_request_id TEXT;
ALTER TABLE meta_data_deletion_requests ADD COLUMN IF NOT EXISTS data_cutoff_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_meta_data_deletion_requests_user_hash
  ON meta_data_deletion_requests(meta_user_id_hash, requested_at DESC);

ALTER TABLE ads_oauth_attempts ADD COLUMN IF NOT EXISTS login_session_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ads_oauth_pending ADD COLUMN IF NOT EXISTS login_session_id TEXT NOT NULL DEFAULT '';

ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS last_error_code TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS last_http_status INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS last_meta_error_subcode TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS delivery_state TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE campaign_jobs ADD COLUMN IF NOT EXISTS last_error_code TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign_jobs ADD COLUMN IF NOT EXISTS last_http_status INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaign_jobs ADD COLUMN IF NOT EXISTS last_meta_error_subcode TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS meta_remote_cleanup_jobs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  integration TEXT NOT NULL DEFAULT 'whatsapp',
  waba_id TEXT NOT NULL DEFAULT '',
  access_token_encrypted TEXT NOT NULL DEFAULT '',
  authorization_seq_at_disconnect BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meta_remote_cleanup_status_check CHECK (status IN ('pending', 'completed', 'retryable_failure', 'cannot_complete'))
);
CREATE INDEX IF NOT EXISTS idx_meta_remote_cleanup_pending
  ON meta_remote_cleanup_jobs(status, expires_at)
  WHERE status IN ('pending', 'retryable_failure');

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['meta_remote_cleanup_jobs'] LOOP
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
  GRANT SELECT, INSERT, UPDATE, DELETE ON meta_remote_cleanup_jobs TO CURRENT_USER;
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
