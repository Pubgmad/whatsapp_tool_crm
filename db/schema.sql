CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS super_admins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Super Admin',
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id TEXT PRIMARY KEY,
  super_admin_id TEXT REFERENCES super_admins(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  whatsapp_number TEXT DEFAULT '',
  waba_id TEXT DEFAULT '',
  phone_number_id TEXT DEFAULT '',
  access_token_encrypted TEXT DEFAULT '',
  webhook_url TEXT DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'Live Meta',
  status TEXT NOT NULL DEFAULT 'Needs setup',
  account_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT businesses_mode_check CHECK (mode IN ('Live Meta')),
  CONSTRAINT businesses_status_check CHECK (status IN ('Needs setup', 'Connected')),
  CONSTRAINT businesses_account_status_check CHECK (account_status IN ('pending', 'active', 'suspended'))
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  billing_interval TEXT NOT NULL DEFAULT 'monthly',
  price_cents INTEGER NOT NULL DEFAULT 0,
  monthly_price_cents INTEGER NOT NULL DEFAULT 0,
  yearly_price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  trial_days INTEGER NOT NULL DEFAULT 0,
  contact_limit INTEGER,
  campaign_limit INTEGER,
  user_limit INTEGER,
  automation_flow_limit INTEGER,
  monthly_message_limit INTEGER,
  whatsapp_conversation_limit INTEGER,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  display_order INTEGER NOT NULL DEFAULT 0,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subscription_plans_interval_check CHECK (billing_interval IN ('monthly', 'yearly', 'trial', 'custom'))
);


CREATE TABLE IF NOT EXISTS platform_settings (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  value_type TEXT NOT NULL DEFAULT 'text',
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT platform_settings_type_check CHECK (value_type IN ('text', 'rich_text', 'image_url', 'json', 'boolean', 'number'))
);
CREATE TABLE IF NOT EXISTS business_subscriptions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  plan_id TEXT REFERENCES subscription_plans(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'trialing',
  payment_status TEXT NOT NULL DEFAULT 'none',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  renews_at TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  provider TEXT DEFAULT 'manual',
  provider_customer_id TEXT DEFAULT '',
  provider_subscription_id TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_subscriptions_status_check CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired', 'pending')),
  CONSTRAINT business_subscriptions_payment_check CHECK (payment_status IN ('none', 'pending', 'paid', 'failed', 'refunded'))
);

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  subscription_id TEXT REFERENCES business_subscriptions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  amount_cents INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'INR',
  provider TEXT DEFAULT 'manual',
  provider_event_id TEXT DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'Owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, business_id)
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  marketing_permission BOOLEAN NOT NULL DEFAULT FALSE,
  unsubscribed BOOLEAN NOT NULL DEFAULT FALSE,
  last_message_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'Manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, phone)
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Marketing',
  body TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'Draft',
  meta_template_id TEXT DEFAULT '',
  meta_template_name TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT 'Manual draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT templates_status_check CHECK (status IN ('Draft', 'Pending', 'Approved', 'Rejected')),
  UNIQUE(business_id, name)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE RESTRICT,
  automation_flow_id TEXT,
  variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  mode TEXT NOT NULL DEFAULT 'Live Meta',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  meta_message_id TEXT DEFAULT '',
  error_message TEXT DEFAULT '',
  sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(campaign_id, contact_id),
  CONSTRAINT campaign_recipients_status_check CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed'))
);

CREATE TABLE IF NOT EXISTS campaign_jobs (
  id TEXT PRIMARY KEY,
  campaign_recipient_id TEXT NOT NULL REFERENCES campaign_recipients(id) ON DELETE CASCADE UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT campaign_jobs_status_check CHECK (status IN ('queued', 'processing', 'retry', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS automation_flows (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  trigger_mode TEXT NOT NULL DEFAULT 'keywords',
  trigger_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  definition JSONB NOT NULL DEFAULT '{"startNodeId":"","nodes":[]}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT automation_flows_status_check CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  CONSTRAINT automation_flows_trigger_check CHECK (trigger_mode IN ('keywords', 'any_inbound', 'manual'))
);

CREATE TABLE IF NOT EXISTS automation_sessions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  flow_id TEXT NOT NULL REFERENCES automation_flows(id) ON DELETE CASCADE,
  current_node_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  human_takeover BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  last_input TEXT DEFAULT '',
  last_error TEXT DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  CONSTRAINT automation_sessions_status_check CHECK (status IN ('active', 'completed', 'handoff', 'failed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS automation_jobs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES automation_sessions(id) ON DELETE CASCADE,
  incoming_message_id TEXT DEFAULT '',
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT automation_jobs_status_check CHECK (status IN ('queued', 'processing', 'retry', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, contact_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  meta_message_id TEXT DEFAULT '',
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT messages_direction_check CHECK (direction IN ('incoming', 'outgoing'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_super_admins_email ON super_admins(email);
CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_at ON platform_audit_logs(at DESC);
CREATE INDEX IF NOT EXISTS idx_businesses_account_status ON businesses(account_status);
CREATE INDEX IF NOT EXISTS idx_platform_settings_public ON platform_settings(is_public, category, display_order);
CREATE INDEX IF NOT EXISTS idx_subscriptions_business ON business_subscriptions(business_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON business_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_billing_events_business_at ON billing_events(business_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_business ON contacts(business_id);
CREATE INDEX IF NOT EXISTS idx_templates_business ON templates(business_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_business_created ON campaigns(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_automation_flows_business ON automation_flows(business_id, status);
CREATE INDEX IF NOT EXISTS idx_automation_sessions_contact ON automation_sessions(business_id, contact_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_one_active_session ON automation_sessions(business_id, contact_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_automation_jobs_status ON automation_jobs(status, run_at);
CREATE INDEX IF NOT EXISTS idx_conversations_business ON conversations(business_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_at ON messages(conversation_id, at ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_meta_message_id ON messages(meta_message_id) WHERE meta_message_id <> '';
CREATE INDEX IF NOT EXISTS idx_events_business_at ON events(business_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_jobs_status ON campaign_jobs(status, run_at);
