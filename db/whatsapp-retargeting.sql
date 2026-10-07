ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS audience_segment_id TEXT REFERENCES audience_segments(id) ON DELETE SET NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS retarget_source_campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS dynamic_audience BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE audience_segments ADD COLUMN IF NOT EXISTS retarget_source_campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE audience_segments ADD COLUMN IF NOT EXISTS retarget_preset_id TEXT NOT NULL DEFAULT '';
