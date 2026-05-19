-- Migration 0019 — add revenue_category column for the Monthly view's revenue donut.
--
-- Spec ref: THREE_VIEWS_SPEC §4.5. The Monthly Constraint view splits revenue
-- into four categories so the donut tells you WHERE this month's cash came from:
--
--   new       — first-time client cash (initial program purchase)
--   renewal   — recurring program payments from existing clients
--   upsell    — same client moves up a tier (Program A → Program B, etc.)
--   refund    — negative entries (refunds reduce the donut, separate slice)
--
-- We add the column to BOTH t06_income_processors (raw payment events from
-- Whop / Fanbasis / Slack #payment-notifications) AND t05_deals_closed
-- (the per-deal record from #new-clients). Spec §4.5 keeps the same vocabulary
-- across both so cross-table joins line up.
--
-- The column is nullable on purpose — historical rows will be NULL until a
-- backfill job runs. The Main Dashboard / Monthly view filters NULL out of the
-- donut and surfaces the count in the Review Queue (`missing revenue category`)
-- so the team can categorize incrementally.

ALTER TABLE t06_income_processors
  ADD COLUMN IF NOT EXISTS revenue_category text;

ALTER TABLE t06_income_processors
  ADD CONSTRAINT t06_revenue_category_check
  CHECK (revenue_category IS NULL OR revenue_category IN ('new', 'renewal', 'upsell', 'refund'));

CREATE INDEX IF NOT EXISTS idx_t06_revenue_category
  ON t06_income_processors (revenue_category, date);

ALTER TABLE t05_deals_closed
  ADD COLUMN IF NOT EXISTS revenue_category text;

ALTER TABLE t05_deals_closed
  ADD CONSTRAINT t05_revenue_category_check
  CHECK (revenue_category IS NULL OR revenue_category IN ('new', 'renewal', 'upsell', 'refund'));

CREATE INDEX IF NOT EXISTS idx_t05_revenue_category
  ON t05_deals_closed (revenue_category, date);
