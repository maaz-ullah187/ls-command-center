-- ============================================================
-- 0026: t07_income_processors — add 'excluded' bucket
-- ============================================================
-- Per the operator (2026-04-28): some payments land in our processors that
-- shouldn't have — wrong business, test charges, mis-routed wires, etc.
-- Marking them 'excluded' lets us keep an audit trail in t07 without
-- polluting revenue, LTV, pace, or composition cards.
--
-- Every downstream query filters out payment_type = 'excluded' so the
-- money is never double-counted in the dashboard.
-- ============================================================

DO $$
DECLARE
  c_name TEXT;
BEGIN
  SELECT con.conname INTO c_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 't07_income_processors'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%payment_type%';
  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE t07_income_processors DROP CONSTRAINT %I', c_name);
  END IF;
END $$;

ALTER TABLE t07_income_processors
  ADD CONSTRAINT t07_income_processors_payment_type_check
  CHECK (payment_type IN (
    'new_client',
    'account_receivable',
    'upsell_renewal',
    'mastermind',
    'refund',
    'excluded',
    'other',
    -- Legacy values kept for back-compat with not-yet-backfilled rows.
    -- After 100% of rows have been re-categorized these can be dropped.
    'new',
    'renewal',
    'upgrade'
  ));
