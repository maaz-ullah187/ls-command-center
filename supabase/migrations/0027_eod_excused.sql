-- ============================================================
-- 0027: t05a_eod_excused — closer/date pairs the team has marked as
-- legitimately not-working (PTO, weekend overrides, sick day, etc).
-- ============================================================
-- Per the operator (2026-04-28): "If a closer didn't work that day it should be
-- possible to mark the missing EOD as excused so it stops reappearing."
--
-- The missing-EOD detector compares expected closers × dates vs t05_eod_reports.
-- After this migration, it ALSO skips any (closer, date) pair listed here.
-- ============================================================

CREATE TABLE IF NOT EXISTS t05a_eod_excused (
  closer       TEXT NOT NULL,
  date         DATE NOT NULL,
  excused_by   TEXT,
  excused_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason       TEXT,
  PRIMARY KEY (closer, date)
);

CREATE INDEX IF NOT EXISTS t05a_eod_excused_date_idx ON t05a_eod_excused (date);
