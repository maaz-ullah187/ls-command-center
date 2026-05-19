-- ============================================================
-- 0013: t08_expenses — add card attribution + `unknown` bucket
-- ============================================================
-- Additions (per the spec, 2026-04-23):
--   1. card_name, card_last_four columns — who paid for this?
--      Populated for debitCardTransaction rows from Mercury /cards endpoint.
--      Null for wires / ACH / outgoing payments.
--   2. Expand expense_type vocabulary to 6 buckets:
--        labour  — team payments
--        marketing — ad spend + marketing contractors
--        overhead — known SaaS / tools / services
--        mastermind — events, venues, travel
--        other — legit, needed, doesn't fit above (e.g. Megalodon Marketing)
--        unknown — system doesn't recognize it; human review needed
-- ============================================================

-- 1. Columns
alter table t08_expenses
  add column if not exists card_name      text,
  add column if not exists card_last_four text;

-- 2. Drop old 5-bucket constraint and re-add with `unknown`
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
  check (expense_type in ('labour','marketing','overhead','mastermind','other','unknown'));
