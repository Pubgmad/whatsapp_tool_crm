CREATE TABLE IF NOT EXISTS whatsapp_entry_operations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update','delete')),
  code TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('processing','confirmed','failed','unconfirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (phone_id,business_id) REFERENCES whatsapp_phone_numbers(id,business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_entry_operations_pending ON whatsapp_entry_operations(business_id,phone_id,created_at DESC) WHERE status IN ('processing','unconfirmed');
ALTER TABLE whatsapp_entry_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_entry_operations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_entry_operations;
CREATE POLICY tenant_isolation ON whatsapp_entry_operations
  USING (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''))
  WITH CHECK (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
