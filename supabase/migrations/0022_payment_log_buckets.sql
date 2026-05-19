-- Migration 0022 — extend payment_log so it can be the canonical Supabase
-- mirror of the Google Sheet "Client Payment Log".
--
-- the operator's rule: every dashboard read must come from Supabase, never directly
-- from a Google Sheet. The Main Dashboard's HeadlineKPIs + Revenue Composition
-- previously read /api/data/sheet-revenue (sheet-direct). After this migration
-- they read from payment_log via a sync worker that upserts the sheet on a
-- cron. The bucket columns mirror the sheet's per-month block exactly:
--
--   ar             — receivable / payment-plan installment for the month
--   renewals       — same client renews their program
--   upgrades       — same client upgrades to a higher-tier program
--   refunds        — refund amount (positive number; subtracted in totals)
--   total_revenue  — sheet's per-row Total column (newCash + ar + renewals + upgrades - refunds)
--   month_status   — sheet's "Y" / blank flag — Y = AR/renewals/upgrades counted toward this month
--   month_year     — e.g. "April 2026" — denormalized so we don't have to derive from date_paid
--
-- The unique key is widened to (client_name, month_year, payment_type) so we
-- have ONE row per client per month, matching the sheet's column-block model.

ALTER TABLE payment_log
  ADD COLUMN IF NOT EXISTS ar             numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renewals       numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upgrades       numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunds        numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_revenue  numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS month_status   text,
  ADD COLUMN IF NOT EXISTS month_year     text;

-- Drop the old narrow uniqueness constraint and replace with the per-month one.
-- The original constraint (client_name, date_paid, payment_type) breaks for
-- monthly recurring rows where date_paid varies inside a month-block. We key
-- on month_year instead so re-syncs are idempotent.
ALTER TABLE payment_log
  DROP CONSTRAINT IF EXISTS payment_log_client_name_date_paid_payment_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS payment_log_client_month_type_uq
  ON payment_log (client_name, month_year, payment_type);

CREATE INDEX IF NOT EXISTS idx_payment_log_month_year
  ON payment_log (month_year);
