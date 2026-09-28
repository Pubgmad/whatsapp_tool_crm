ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS template_parameters JSONB NOT NULL DEFAULT '{}'::jsonb;
