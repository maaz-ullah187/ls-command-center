-- 0023_monthly_projections.sql
-- t21_monthly_projections — interactive Pace vs Projection target table.
-- One row per (month, section, metric). Editable inline from the Main
-- Dashboard's Pace card. Actuals are computed at read time from the
-- corresponding source tables (t06_deals_closed, t07_income_processors,
-- t08_expenses) and joined onto these target rows in the API layer.
--
-- Sections (mirrors the operator's projection sheet):
--   contracted     — units × unit_price = target_value (3 rows: ProgA FE / ProgB BE / Program C)
--   cash_collected — % UFCC × matching contracted target = target_value (3 rows)
--   receivables    — flat $ or ar_base × pct_expected = target_value (3 rows: ProgB BE AR / Asc+Renewals / Mastermind)
--   refunds        — % refund × matching contracted target = -target_value (2 rows: ProgA / ProgB)
--   expenses       — flat $ target_value (3 rows: Overhead / Labor / Marketing)
--
-- For v1, target_value is the canonical dollar number compared against actuals.
-- The auxiliary input columns (target_units, target_pct, unit_price, ar_base)
-- exist so the bulk-edit modal can let the operator type natural inputs (units, %)
-- and have target_value auto-compute on save.

create table if not exists t21_monthly_projections (
  id            uuid primary key default gen_random_uuid(),
  month         text not null,                          -- 'YYYY-MM'
  section       text not null,                          -- 'contracted' | 'cash_collected' | 'receivables' | 'refunds' | 'expenses'
  metric        text not null,                          -- e.g. 'Program A FE' / 'Program B Upfront' / 'Overhead'
  kind          text not null default 'revenue',        -- 'revenue' | 'expense' | 'refund' (drives status logic)
  target_value  numeric not null default 0,             -- canonical $ number compared against actuals
  target_units  numeric,                                 -- contracted rows: number of units
  target_pct    numeric,                                 -- cash_collected/refunds: % UFCC; receivables: % expected
  unit_price    numeric,                                 -- contracted rows: $ per unit
  ar_base       numeric,                                 -- receivables AR row: outstanding AR base $
  reason        text,
  updated_by    text not null default 'the operator',
  updated_at    timestamptz not null default now(),
  unique (month, section, metric)
);
create index if not exists t21_proj_month_idx on t21_monthly_projections (month);
