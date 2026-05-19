-- Competitor Tracker table
CREATE TABLE IF NOT EXISTS competitors (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  instagram text,
  youtube text,
  ads_library_url text,
  strengths text,
  monthly_rev numeric(12,2) DEFAULT 0,
  niche text[] DEFAULT '{}',
  competitor_type text DEFAULT 'Indirect',
  notes text,
  custom_fields jsonb DEFAULT '{}',
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_competitors_name ON competitors(name);
