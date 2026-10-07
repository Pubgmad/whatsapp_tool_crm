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
