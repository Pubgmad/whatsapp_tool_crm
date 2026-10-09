ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS source_id TEXT;

UPDATE campaigns c
SET source_kind = CASE
      WHEN c.retarget_source_campaign_id IS NOT NULL THEN 'retarget'
      WHEN c.recurring_parent_id IS NOT NULL THEN 'recurring_child'
      ELSE 'legacy'
    END,
    source_id = CASE
      WHEN c.retarget_source_campaign_id IS NOT NULL THEN c.retarget_source_campaign_id
      WHEN c.recurring_parent_id IS NOT NULL THEN c.recurring_parent_id
      ELSE NULL
    END
WHERE c.source_kind = 'unknown';

UPDATE campaigns c
SET source_kind = 'drip', source_id = e.sequence_id
FROM campaign_drip_enrollments e
WHERE e.last_campaign_id = c.id
  AND e.business_id = c.business_id;

UPDATE campaign_recipients cr
SET source_kind = c.source_kind, source_id = c.source_id
FROM campaigns c
WHERE c.id = cr.campaign_id
  AND (cr.source_kind = 'unknown' OR cr.source_kind IS DISTINCT FROM c.source_kind OR cr.source_id IS DISTINCT FROM c.source_id);

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_source_kind_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_source_kind_check
  CHECK (source_kind IN ('workspace_broadcast','public_api','drip','recurring_child','retarget','legacy','unknown'));
ALTER TABLE campaign_recipients DROP CONSTRAINT IF EXISTS campaign_recipients_source_kind_check;
ALTER TABLE campaign_recipients ADD CONSTRAINT campaign_recipients_source_kind_check
  CHECK (source_kind IN ('workspace_broadcast','public_api','drip','recurring_child','retarget','legacy','unknown'));

CREATE INDEX IF NOT EXISTS idx_campaigns_business_source
  ON campaigns(business_id, source_kind, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_source
  ON campaign_recipients(source_kind, source_id, campaign_id);

CREATE OR REPLACE FUNCTION inherit_campaign_recipient_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT c.source_kind, c.source_id INTO NEW.source_kind, NEW.source_id
  FROM campaigns c WHERE c.id = NEW.campaign_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS inherit_campaign_recipient_source ON campaign_recipients;
CREATE TRIGGER inherit_campaign_recipient_source
BEFORE INSERT OR UPDATE OF campaign_id ON campaign_recipients
FOR EACH ROW EXECUTE FUNCTION inherit_campaign_recipient_source();

CREATE OR REPLACE FUNCTION attribute_drip_campaign_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.last_campaign_id IS NOT NULL
     AND NEW.last_campaign_id IS DISTINCT FROM OLD.last_campaign_id THEN
    UPDATE campaigns
       SET source_kind = 'drip', source_id = NEW.sequence_id
     WHERE id = NEW.last_campaign_id AND business_id = NEW.business_id;
    UPDATE campaign_recipients
       SET source_kind = 'drip', source_id = NEW.sequence_id
     WHERE campaign_id = NEW.last_campaign_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS attribute_drip_campaign_source ON campaign_drip_enrollments;
CREATE TRIGGER attribute_drip_campaign_source
AFTER UPDATE OF last_campaign_id ON campaign_drip_enrollments
FOR EACH ROW EXECUTE FUNCTION attribute_drip_campaign_source();
