CREATE TABLE IF NOT EXISTS whatsapp_flow_designs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  design JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_flow_designs_tenant ON whatsapp_flow_designs(business_id,updated_at DESC);
ALTER TABLE whatsapp_flow_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_flow_designs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_flow_designs;
CREATE POLICY tenant_isolation ON whatsapp_flow_designs
  USING (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''))
  WITH CHECK (COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
