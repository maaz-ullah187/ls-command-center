-- ============================================================
-- 0036: Payment Review Queue — t07_income_processors.review_status
-- ============================================================
-- Whop + Fanbasis payments that landed from 2026-06-01 onward enter a
-- pending_review state. The operator authorizes each in the Payment Review
-- queue, classifying it as New Cash (payment_type='new_client') or Backend
-- Revenue (payment_type='account_receivable'). Only approved rows feed the
-- main dashboard's revenue cards.
--
-- All historical rows + Stripe rows default to 'approved' so prior reporting
-- isn't disrupted.
-- ============================================================

ALTER TABLE t07_income_processors
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'approved';

ALTER TABLE t07_income_processors
  DROP CONSTRAINT IF EXISTS t07_income_processors_review_status_check;

ALTER TABLE t07_income_processors
  ADD CONSTRAINT t07_income_processors_review_status_check
  CHECK (review_status IN ('pending_review', 'approved'));

-- Flag Whop + Fanbasis payments dated 2026-06-01 onward as pending review.
UPDATE t07_income_processors
   SET review_status = 'pending_review'
 WHERE processor IN ('whop', 'fanbasis')
   AND date >= '2026-06-01';

-- Queue scans + dashboard filters both group by review_status, so an index
-- here keeps both fast even as the table grows.
CREATE INDEX IF NOT EXISTS idx_t07_review_status
  ON t07_income_processors (review_status, date);
