-- ============================================================
-- 0034: funnel_projections table
-- ============================================================
-- Stores monthly projection targets for the Sales Funnel Financial Model
-- (src/components/tabs/ProjectionsTab.tsx). One row per (month, metric_key).
--
-- The component reads these rows for the current month's projections column
-- and writes back when the operator edits a target inline. Actuals are
-- computed live from the rest of the dashboard (leads / ads / EODs /
-- revenue-buckets) and never live in this table.
-- ============================================================

CREATE TABLE IF NOT EXISTS funnel_projections (
  -- First day of the month the projection applies to (YYYY-MM-01).
  month          date         NOT NULL,

  -- Canonical metric identifier. Kept as free-form text so the UI can add
  -- new metric rows without a schema change. Stable keys defined in the
  -- ProjectionsTab component (e.g. 'ad_spend', 'leads', 'cpl',
  -- 'calls_scheduled', 'calls_taken', 'offers_made', 'cash_collected', etc).
  metric_key     text         NOT NULL,

  -- The projected target value. Stored as numeric so it can hold any kind
  -- of metric — dollars, counts, percentages — the UI handles formatting.
  projected_value numeric(14,2) NOT NULL,

  -- Audit trail.
  updated_by     text,
  updated_at     timestamptz  NOT NULL DEFAULT now(),

  PRIMARY KEY (month, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_funnel_projections_month
  ON funnel_projections (month);
