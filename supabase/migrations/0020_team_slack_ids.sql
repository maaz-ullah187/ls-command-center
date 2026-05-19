-- Migration 0020 — add slack_user_id to t90_team_roster for Review Queue Ping routing.
--
-- The Daily Review Queue (ReviewQueueBanner) ships with per-row Ping buttons.
-- v1 of Ping = Slack DM via chat.postMessage with the bot token. The owner of
-- a row is derived from a routing table inside the API route:
--   - missing billing type   → the closer attached to the deal
--   - missing expense type   → the finance lead
--   - missing source         → the lead's assigned closer
--   - unlogged calls         → the closer/setter who took the call
--
-- That derivation produces a closer name. We then look up slack_user_id by
-- joining on t90_team_roster.name. If no row matches (or slack_user_id is NULL)
-- the API falls back to posting in #ops.

ALTER TABLE t90_team_roster
  ADD COLUMN IF NOT EXISTS slack_user_id text;

CREATE INDEX IF NOT EXISTS idx_t90_slack_user_id
  ON t90_team_roster (slack_user_id)
  WHERE slack_user_id IS NOT NULL;

COMMENT ON COLUMN t90_team_roster.slack_user_id IS
  'Slack user ID (e.g. U07ABCDEF). Used by /api/review-queue/ping to DM owners.';
