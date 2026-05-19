-- 0021_card_feedback.sql
-- Per-card feedback popover ("Send to Claude") on every dashboard card.
-- the operator clicks the kebab on any card → comments → POST /api/feedback.

CREATE TABLE IF NOT EXISTS card_feedback (
  id          BIGSERIAL PRIMARY KEY,
  card_id     TEXT NOT NULL,                     -- e.g. "main:revenue-composition"
  page_url    TEXT,                              -- where the user was when they filed
  comment     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',      -- open | seen | resolved | discarded
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_card_feedback_status_created
  ON card_feedback (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_card_feedback_card
  ON card_feedback (card_id, created_at DESC);
