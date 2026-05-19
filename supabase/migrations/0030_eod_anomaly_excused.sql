-- ============================================================
-- 0030: t05b_eod_anomaly_excused — (eod_id, field) pairs that the
-- team has reviewed and marked as legitimate (not actually anomalous).
-- ============================================================
-- Per the operator (2026-04-28): EOD anomaly rows in the Daily Review Queue
-- need a persistent "Remove Issue" button. Today the X dismiss is
-- client-only and the row reappears on refresh. After this migration,
-- the missing-eods route filters out any (eod_id, field) listed here.
--
-- field examples: 'cash_collected', 'revenue_generated',
-- 'calls_closed', 'calls_shown'.
-- ============================================================

CREATE TABLE IF NOT EXISTS t05b_eod_anomaly_excused (
  eod_id       TEXT NOT NULL,
  field        TEXT NOT NULL,
  excused_by   TEXT,
  excused_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason       TEXT,
  PRIMARY KEY (eod_id, field)
);

CREATE INDEX IF NOT EXISTS t05b_eod_anomaly_excused_eod_id_idx ON t05b_eod_anomaly_excused (eod_id);
