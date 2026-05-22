-- Add Meta-reported CPL and lead fields to t02_ads.
-- cost_per_lead, cost_per_result, and meta_leads come directly from the Meta
-- Insights API; actions / action_values store the full breakdown as JSONB.
-- The existing `leads` column continues to hold GHL-sourced lead counts from
-- the enrich_t02_ads_performance RPC — meta_leads is a separate signal.

ALTER TABLE t02_ads
  ADD COLUMN IF NOT EXISTS cost_per_lead   numeric,
  ADD COLUMN IF NOT EXISTS meta_leads      integer,
  ADD COLUMN IF NOT EXISTS cost_per_result numeric,
  ADD COLUMN IF NOT EXISTS actions         jsonb,
  ADD COLUMN IF NOT EXISTS action_values   jsonb;
