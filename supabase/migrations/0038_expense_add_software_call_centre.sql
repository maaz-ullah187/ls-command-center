-- ============================================================
-- 0038: t08_expenses — add 'software' and 'call_centre' buckets
-- ============================================================
-- Adds two new expense_type values:
--   software    — SaaS / software subscriptions
--   call_centre — call centre / inbound/outbound staffing costs
-- ============================================================

DO $$
DECLARE
  c_name TEXT;
BEGIN
  SELECT con.conname INTO c_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 't08_expenses'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%expense_type%';
  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE t08_expenses DROP CONSTRAINT %I', c_name);
  END IF;
END $$;

ALTER TABLE t08_expenses
  ADD CONSTRAINT t08_expenses_expense_type_check
  CHECK (expense_type IN (
    'labour',
    'marketing',
    'overhead',
    'coaching',
    'mastermind',
    'software',
    'call_centre',
    'other',
    'unknown',
    'personal (shouldn''t be there)'
  ));
