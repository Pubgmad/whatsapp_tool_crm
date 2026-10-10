CREATE TABLE IF NOT EXISTS public_site_documents (
  id text PRIMARY KEY CHECK (id = 'current'),
  draft jsonb NOT NULL DEFAULT '{"sections":[]}'::jsonb,
  published jsonb NOT NULL DEFAULT '{"sections":[]}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  published_revision integer NOT NULL DEFAULT 0 CHECK (published_revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
INSERT INTO public_site_documents (id) VALUES ('current') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_brand_assets (
  kind text PRIMARY KEY CHECK (kind IN ('logo', 'favicon', 'hero')),
  media_type text NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
  image_data bytea NOT NULL,
  width integer NOT NULL CHECK (width BETWEEN 16 AND 4000),
  height integer NOT NULL CHECK (height BETWEEN 16 AND 4000),
  version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_site_revisions (
  id text PRIMARY KEY,
  revision integer NOT NULL CHECK (revision >= 0),
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_site_revisions_revision_idx ON public_site_revisions (revision DESC);
