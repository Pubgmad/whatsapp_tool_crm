CREATE TABLE IF NOT EXISTS whatsapp_webviews (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 2000),
  button_label TEXT NOT NULL CHECK(length(button_label) BETWEEN 1 AND 50),
  prefilled_message TEXT NOT NULL CHECK(length(prefilled_message) BETWEEN 1 AND 512),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id,business_id),
  FOREIGN KEY(phone_id,business_id) REFERENCES whatsapp_phone_numbers(id,business_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS whatsapp_webviews_business ON whatsapp_webviews(business_id,created_at DESC,id);
ALTER TABLE whatsapp_webviews ADD COLUMN IF NOT EXISTS flow_id TEXT;
ALTER TABLE whatsapp_webviews ADD COLUMN IF NOT EXISTS expires_hours INTEGER NOT NULL DEFAULT 1;
ALTER TABLE whatsapp_webviews DROP CONSTRAINT IF EXISTS whatsapp_webviews_expiry_check;
ALTER TABLE whatsapp_webviews ADD CONSTRAINT whatsapp_webviews_expiry_check CHECK(expires_hours BETWEEN 1 AND 24);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='whatsapp_webviews_flow_tenant_fkey') THEN
    ALTER TABLE whatsapp_webviews ADD CONSTRAINT whatsapp_webviews_flow_tenant_fkey
      FOREIGN KEY(flow_id,business_id) REFERENCES whatsapp_native_flows(id,business_id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS whatsapp_webview_invites (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  webview_id TEXT NOT NULL,
  runtime_session_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','sent','unconfirmed','failed')),
  meta_message_id TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id,request_id),
  FOREIGN KEY(webview_id,business_id) REFERENCES whatsapp_webviews(id,business_id) ON DELETE CASCADE,
  FOREIGN KEY(runtime_session_id,business_id) REFERENCES flow_runtime_sessions(id,business_id) ON DELETE CASCADE,
  FOREIGN KEY(contact_id,business_id) REFERENCES contacts(id,business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS whatsapp_webview_invites_contact ON whatsapp_webview_invites(business_id,contact_id,created_at DESC);
ALTER TABLE whatsapp_webview_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_webview_invites FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_webview_invites;
CREATE POLICY tenant_isolation ON whatsapp_webview_invites USING (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),'')) WITH CHECK (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
ALTER TABLE whatsapp_webviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_webviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_webviews;
CREATE POLICY tenant_isolation ON whatsapp_webviews USING (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),'')) WITH CHECK (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
