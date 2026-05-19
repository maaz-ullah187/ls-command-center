-- 0018_restore_webinar_source.sql
-- the operator 2026-04-28: Hardcoded rule — GHL tag containing "webinar" classifies
-- a lead as source='Webinar'. The current t01_leads.source CHECK constraint
-- (set by 0011_rename_paid_to_facebook_ads.sql) does not allow 'Webinar', so
-- restore it as a first-class source value.
--
-- After applying this migration, the next GHL sync will write source='Webinar'
-- for any contact whose tags include "webinar" AND has no Facebook ad
-- attribution (campaign/adset/ad/Meta campaign_id). Real ad attribution still
-- wins — those rows stay 'Facebook Ads'.

ALTER TABLE t01_leads DROP CONSTRAINT IF EXISTS t01_leads_source_check;

ALTER TABLE t01_leads ADD CONSTRAINT t01_leads_source_check
  CHECK (source IN ('Facebook Ads', 'YouTube', 'Instagram', 'LinkedIn', 'X', 'Webinar', 'Referral', 'Unknown'));
