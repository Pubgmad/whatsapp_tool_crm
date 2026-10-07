ALTER TABLE templates ADD COLUMN IF NOT EXISTS waba_id TEXT NOT NULL DEFAULT '';
UPDATE templates t SET waba_id=b.waba_id
FROM businesses b WHERE t.business_id=b.id AND t.waba_id='' AND t.meta_template_id<>'' AND b.waba_id<>'';
ALTER TABLE templates DROP CONSTRAINT IF EXISTS templates_business_id_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_waba_name_language ON templates(business_id,waba_id,name,language);
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_meta_identity ON templates(business_id,waba_id,meta_template_name,language) WHERE meta_template_name<>'';
CREATE INDEX IF NOT EXISTS idx_templates_waba_status ON templates(business_id,waba_id,status,created_at DESC);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_campaigns_phone ON campaigns(business_id,whatsapp_phone_number_id) WHERE whatsapp_phone_number_id<>'';
