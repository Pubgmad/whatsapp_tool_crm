CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  meta_group_id TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  participant_count INTEGER NOT NULL DEFAULT 0,
  invite_link TEXT NOT NULL DEFAULT '',
  sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced', 'stale', 'error')),
  last_error TEXT NOT NULL DEFAULT '',
  meta_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, meta_group_id)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_business ON whatsapp_groups(business_id, updated_at DESC);
ALTER TABLE whatsapp_groups ADD COLUMN IF NOT EXISTS unread_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE whatsapp_groups ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS whatsapp_group_messages (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
  body TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'text',
  status TEXT NOT NULL DEFAULT 'received',
  meta_message_id TEXT NOT NULL DEFAULT '',
  sender_ref TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_group_messages_group ON whatsapp_group_messages(business_id, group_id, at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_group_messages_meta ON whatsapp_group_messages(business_id, meta_message_id) WHERE meta_message_id <> '';
ALTER TABLE whatsapp_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_groups;
CREATE POLICY tenant_isolation ON whatsapp_groups USING (
  COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),'')
) WITH CHECK (
  COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),'')
);
ALTER TABLE whatsapp_group_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_group_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_group_messages;
CREATE POLICY tenant_isolation ON whatsapp_group_messages USING (
  COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),'')
) WITH CHECK (
  COALESCE(current_setting('app.system_access',true),'')='true' OR business_id=COALESCE(current_setting('app.business_id',true),'')
);

CREATE TABLE IF NOT EXISTS ai_safety_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id TEXT,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('prompt_injection', 'policy_blocked', 'rate_limited', 'eval_sample', 'autonomous_denied')),
  source TEXT NOT NULL DEFAULT 'inbound',
  detail TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_safety_events_business ON ai_safety_events(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_slo_certification_runs (
  id TEXT PRIMARY KEY,
  certified BOOLEAN NOT NULL DEFAULT FALSE,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_slo_runs_at ON platform_slo_certification_runs(created_at DESC);

ALTER TABLE whatsapp_ads_operations ADD COLUMN IF NOT EXISTS objective_kind TEXT NOT NULL DEFAULT 'MESSAGES';
