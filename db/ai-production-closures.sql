-- AI production closures: FTS index, knowledge chunks, named agents, expanded actions

CREATE INDEX IF NOT EXISTS idx_ai_agent_knowledge_fts
  ON ai_agent_knowledge
  USING GIN (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,'')));

ALTER TABLE ai_action_proposals DROP CONSTRAINT IF EXISTS ai_action_proposals_action_type_check;
ALTER TABLE ai_action_proposals ADD CONSTRAINT ai_action_proposals_action_type_check
  CHECK (action_type IN (
    'set_contact_attribute','set_order_status','send_booking_flow',
    'add_contact_tag','assign_conversation'
  ));

CREATE TABLE IF NOT EXISTS ai_agents (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  language_code TEXT NOT NULL DEFAULT 'en',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_agents_default
  ON ai_agents(business_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_ai_agents_business ON ai_agents(business_id, updated_at DESC);

ALTER TABLE ai_agent_settings ADD COLUMN IF NOT EXISTS active_agent_id TEXT;
DO $$ BEGIN
  ALTER TABLE ai_agent_settings
    ADD CONSTRAINT ai_agent_settings_active_agent_fk
    FOREIGN KEY (active_agent_id) REFERENCES ai_agents(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE ai_agent_knowledge ADD COLUMN IF NOT EXISTS agent_id TEXT REFERENCES ai_agents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ai_agent_knowledge_agent ON ai_agent_knowledge(business_id, agent_id)
  WHERE agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  knowledge_id TEXT NOT NULL REFERENCES ai_agent_knowledge(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (knowledge_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_fts
  ON ai_knowledge_chunks
  USING GIN (to_tsvector('simple', content));
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_business
  ON ai_knowledge_chunks(business_id, knowledge_id);

CREATE TABLE IF NOT EXISTS ai_agent_test_runs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES ai_agents(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL,
  reply TEXT NOT NULL DEFAULT '',
  handoff BOOLEAN NOT NULL DEFAULT FALSE,
  source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider TEXT NOT NULL DEFAULT 'openai',
  status TEXT NOT NULL CHECK (status IN ('completed','failed','no_source')),
  error_code TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_agent_test_runs_business
  ON ai_agent_test_runs(business_id, created_at DESC);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['ai_agents','ai_knowledge_chunks','ai_agent_test_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),'''')) WITH CHECK (COALESCE(current_setting(''app.system_access'',true),'''')=''true'' OR business_id=COALESCE(current_setting(''app.business_id'',true),''''))',
      t
    );
  END LOOP;
END $$;
