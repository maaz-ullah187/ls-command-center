-- 0009_call_recordings.sql
-- Separate table for call recordings (Grain) with AI analysis.
-- Not part of bookings — not every booking has a recording, and not every
-- recording is linked to a booking. Analysis (qualified, why_didnt_close,
-- objections) is stored here alongside the recording metadata.

create table if not exists t17_call_recordings (
  id                 text primary key,           -- Grain recording ID
  call_date          date,
  call_title         text,
  call_type          text,                       -- 'sales' | 'setter' | 'fulfillment' | 'internal' | 'unknown'
  duration_min       int,
  closer_email       text,                       -- primary owner email
  grain_url          text,
  transcript_txt_url text,
  transcript_json_url text,
  summary            text,                       -- Grain AI summary
  intelligence_notes text,                       -- Grain intelligence_notes_md

  -- Cross-reference fields (populated by name-matching during sync)
  prospect_name      text,                       -- extracted from recording title
  ghl_contact_id     text references t01_leads(id) on delete set null,
  booking_id         text,                       -- references t03_bookings.id if matched

  -- AI analysis (populated by scoring/run worker)
  qual_score         numeric(4,2),
  qualified          boolean,
  qual_summary       text,
  qual_red_flags     text[],
  qual_green_flags   text[],
  why_didnt_close    text,
  objections         text[],
  scored_at          timestamptz,
  scored_model       text,

  -- Metadata
  synced_at          timestamptz default now(),
  created_at         timestamptz default now()
);

create index if not exists t17_call_recordings_date_idx        on t17_call_recordings(call_date desc);
create index if not exists t17_call_recordings_closer_idx      on t17_call_recordings(closer_email);
create index if not exists t17_call_recordings_ghl_contact_idx on t17_call_recordings(ghl_contact_id);
create index if not exists t17_call_recordings_call_type_idx   on t17_call_recordings(call_type);
