-- ============================================================
-- 0025: t08_expenses — add 'coaching' bucket
-- ============================================================
-- Per the operator (2026-04-28): the canonical user-facing expense buckets are
--   Labor (stored as 'labour' for back-compat) | Marketing | Overhead |
--   Coaching | Mastermind | Other
-- 'coaching' is new — projections code references it but the constraint
-- never allowed it, so any attempt to write 'coaching' would silently fail.
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
    'other',
    'unknown',
    'personal (shouldn''t be there)'
  ));
