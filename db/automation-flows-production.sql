-- Automation / Flows / Webviews production hardening (regex, idempotency, snapshots, forms, resume).

ALTER TABLE automation_flows DROP CONSTRAINT IF EXISTS automation_flows_trigger_check;
ALTER TABLE automation_flows
  ADD CONSTRAINT automation_flows_trigger_check
  CHECK (trigger_mode IN ('keywords', 'regex', 'any_inbound', 'manual'));
CREATE UNIQUE INDEX IF NOT EXISTS automation_flows_id_business ON automation_flows(id, business_id);

ALTER TABLE automation_sessions ADD COLUMN IF NOT EXISTS definition_snapshot JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_jobs_inbound_idempotent
  ON automation_jobs(business_id, incoming_message_id)
  WHERE COALESCE(incoming_message_id, '') <> '';

ALTER TABLE whatsapp_flow_invites ADD COLUMN IF NOT EXISTS automation_session_id TEXT;
ALTER TABLE whatsapp_flow_invites ADD COLUMN IF NOT EXISTS resume_node_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_flow_invites_automation_session
  ON whatsapp_flow_invites(business_id, automation_session_id)
  WHERE automation_session_id IS NOT NULL;

ALTER TABLE whatsapp_webviews ADD COLUMN IF NOT EXISTS form_schema JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE whatsapp_webviews ADD COLUMN IF NOT EXISTS success_message TEXT NOT NULL DEFAULT 'Thanks — we received your details.';
ALTER TABLE whatsapp_webviews ADD COLUMN IF NOT EXISTS automation_flow_id TEXT;
ALTER TABLE whatsapp_webviews ADD COLUMN IF NOT EXISTS page_mode TEXT NOT NULL DEFAULT 'cta';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='whatsapp_webviews_page_mode_check') THEN
    ALTER TABLE whatsapp_webviews ADD CONSTRAINT whatsapp_webviews_page_mode_check
      CHECK (page_mode IN ('cta', 'form', 'transactional'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='whatsapp_webviews_automation_flow_fkey') THEN
    ALTER TABLE whatsapp_webviews ADD CONSTRAINT whatsapp_webviews_automation_flow_fkey
      FOREIGN KEY (automation_flow_id, business_id) REFERENCES automation_flows(id, business_id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS whatsapp_webview_submissions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  webview_id TEXT NOT NULL,
  contact_id TEXT,
  fingerprint TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  automation_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, webview_id, fingerprint),
  FOREIGN KEY (webview_id, business_id) REFERENCES whatsapp_webviews(id, business_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, business_id) REFERENCES contacts(id, business_id) ON DELETE SET NULL,
  CONSTRAINT whatsapp_webview_submissions_status_check CHECK (status IN ('received', 'queued', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_webview_submissions_view
  ON whatsapp_webview_submissions(business_id, webview_id, created_at DESC);
ALTER TABLE whatsapp_webview_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_webview_submissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_webview_submissions;
CREATE POLICY tenant_isolation ON whatsapp_webview_submissions
  USING (COALESCE(current_setting('app.system_access', true), '') = 'true'
    OR business_id = COALESCE(current_setting('app.business_id', true), ''))
  WITH CHECK (COALESCE(current_setting('app.system_access', true), '') = 'true'
    OR business_id = COALESCE(current_setting('app.business_id', true), ''));
