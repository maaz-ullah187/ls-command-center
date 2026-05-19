-- LS Command Center — interactive edit / override layer (Pillar 0.5)
--
-- Sync workers always upsert raw source data into the canonical tables. Human
-- corrections live here and left-join onto every read in src/lib/dataSources.ts
-- so a closer's typo'd EOD report can be fixed in the dashboard without ever
-- being overwritten by the next sync, and the original value is preserved as
-- an audit trail that can be reverted by deleting one row.

create table if not exists overrides (
  id          uuid primary key default gen_random_uuid(),
  table_name  text not null,
  row_id      text not null,
  field       text not null,
  original    jsonb,
  corrected   jsonb not null,
  edited_by   text not null default 'the operator',
  reason      text,
  edited_at   timestamptz not null default now(),
  unique (table_name, row_id, field)
);

create index if not exists overrides_lookup_idx
  on overrides (table_name, row_id);
