-- Migration 0024 — expand t07_income_processors.payment_type vocabulary so
-- every payment carries a categorization the dashboard can bucket on.
--
-- Old vocabulary: ('new','renewal','upgrade','refund','other')
-- New vocabulary adds the operator's full set:
--    new_client          — first payment from a customer (auto-tag if matched
--                          to a t06_deals_closed row with deal_type='new')
--    account_receivable  — payment-plan installments / AR collections
--    upsell_renewal      — upsell + renewal collapsed (the operator: same bucket)
--    mastermind          — mastermind tickets / event payments
--    refund              — refunds (existing)
--    other               — unsure → surfaces in the Daily Review Queue
--
-- Legacy values ('new','renewal','upgrade') stay valid temporarily so the
-- backfill can run; a later migration can prune them once the team has
-- re-categorized the long tail manually.

DO $$
DECLARE
  c_name text;
BEGIN
  SELECT con.conname
    INTO c_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 't07_income_processors'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%payment_type%';
  IF c_name IS NOT NULL THEN
    EXECUTE FORMAT('ALTER TABLE t07_income_processors DROP CONSTRAINT %I', c_name);
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
    'other',
    -- legacy values kept temporarily to allow staged backfill
    'new',
    'renewal',
    'upgrade'
  ));
