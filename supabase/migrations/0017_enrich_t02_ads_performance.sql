-- Ticket 2 — hydrate t02_ads performance columns from t01_leads / t03_bookings /
-- t06_deals_closed. Cohort attribution: a lead is credited to the ad-day it
-- first entered, and downstream bookings/deals from that lead are credited to
-- the same ad-day (even if they land weeks later).
--
-- Runs in a single UPDATE with a derived table for speed. Scoped by
-- `lookback_days` so the daily cron can refresh just the recent window.

CREATE OR REPLACE FUNCTION enrich_t02_ads_performance(lookback_days INT DEFAULT 90)
RETURNS VOID
LANGUAGE SQL
AS $$
  WITH lead_cohort AS (
    SELECT
      l.ad_id,
      l.date::date AS ad_date,
      COUNT(*)::int AS leads_count,
      array_agg(l.id) AS lead_ids
    FROM t01_leads l
    WHERE l.ad_id IS NOT NULL
      AND l.date >= (CURRENT_DATE - (lookback_days || ' days')::interval)::date
    GROUP BY l.ad_id, l.date::date
  ),
  enriched AS (
    SELECT
      lc.ad_id,
      lc.ad_date,
      lc.leads_count,
      (SELECT COUNT(*)::int
       FROM t03_bookings b
       WHERE b.lead_id = ANY(lc.lead_ids)) AS scheduled_calls_count,
      (SELECT COUNT(*)::int
       FROM t06_deals_closed d
       WHERE d.lead_id = ANY(lc.lead_ids)) AS purchases_count,
      (SELECT COALESCE(SUM(cash_collected), 0)::numeric
       FROM t06_deals_closed d
       WHERE d.lead_id = ANY(lc.lead_ids)) AS revenue_sum
    FROM lead_cohort lc
  )
  UPDATE t02_ads a
  SET leads           = e.leads_count,
      scheduled_calls = e.scheduled_calls_count,
      purchases       = e.purchases_count,
      revenue         = e.revenue_sum,
      updated_at      = NOW()
  FROM enriched e
  WHERE a.ad_id = e.ad_id
    AND a.date  = e.ad_date;
$$;
