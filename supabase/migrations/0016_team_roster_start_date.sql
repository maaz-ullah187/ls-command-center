-- Add start_date to t90_team_roster so the EOD compliance check can apply a
-- new-hire grace period (default 3 business days) instead of spamming alerts
-- for team members who haven't had time to file any reports yet.

ALTER TABLE t90_team_roster
  ADD COLUMN IF NOT EXISTS start_date DATE;

UPDATE t90_team_roster
SET start_date = created_at::date
WHERE start_date IS NULL;

ALTER TABLE t90_team_roster
  ALTER COLUMN start_date SET NOT NULL;

ALTER TABLE t90_team_roster
  ALTER COLUMN start_date SET DEFAULT CURRENT_DATE;
