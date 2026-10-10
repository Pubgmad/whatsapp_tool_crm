-- Core CRM consent, suppression, opt-in/out keywords, custom field defs, click bot flags.

CREATE TABLE IF NOT EXISTS business_consent_settings (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  marketing_messaging_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  opt_out_keywords JSONB NOT NULL DEFAULT '["STOP","UNSUBSCRIBE","OPT OUT"]'::jsonb,
  opt_in_keywords JSONB NOT NULL DEFAULT '["START","SUBSCRIBE","YES"]'::jsonb,
  opt_out_auto_reply TEXT NOT NULL DEFAULT 'You have been unsubscribed from marketing WhatsApp messages. Reply START to opt back in.',
  opt_in_auto_reply TEXT NOT NULL DEFAULT 'You are subscribed to marketing WhatsApp messages. Reply STOP to opt out.',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_consent_opt_out_keywords_array CHECK (jsonb_typeof(opt_out_keywords) = 'array'),
  CONSTRAINT business_consent_opt_in_keywords_array CHECK (jsonb_typeof(opt_in_keywords) = 'array')
);

CREATE TABLE IF NOT EXISTS contact_suppressions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  reason TEXT NOT NULL DEFAULT 'opt_out',
  source TEXT NOT NULL DEFAULT 'keyword',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  UNIQUE (business_id, contact_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_contact_suppressions_active
  ON contact_suppressions(business_id, active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_contact_suppressions_contact
  ON contact_suppressions(business_id, contact_id, active);

CREATE TABLE IF NOT EXISTS contact_custom_field_defs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, field_key),
  CONSTRAINT contact_custom_field_type_check CHECK (field_type IN ('text', 'number', 'boolean', 'date'))
);
CREATE INDEX IF NOT EXISTS idx_contact_custom_field_defs_business
  ON contact_custom_field_defs(business_id, label);

ALTER TABLE tracked_link_click_events ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tracked_link_click_events ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '';
ALTER TABLE tracked_link_click_events ADD COLUMN IF NOT EXISTS ip_hash TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS tracked_click_events_human
  ON tracked_link_click_events(business_id, definition_id, clicked_at DESC)
  WHERE is_bot = FALSE;

ALTER TABLE contact_consent_events ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'opt_in';
ALTER TABLE contact_consent_events ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';
CREATE INDEX IF NOT EXISTS idx_contact_consent_events_type
  ON contact_consent_events(business_id, contact_id, event_type, created_at DESC);
