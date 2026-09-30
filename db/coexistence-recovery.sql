ALTER TABLE whatsapp_coexistence_sync ADD COLUMN IF NOT EXISTS contacts_claimed_at TIMESTAMPTZ;
ALTER TABLE whatsapp_coexistence_sync ADD COLUMN IF NOT EXISTS history_claimed_at TIMESTAMPTZ;
ALTER TABLE whatsapp_coexistence_sync ADD COLUMN IF NOT EXISTS onboarding_at TIMESTAMPTZ;
