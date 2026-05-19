-- 0010_simplify_leads.sql
-- Simplify t01_leads to clean "who came in the door" table.
-- All call/booking/closer/cash/scoring data lives in other tables.
-- Applied via Supabase MCP on 2026-04-16.

-- 1. Drop FK constraints referencing t01_leads
ALTER TABLE t10_lead_scores DROP CONSTRAINT IF EXISTS lead_scores_lead_id_fkey;
ALTER TABLE t17_call_recordings DROP CONSTRAINT IF EXISTS t17_call_recordings_ghl_contact_id_fkey;

-- 2. Delete pre-April 2026 data
DELETE FROM t01_leads WHERE date < '2026-04-01';

-- 3. Clean up orphaned rows in referencing tables
DELETE FROM t10_lead_scores WHERE lead_id NOT IN (SELECT id FROM t01_leads);
DELETE FROM t17_call_recordings WHERE ghl_contact_id IS NOT NULL AND ghl_contact_id NOT IN (SELECT id FROM t01_leads);

-- 4. Drop removed columns
ALTER TABLE t01_leads
  DROP COLUMN IF EXISTS stage,
  DROP COLUMN IF EXISTS demo_booked,
  DROP COLUMN IF EXISTS demo_date,
  DROP COLUMN IF EXISTS show_status,
  DROP COLUMN IF EXISTS call_outcome,
  DROP COLUMN IF EXISTS assigned_closer,
  DROP COLUMN IF EXISTS quality_score,
  DROP COLUMN IF EXISTS cash_collected,
  DROP COLUMN IF EXISTS contracted_revenue,
  DROP COLUMN IF EXISTS call_recording_url,
  DROP COLUMN IF EXISTS ghl_contact_id,
  DROP COLUMN IF EXISTS grain_recording_id,
  DROP COLUMN IF EXISTS meeting_url,
  DROP COLUMN IF EXISTS call_type,
  DROP COLUMN IF EXISTS assigned_setter,
  DROP COLUMN IF EXISTS follow_up_type,
  DROP COLUMN IF EXISTS follow_up_date,
  DROP COLUMN IF EXISTS outcome_logged_at,
  DROP COLUMN IF EXISTS ad_account_name,
  DROP COLUMN IF EXISTS program;

-- 5. Convert source from channel enum to plain text
ALTER TABLE t01_leads ALTER COLUMN source TYPE text USING source::text;
ALTER TABLE t01_leads ALTER COLUMN source SET DEFAULT 'Unknown';

-- 6. Add check constraint on source
ALTER TABLE t01_leads ADD CONSTRAINT t01_leads_source_check
  CHECK (source IN ('Paid', 'YouTube', 'Instagram', 'LinkedIn', 'X', 'Referral', 'Unknown'));

-- 7. Drop indexes on removed columns
DROP INDEX IF EXISTS leads_program_idx;
DROP INDEX IF EXISTS leads_ghl_contact_idx;

-- 8. Drop unused enums (channel kept for t02_ads)
DROP TYPE IF EXISTS lead_stage;
DROP TYPE IF EXISTS show_status;
DROP TYPE IF EXISTS call_outcome;
DROP TYPE IF EXISTS program;

-- 9. Re-add FK constraints
ALTER TABLE t10_lead_scores
  ADD CONSTRAINT lead_scores_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES t01_leads(id) ON DELETE CASCADE;

ALTER TABLE t17_call_recordings
  ADD CONSTRAINT t17_call_recordings_ghl_contact_id_fkey
  FOREIGN KEY (ghl_contact_id) REFERENCES t01_leads(id) ON DELETE SET NULL;
