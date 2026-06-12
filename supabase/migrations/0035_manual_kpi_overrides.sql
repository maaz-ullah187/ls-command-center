-- ============================================================
-- 0035: manual_kpi_overrides
-- ============================================================
-- Inline-edit values for the Main Dashboard KPI cards. When an override
-- exists for (metric_key, month), the dashboard uses it instead of the
-- value computed from t07 / sheets / etc.
--
-- First consumer: Deposit Revenue card on HeadlineKPIs.tsx — the operator
-- corrects the figure when Stripe's reported deposits diverge from the
-- internal source of truth.
-- ============================================================

CREATE TABLE IF NOT EXISTS manual_kpi_overrides (
  -- Stable text id of the form `<metric_key>:<YYYY-MM>` so upserts are
  -- idempotent without a composite unique index.
  id          text          PRIMARY KEY,
  metric_key  text          NOT NULL,
  month       text          NOT NULL,           -- YYYY-MM
  value       numeric(14,2) NOT NULL,
  updated_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manual_kpi_overrides_month
  ON manual_kpi_overrides (month);
