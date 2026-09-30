CREATE TABLE IF NOT EXISTS support_policies (
 business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
 config JSONB NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE support_policies ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS support_conversation_tenant ON conversations(id,business_id);
CREATE TABLE IF NOT EXISTS support_waiting (
 conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
 business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 waiting_since TIMESTAMPTZ,
 responded_at TIMESTAMPTZ,
 breached_at TIMESTAMPTZ,
 FOREIGN KEY(conversation_id,business_id) REFERENCES conversations(id,business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS support_waiting_due ON support_waiting(business_id,waiting_since) WHERE waiting_since IS NOT NULL;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS support_assigned_at TIMESTAMPTZ;
ALTER TABLE support_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE support_waiting ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_waiting FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON support_policies;
CREATE POLICY tenant_isolation ON support_policies USING(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),'')) WITH CHECK(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
DROP POLICY IF EXISTS tenant_isolation ON support_waiting;
CREATE POLICY tenant_isolation ON support_waiting USING(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),'')) WITH CHECK(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
