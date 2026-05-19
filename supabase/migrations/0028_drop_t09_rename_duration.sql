-- ============================================================
-- 0028: Drop t09_clients (deprecated) + fix duration_years column name
-- ============================================================
-- Per the operator (2026-04-29):
--   1. t09_clients was a duplicate sheet→table sync. The canonical client
--      table is now t_client_ledger (synced from the published payment-log
--      CSV). Drop t09_clients entirely — every dashboard route now reads
--      from t_client_ledger.
--   2. The duration_years column on t_client_ledger actually stores months,
--      not years (the sheet formula computes months). Rename so the column
--      name matches the data.
-- ============================================================

-- Step 1: rename the misnamed column
ALTER TABLE t_client_ledger
  RENAME COLUMN duration_years TO duration_months;

-- Step 2: drop the deprecated table.
-- CASCADE handles any FKs / views that may have referenced it.
DROP TABLE IF EXISTS t09_clients CASCADE;
