-- 0011_rename_paid_to_facebook_ads.sql
-- Rename source 'Paid' → 'Facebook Ads' in t01_leads.
-- Applied via Supabase MCP on 2026-04-16.

-- t01_leads: drop old constraint, update values, add new constraint
ALTER TABLE t01_leads DROP CONSTRAINT IF EXISTS t01_leads_source_check;
UPDATE t01_leads SET source = 'Facebook Ads' WHERE source = 'Paid';
ALTER TABLE t01_leads ADD CONSTRAINT t01_leads_source_check
  CHECK (source IN ('Facebook Ads', 'YouTube', 'Instagram', 'LinkedIn', 'X', 'Referral', 'Unknown'));

-- t02_ads: convert channel enum to text, rename values, add constraint, drop enum
ALTER TABLE t02_ads ALTER COLUMN channel TYPE text USING channel::text;
ALTER TABLE t02_ads ALTER COLUMN channel SET DEFAULT 'Facebook Ads';
UPDATE t02_ads SET channel = 'Facebook Ads' WHERE channel = 'Paid';
ALTER TABLE t02_ads ADD CONSTRAINT t02_ads_channel_check
  CHECK (channel IN ('Facebook Ads', 'YouTube', 'Instagram', 'LinkedIn', 'X', 'Referral', 'Unknown', 'Webinar', 'Organic'));
DROP TYPE IF EXISTS channel;
