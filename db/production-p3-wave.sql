-- Campaign drip / journey sequences (multi-step broadcasts)
CREATE TABLE IF NOT EXISTS campaign_drip_sequences (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  audience_segment_id TEXT REFERENCES audience_segments(id) ON DELETE SET NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaign_drip_sequences_business ON campaign_drip_sequences(business_id, status);

CREATE TABLE IF NOT EXISTS campaign_drip_steps (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES campaign_drip_sequences(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL CHECK (step_order >= 0 AND step_order < 50),
  offset_minutes INTEGER NOT NULL CHECK (offset_minutes >= 0 AND offset_minutes <= 525600),
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE RESTRICT,
  variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (sequence_id, step_order)
);
CREATE INDEX IF NOT EXISTS idx_campaign_drip_steps_sequence ON campaign_drip_steps(sequence_id, step_order);

CREATE TABLE IF NOT EXISTS campaign_drip_enrollments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sequence_id TEXT NOT NULL REFERENCES campaign_drip_sequences(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  current_step INTEGER NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled','failed')),
  last_campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, sequence_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_drip_enrollments_due ON campaign_drip_enrollments(business_id, status, next_run_at);

CREATE TABLE IF NOT EXISTS ad_optimization_suggestions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  operation_id TEXT,
  suggestion_kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','dismissed','applied_read_only')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_optimization_suggestions_business ON ad_optimization_suggestions(business_id, status, created_at DESC);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel_kind TEXT NOT NULL DEFAULT 'direct';
CREATE INDEX IF NOT EXISTS idx_conversations_business_channel ON conversations(business_id, channel_kind, updated_at DESC);
