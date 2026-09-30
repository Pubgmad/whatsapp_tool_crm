CREATE TABLE IF NOT EXISTS whatsapp_website_widgets (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK(char_length(label) BETWEEN 1 AND 40),
  prefilled_message TEXT NOT NULL DEFAULT '',
  allowed_origins JSONB NOT NULL,
  color TEXT NOT NULL,
  position TEXT NOT NULL CHECK(position IN ('left','right')),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(phone_id,business_id) REFERENCES whatsapp_phone_numbers(id,business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_widgets_business ON whatsapp_website_widgets(business_id,phone_id,created_at DESC);
ALTER TABLE whatsapp_website_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_website_widgets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_website_widgets;
CREATE POLICY tenant_isolation ON whatsapp_website_widgets USING(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),'')) WITH CHECK(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
