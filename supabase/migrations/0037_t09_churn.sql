-- ============================================================
-- 0037: t09_churn — client churn / offboarding tracking
-- ============================================================
-- One row per offboarded-client Slack message. Source channel is configured
-- in /api/sync/churn (fixed channel id, ~daily cadence).
--
-- The dashboard's "Churn" KPI card reads from this table via
-- /api/main/churn to render a count + trend arrow per period.
-- ============================================================

CREATE TABLE IF NOT EXISTS t09_churn (
  -- Slack ts (stable, monotonic) doubles as the primary key — re-syncs
  -- are idempotent.
  id              text         PRIMARY KEY,
  date            date         NOT NULL,
  client_name     text,
  cs_manager      text,
  reason          text,
  ltv_months      integer,
  client_revenue  numeric(14,2),
  refund_amount   numeric(14,2),
  slack_ts        text         NOT NULL,
  raw_text        text,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

-- Date scans drive every dashboard read.
CREATE INDEX IF NOT EXISTS idx_t09_churn_date
  ON t09_churn (date);

-- CS-manager filter for per-manager churn drilldowns (future).
CREATE INDEX IF NOT EXISTS idx_t09_churn_cs_manager
  ON t09_churn (cs_manager);
