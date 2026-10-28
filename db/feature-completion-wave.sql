-- Feature completion wave: curated template library + TURN platform config support.
INSERT INTO platform_settings (id, key, label, category, value, value_type, is_public, display_order)
VALUES (
  'ps_feature_whatsapp_groups_enabled',
  'feature_whatsapp_groups_enabled',
  'WhatsApp Groups (Cloud API)',
  'feature_controls',
  'true'::jsonb,
  'boolean',
  FALSE,
  426
)
ON CONFLICT (key) DO UPDATE
SET value = 'true'::jsonb,
    label = EXCLUDED.label,
    category = EXCLUDED.category,
    updated_at = NOW();

INSERT INTO platform_settings (id, key, label, category, value, value_type, is_public, display_order)
VALUES (
  'ps_whatsapp_calling_turn',
  'whatsapp_calling_turn',
  'WhatsApp calling TURN relay (urls + encrypted secret)',
  'whatsapp_operations',
  '{"urls":[],"secretEncrypted":""}'::jsonb,
  'json',
  FALSE,
  476
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS template_library_items (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  language TEXT NOT NULL DEFAULT 'en_US',
  industry TEXT NOT NULL DEFAULT 'general',
  description TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  header_text TEXT NOT NULL DEFAULT '',
  footer_text TEXT NOT NULL DEFAULT '',
  component_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_template_library_active
  ON template_library_items (is_active, category, industry, sort_order, name);

CREATE TABLE IF NOT EXISTS template_library_uses (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  library_item_id TEXT NOT NULL REFERENCES template_library_items(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  submit_to_meta BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_template_library_uses_biz
  ON template_library_uses (business_id, created_at DESC);

ALTER TABLE template_library_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_library_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS template_library_read ON template_library_items;
CREATE POLICY template_library_read ON template_library_items
  FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS template_library_system_write ON template_library_items;
CREATE POLICY template_library_system_write ON template_library_items
  USING (COALESCE(current_setting('app.system_access', true), '') = 'true')
  WITH CHECK (COALESCE(current_setting('app.system_access', true), '') = 'true');

ALTER TABLE template_library_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_library_uses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS template_library_uses_tenant ON template_library_uses;
CREATE POLICY template_library_uses_tenant ON template_library_uses
  USING (
    COALESCE(current_setting('app.system_access', true), '') = 'true'
    OR business_id = COALESCE(current_setting('app.business_id', true), '')
  )
  WITH CHECK (
    COALESCE(current_setting('app.system_access', true), '') = 'true'
    OR business_id = COALESCE(current_setting('app.business_id', true), '')
  );

INSERT INTO template_library_items (id, slug, name, category, language, industry, description, body, header_text, footer_text, component_schema, tags, sort_order)
VALUES
  ('tl_welcome_offer', 'welcome_offer', 'Welcome offer', 'MARKETING', 'en_US', 'retail',
   'Greet new customers with a simple welcome discount.',
   'Hi {{1}}, welcome to {{2}}! Enjoy {{3}} off your first order with code {{4}}.',
   'Welcome', 'Reply STOP to opt out',
   '{"headerFormat":"TEXT","buttons":[{"type":"QUICK_REPLY","text":"Shop now"},{"type":"QUICK_REPLY","text":"Talk to us"}]}'::jsonb,
   ARRAY['welcome','offer','retail'], 10),
  ('tl_abandoned_cart', 'abandoned_cart', 'Abandoned cart reminder', 'MARKETING', 'en_US', 'ecommerce',
   'Remind shoppers about items left in cart.',
   'Hi {{1}}, you left {{2}} in your cart. Complete checkout before it sells out.',
   'Still interested?', 'Reply STOP to opt out',
   '{"headerFormat":"TEXT","buttons":[{"type":"URL","text":"Checkout","value":"https://example.com/cart"}]}'::jsonb,
   ARRAY['cart','ecommerce'], 20),
  ('tl_flash_sale', 'flash_sale', 'Flash sale alert', 'MARKETING', 'en_US', 'retail',
   'Announce a limited-time sale.',
   '⚡ {{1}} starts now — save up to {{2}} until {{3}}. Tap below to browse deals.',
   'Flash sale', 'Reply STOP to opt out',
   '{"headerFormat":"TEXT","buttons":[{"type":"QUICK_REPLY","text":"Show deals"}]}'::jsonb,
   ARRAY['sale','promo'], 30),
  ('tl_appointment_confirm', 'appointment_confirm', 'Appointment confirmation', 'UTILITY', 'en_US', 'services',
   'Confirm a booked appointment.',
   'Hi {{1}}, your appointment on {{2}} at {{3}} is confirmed. Location: {{4}}.',
   'Appointment confirmed', '',
   '{"headerFormat":"TEXT","buttons":[{"type":"QUICK_REPLY","text":"Reschedule"},{"type":"QUICK_REPLY","text":"Cancel"}]}'::jsonb,
   ARRAY['appointment','booking'], 40),
  ('tl_appointment_reminder', 'appointment_reminder', 'Appointment reminder', 'UTILITY', 'en_US', 'services',
   'Remind customers of an upcoming visit.',
   'Reminder: {{1}}, your appointment is tomorrow at {{2}}. Reply YES to confirm.',
   'Reminder', '',
   '{"headerFormat":"TEXT","buttons":[{"type":"QUICK_REPLY","text":"Yes"},{"type":"QUICK_REPLY","text":"Reschedule"}]}'::jsonb,
   ARRAY['reminder','booking'], 50),
  ('tl_order_shipped', 'order_shipped', 'Order shipped', 'UTILITY', 'en_US', 'ecommerce',
   'Notify that an order has shipped.',
   'Hi {{1}}, order {{2}} has shipped. Track it with {{3}}.',
   'Order update', '',
   '{"headerFormat":"TEXT","buttons":[{"type":"URL","text":"Track order","value":"https://example.com/track"}]}'::jsonb,
   ARRAY['shipping','orders'], 60),
  ('tl_order_delivered', 'order_delivered', 'Order delivered', 'UTILITY', 'en_US', 'ecommerce',
   'Confirm delivery and ask for feedback.',
   'Hi {{1}}, order {{2}} was delivered. How was your experience?',
   'Delivered', '',
   '{"headerFormat":"TEXT","buttons":[{"type":"QUICK_REPLY","text":"Great"},{"type":"QUICK_REPLY","text":"Need help"}]}'::jsonb,
   ARRAY['delivery','feedback'], 70),
  ('tl_payment_due', 'payment_due', 'Payment due reminder', 'UTILITY', 'en_US', 'finance',
   'Remind about an upcoming payment.',
   'Hi {{1}}, payment of {{2}} for invoice {{3}} is due on {{4}}.',
   'Payment reminder', '',
   '{"headerFormat":"TEXT","buttons":[{"type":"URL","text":"Pay now","value":"https://example.com/pay"}]}'::jsonb,
   ARRAY['payment','invoice'], 80),
  ('tl_support_followup', 'support_followup', 'Support follow-up', 'UTILITY', 'en_US', 'support',
   'Check whether an issue was resolved.',
   'Hi {{1}}, checking in on ticket {{2}}. Is everything resolved?',
   'Support check-in', '',
   '{"headerFormat":"TEXT","buttons":[{"type":"QUICK_REPLY","text":"Resolved"},{"type":"QUICK_REPLY","text":"Still need help"}]}'::jsonb,
   ARRAY['support','followup'], 90),
  ('tl_lead_nurture', 'lead_nurture', 'Lead nurture intro', 'MARKETING', 'en_US', 'saas',
   'Follow up after a demo or lead form.',
   'Hi {{1}}, thanks for your interest in {{2}}. Would you like a quick walkthrough this week?',
   'Quick question', 'Reply STOP to opt out',
   '{"headerFormat":"TEXT","buttons":[{"type":"QUICK_REPLY","text":"Book a time"},{"type":"QUICK_REPLY","text":"Send info"}]}'::jsonb,
   ARRAY['leads','saas'], 100),
  ('tl_event_invite', 'event_invite', 'Event invitation', 'MARKETING', 'en_US', 'events',
   'Invite contacts to an upcoming event.',
   'You''re invited, {{1}}! Join {{2}} on {{3}}. Seats are limited.',
   'You''re invited', 'Reply STOP to opt out',
   '{"headerFormat":"TEXT","buttons":[{"type":"QUICK_REPLY","text":"I''ll attend"},{"type":"URL","text":"Details","value":"https://example.com/event"}]}'::jsonb,
   ARRAY['event','invite'], 110),
  ('tl_feedback_request', 'feedback_request', 'Feedback request', 'MARKETING', 'en_US', 'general',
   'Ask for a short satisfaction rating.',
   'Hi {{1}}, how did we do? Reply with a score from 1–5.',
   'Quick feedback', 'Reply STOP to opt out',
   '{"headerFormat":"TEXT","buttons":[{"type":"QUICK_REPLY","text":"5"},{"type":"QUICK_REPLY","text":"4"},{"type":"QUICK_REPLY","text":"3"}]}'::jsonb,
   ARRAY['feedback','nps'], 120),
  ('tl_otp_copy_code', 'otp_copy_code', 'OTP verification (copy code)', 'AUTHENTICATION', 'en_US', 'security',
   'Standard authentication template with copy-code button.',
   'Your verification code',
   '', '',
   '{"headerFormat":"NONE","otpType":"COPY_CODE","otpButtonText":"Copy code","codeExpirationMinutes":10,"addSecurityRecommendation":true}'::jsonb,
   ARRAY['otp','auth'], 130),
  ('tl_reengagement', 'reengagement', 'Win-back message', 'MARKETING', 'en_US', 'retail',
   'Re-engage inactive customers.',
   'Hi {{1}}, we miss you at {{2}}. Here''s {{3}} off when you come back.',
   'We miss you', 'Reply STOP to opt out',
   '{"headerFormat":"TEXT","buttons":[{"type":"QUICK_REPLY","text":"Claim offer"}]}'::jsonb,
   ARRAY['winback','loyalty'], 140),
  ('tl_shipping_delay', 'shipping_delay', 'Shipping delay notice', 'UTILITY', 'en_US', 'ecommerce',
   'Proactively notify about a delay.',
   'Hi {{1}}, order {{2}} is delayed. New ETA: {{3}}. Sorry for the wait.',
   'Shipping update', '',
   '{"headerFormat":"TEXT","buttons":[{"type":"QUICK_REPLY","text":"Contact support"}]}'::jsonb,
   ARRAY['shipping','delay'], 150)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  language = EXCLUDED.language,
  industry = EXCLUDED.industry,
  description = EXCLUDED.description,
  body = EXCLUDED.body,
  header_text = EXCLUDED.header_text,
  footer_text = EXCLUDED.footer_text,
  component_schema = EXCLUDED.component_schema,
  tags = EXCLUDED.tags,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = NOW();
