ALTER TABLE whatsapp_calls ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ;
ALTER TABLE whatsapp_calls ADD COLUMN IF NOT EXISTS followup_status TEXT NOT NULL DEFAULT 'none' CHECK (followup_status IN ('none','open','resolved'));
ALTER TABLE whatsapp_calls ADD COLUMN IF NOT EXISTS followup_note TEXT NOT NULL DEFAULT '';
ALTER TABLE whatsapp_calls ADD COLUMN IF NOT EXISTS followup_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE whatsapp_calls ADD COLUMN IF NOT EXISTS followup_updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_whatsapp_call_followups ON whatsapp_calls(business_id,created_at DESC) WHERE followup_status='open';
