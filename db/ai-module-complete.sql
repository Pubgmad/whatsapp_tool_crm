-- AI module completion: embeddings, agent lifecycle, action modes, knowledge sync metadata

ALTER TABLE ai_knowledge_chunks ADD COLUMN IF NOT EXISTS embedding JSONB;
ALTER TABLE ai_knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE ai_agents DROP CONSTRAINT IF EXISTS ai_agents_status_check;
ALTER TABLE ai_agents ADD CONSTRAINT ai_agents_status_check
  CHECK (status IN ('active','paused','archived'));
UPDATE ai_agents SET status = CASE WHEN enabled THEN 'active' ELSE 'paused' END
  WHERE status = 'active' AND enabled = FALSE;

ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS ai_agent_revisions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, version)
);
CREATE INDEX IF NOT EXISTS idx_ai_agent_revisions_business
  ON ai_agent_revisions(business_id, agent_id, created_at DESC);

ALTER TABLE ai_agent_settings ADD COLUMN IF NOT EXISTS action_allowed_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE ai_agent_settings ADD COLUMN IF NOT EXISTS action_modes JSONB NOT NULL DEFAULT '{
  "set_contact_attribute":"propose",
  "set_order_status":"propose",
  "send_booking_flow":"propose",
  "add_contact_tag":"propose",
  "assign_conversation":"propose"
}'::jsonb;
ALTER TABLE ai_agent_settings ADD COLUMN IF NOT EXISTS embedding_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE ai_agent_settings ADD COLUMN IF NOT EXISTS retrieval_limit INTEGER NOT NULL DEFAULT 5;
ALTER TABLE ai_agent_settings DROP CONSTRAINT IF EXISTS ai_agent_retrieval_limit_check;
ALTER TABLE ai_agent_settings ADD CONSTRAINT ai_agent_retrieval_limit_check
  CHECK (retrieval_limit BETWEEN 1 AND 20);

ALTER TABLE ai_agent_knowledge ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE ai_agent_knowledge DROP CONSTRAINT IF EXISTS ai_agent_knowledge_sync_status_check;
ALTER TABLE ai_agent_knowledge ADD CONSTRAINT ai_agent_knowledge_sync_status_check
  CHECK (sync_status IN ('idle','syncing','synced','failed'));
ALTER TABLE ai_agent_knowledge ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE ai_agent_knowledge ADD COLUMN IF NOT EXISTS sync_error TEXT NOT NULL DEFAULT '';

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['ai_agent_revisions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',
      t
    );
  END LOOP;
END $$;
