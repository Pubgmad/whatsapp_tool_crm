CREATE TABLE IF NOT EXISTS meta_credit_operations (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES businesses(id) ON DELETE SET NULL,
  waba_id TEXT NOT NULL UNIQUE,
  credit_line_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing','attached','rejected','unconfirmed')),
  allocation_id TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  requested_by TEXT REFERENCES super_admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE meta_credit_operations ALTER COLUMN business_id DROP NOT NULL;
ALTER TABLE meta_credit_operations ADD COLUMN IF NOT EXISTS reconciliation JSONB NOT NULL DEFAULT '{}';
ALTER TABLE meta_credit_operations ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;
ALTER TABLE meta_credit_operations DROP CONSTRAINT IF EXISTS meta_credit_operations_business_id_fkey;
ALTER TABLE meta_credit_operations ADD CONSTRAINT meta_credit_operations_business_id_fkey
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL;
ALTER TABLE meta_credit_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_credit_operations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_only ON meta_credit_operations;
CREATE POLICY platform_only ON meta_credit_operations
  USING (COALESCE(current_setting('app.system_access',true),'')='true')
  WITH CHECK (COALESCE(current_setting('app.system_access',true),'')='true');
