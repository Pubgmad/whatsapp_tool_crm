CREATE TABLE IF NOT EXISTS tracked_link_definitions (
 id TEXT PRIMARY KEY,
 business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 destination TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 expires_days INTEGER NOT NULL CHECK(expires_days BETWEEN 1 AND 365),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(id,business_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS tracking_contact_tenant ON contacts(id,business_id);
CREATE UNIQUE INDEX IF NOT EXISTS tracking_recipient_contact ON campaign_recipients(id,contact_id);
CREATE TABLE IF NOT EXISTS tracked_link_tokens (
 id TEXT PRIMARY KEY,
 business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 definition_id TEXT NOT NULL,
 contact_id TEXT NOT NULL,
 campaign_recipient_id TEXT REFERENCES campaign_recipients(id) ON DELETE CASCADE,
 reference TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 token_encrypted TEXT NOT NULL,
 destination TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 confirmed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(definition_id,business_id) REFERENCES tracked_link_definitions(id,business_id) ON DELETE CASCADE,
 FOREIGN KEY(contact_id,business_id) REFERENCES contacts(id,business_id) ON DELETE CASCADE,
 FOREIGN KEY(campaign_recipient_id,contact_id) REFERENCES campaign_recipients(id,contact_id) ON DELETE CASCADE,
 UNIQUE(business_id,reference)
);
CREATE INDEX IF NOT EXISTS tracked_click_audience ON tracked_link_tokens(business_id,contact_id,campaign_recipient_id,confirmed_at) WHERE confirmed_at IS NOT NULL;
ALTER TABLE tracked_link_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_link_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE tracked_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_link_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tracked_link_definitions;
CREATE POLICY tenant_isolation ON tracked_link_definitions USING(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),'')) WITH CHECK(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
DROP POLICY IF EXISTS tenant_isolation ON tracked_link_tokens;
CREATE POLICY tenant_isolation ON tracked_link_tokens USING(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),'')) WITH CHECK(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
