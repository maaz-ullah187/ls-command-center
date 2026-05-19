-- ============================================================
-- 0014: t08_expenses — add `personal (shouldn't be there)` bucket
-- ============================================================
-- Per the operator (2026-04-23): charges to ProgB-issued cards that are
-- actually personal (e.g. Netflix, Omega Wellness Club) should be
-- flagged explicitly so they don't inflate real business expenses
-- and are obvious in the UI / Supabase.
--
-- New value: 'personal (shouldn''t be there)' — literal phrasing
-- so the flag is unmissable when scanning the expense_type column.
-- ============================================================

do $$
declare
  c_name text;
begin
  select con.conname
    into c_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
   where ns.nspname = 'public'
     and rel.relname = 't08_expenses'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%expense_type%'
   limit 1;

  if c_name is not null then
    execute format('alter table t08_expenses drop constraint %I', c_name);
  end if;
end $$;

alter table t08_expenses
  add constraint t08_expenses_expense_type_check
  check (expense_type in (
    'labour',
    'marketing',
    'overhead',
    'mastermind',
    'other',
    'unknown',
    'personal (shouldn''t be there)'
  ));
