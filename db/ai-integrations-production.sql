ALTER TABLE ai_agent_settings ADD COLUMN IF NOT EXISTS action_autonomous_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_agent_settings ADD COLUMN IF NOT EXISTS dialogflow_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_agent_settings ADD COLUMN IF NOT EXISTS dialogflow_agent_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_agent_settings ADD COLUMN IF NOT EXISTS dialogflow_location TEXT NOT NULL DEFAULT 'global';
ALTER TABLE ai_agent_settings DROP CONSTRAINT IF EXISTS ai_agent_dialogflow_location_check;
ALTER TABLE ai_agent_settings ADD CONSTRAINT ai_agent_dialogflow_location_check CHECK (dialogflow_location ~ '^[a-z0-9-]+$' AND length(dialogflow_location) BETWEEN 2 AND 40);
