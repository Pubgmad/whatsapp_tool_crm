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
 parameter_slot TEXT NOT NULL DEFAULT '',
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
ALTER TABLE tracked_link_tokens ADD COLUMN IF NOT EXISTS parameter_slot TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS tracked_click_audience ON tracked_link_tokens(business_id,contact_id,campaign_recipient_id,confirmed_at) WHERE confirmed_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS tracked_link_click_events (
 id TEXT PRIMARY KEY,
 business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 token_id TEXT NOT NULL,
 definition_id TEXT NOT NULL,
 contact_id TEXT NOT NULL,
 campaign_recipient_id TEXT,
 parameter_slot TEXT NOT NULL DEFAULT '',
 clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(token_id,business_id) REFERENCES tracked_link_tokens(id,business_id) ON DELETE CASCADE,
 FOREIGN KEY(definition_id,business_id) REFERENCES tracked_link_definitions(id,business_id) ON DELETE CASCADE,
 FOREIGN KEY(contact_id,business_id) REFERENCES contacts(id,business_id) ON DELETE CASCADE,
 FOREIGN KEY(campaign_recipient_id,contact_id) REFERENCES campaign_recipients(id,contact_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS tracked_click_events_definition_time ON tracked_link_click_events(business_id,definition_id,clicked_at DESC);
CREATE INDEX IF NOT EXISTS tracked_click_events_unique_contact ON tracked_link_click_events(business_id,definition_id,contact_id);
CREATE INDEX IF NOT EXISTS tracked_click_events_token_time ON tracked_link_click_events(token_id,clicked_at DESC);
ALTER TABLE tracked_link_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_link_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE tracked_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_link_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE tracked_link_click_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_link_click_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tracked_link_definitions;
CREATE POLICY tenant_isolation ON tracked_link_definitions USING(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),'')) WITH CHECK(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
DROP POLICY IF EXISTS tenant_isolation ON tracked_link_tokens;
CREATE POLICY tenant_isolation ON tracked_link_tokens USING(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),'')) WITH CHECK(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
DROP POLICY IF EXISTS tenant_isolation ON tracked_link_click_events;
DROP POLICY IF EXISTS tenant_click_events_select ON tracked_link_click_events;
CREATE POLICY tenant_click_events_select ON tracked_link_click_events FOR SELECT USING(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
DROP POLICY IF EXISTS tenant_click_events_insert ON tracked_link_click_events;
CREATE POLICY tenant_click_events_insert ON tracked_link_click_events FOR INSERT WITH CHECK(COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),''));
DROP POLICY IF EXISTS system_click_events_delete ON tracked_link_click_events;
CREATE POLICY system_click_events_delete ON tracked_link_click_events FOR DELETE USING(COALESCE(current_setting('app.system_access',true),'')='true');
