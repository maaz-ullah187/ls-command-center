-- 0031_weekly_qualitative_cache.sql
-- 2026-04-30: cache the LLM-generated qualitative summary per week so
-- /week doesn't re-call Claude on every page load. the operator's weekly
-- checklist asks for buckets + quotes pulled from
-- t06_deals_closed.why_they_bought; this is the cache layer.
--
-- One row per week. `summary` is JSONB with shape:
--   {
--     buyReasons:   { theme: string, quotes: string[], dealCount: int }[],
--     painPoints:   { theme: string, quotes: string[], dealCount: int }[],
--     desires:      { ... },
--     objections:   { ... },
--     aiUseCases:   { ... },
--     dealsAnalyzed: int,
--     model: string
--   }

CREATE TABLE IF NOT EXISTS t91_weekly_qualitative_cache (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  week_from     DATE        NOT NULL,
  week_to       DATE        NOT NULL,
  summary       JSONB       NOT NULL,
  deals_hash    TEXT        NOT NULL,   -- hash of deal IDs analyzed; lets us detect when input changed
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  model         TEXT,
  CONSTRAINT t91_week_unique UNIQUE (week_from, week_to)
);

CREATE INDEX IF NOT EXISTS t91_weekly_qual_week_idx ON t91_weekly_qualitative_cache (week_from DESC);
