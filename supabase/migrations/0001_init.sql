-- LS Command Center — initial schema
-- Mirrors the TypeScript types in src/lib/types.ts so the dashboard can read
-- live data through src/lib/dataSources.ts without changing component code.
--
-- Convention:
--   * snake_case columns (Postgres native), camelCase mapped in dataSources.ts
--   * id columns use text primary keys to match the existing string ids on the
--     mock data so we don't have to translate ids when matching across sources
--   * every table gets created_at / updated_at for sync auditing
--   * source-system row identity is preserved via natural ids (e.g. ghl_contact_id)

create extension if not exists pgcrypto;
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Reference enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type channel as enum (
    'YouTube','Instagram','LinkedIn','X','Paid','Webinar','Referral','Unknown','Organic'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type program as enum ('Program A','Program B','Program C');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lead_stage as enum (
    'New Lead','Long Term Nurture','Qualified','Closed Won','Closed Lost'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type show_status as enum ('Showed','No Show','Cancelled','Rescheduled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type call_outcome as enum (
    'Closed Won','Follow Up Booked','Not Qualified','No Decision','Closed Lost'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- leads — canonical lead row, primarily fed from GHL (Pillar 2)
-- ---------------------------------------------------------------------------
create table if not exists leads (
  id                  text primary key,
  date                date not null,
  name                text not null,
  email               text not null,
  phone               text,
  source              channel not null default 'Unknown',
  program             program,
  ad_account_name     text,
  campaign_name       text,
  ad_set_name         text,
  ad_name             text,
  stage               lead_stage not null default 'New Lead',
  demo_booked         boolean not null default false,
  demo_date           timestamptz,
  show_status         show_status,
  call_outcome        call_outcome,
  assigned_closer     text,
  quality_score       numeric,
  cash_collected      numeric not null default 0,
  contracted_revenue  numeric not null default 0,
  call_recording_url  text,
  ghl_contact_id      text,
  grain_recording_id  text,
  meeting_url         text,
  call_type           text,
  assigned_setter     text,
  follow_up_type      text,
  follow_up_date      timestamptz,
  outcome_logged_at   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists leads_email_idx on leads (email);
create index if not exists leads_date_idx on leads (date);
create index if not exists leads_program_idx on leads (program);
create index if not exists leads_source_idx on leads (source);
create index if not exists leads_ghl_contact_idx on leads (ghl_contact_id);

-- ---------------------------------------------------------------------------
-- ads — Meta Ads insights, one row per ad per day (Pillar 1)
-- ---------------------------------------------------------------------------
create table if not exists ads (
  id                text primary key,
  date              date not null,
  ad_account_name   text not null,
  campaign_name     text not null,
  ad_set_name       text not null,
  ad_name           text not null,
  channel           channel not null default 'Paid',
  spend             numeric not null default 0,
  impressions       integer not null default 0,
  clicks            integer not null default 0,
  leads             integer not null default 0,
  scheduled_calls   integer not null default 0,
  qualified_calls   integer not null default 0,
  purchases         integer not null default 0,
  revenue           numeric not null default 0,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists ads_date_idx on ads (date);
create index if not exists ads_campaign_idx on ads (campaign_name);

-- ---------------------------------------------------------------------------
-- payments — Whop + Fanbasis (Pillar 4). Stripe is intentionally absent.
-- ---------------------------------------------------------------------------
create table if not exists payments (
  id              text primary key,
  date            date not null,
  customer_email  text not null,
  customer_name   text,
  gross           numeric not null,
  net             numeric,
  processor       text not null check (processor in ('whop','fanbasis')),
  product_name    text,
  lead_id         text references leads(id) on delete set null,
  raw             jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists payments_email_idx on payments (customer_email);
create index if not exists payments_date_idx on payments (date);
create index if not exists payments_lead_idx on payments (lead_id);

-- ---------------------------------------------------------------------------
-- calls — Grain + Fathom (Pillar 5). Transcript text lives in Storage; this
-- table holds metadata + the storage path.
-- ---------------------------------------------------------------------------
create table if not exists calls (
  id                  text primary key,
  lead_id             text references leads(id) on delete cascade,
  date                timestamptz not null,
  duration_seconds    integer,
  attendee_emails     text[] not null default '{}',
  recording_url       text,
  transcript_path     text,
  source              text not null check (source in ('grain','fathom')),
  outcome             call_outcome,
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists calls_lead_idx on calls (lead_id);
create index if not exists calls_date_idx on calls (date);

-- ---------------------------------------------------------------------------
-- daily_metrics — pre-aggregated daily snapshot, used by trend charts
-- ---------------------------------------------------------------------------
create table if not exists daily_metrics (
  date            date primary key,
  spend           numeric not null default 0,
  leads           integer not null default 0,
  calls_booked    integer not null default 0,
  calls_shown     integer not null default 0,
  calls_closed    integer not null default 0,
  revenue         numeric not null default 0,
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- content_posts — IG / X / LinkedIn / YouTube organic content (Pillars 7, 8)
-- ---------------------------------------------------------------------------
create table if not exists content_posts (
  id                  text primary key,
  channel             channel not null,
  type                text not null,
  title               text not null,
  date                date not null,
  views               integer not null default 0,
  reach               integer not null default 0,
  follows             integer not null default 0,
  engagement_rate     numeric not null default 0,
  likes               integer not null default 0,
  comments            integer not null default 0,
  shares              integer not null default 0,
  saves               integer not null default 0,
  dm_trigger          text,
  dm_replies          integer not null default 0,
  leads               integer not null default 0,
  booked              integer not null default 0,
  showed              integer not null default 0,
  closed              integer not null default 0,
  cash_collected      numeric not null default 0,
  contracted_revenue  numeric not null default 0,
  thumbnail_url       text,
  duration            text,
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists content_channel_idx on content_posts (channel);
create index if not exists content_date_idx on content_posts (date);

-- ---------------------------------------------------------------------------
-- closer_eod_reports — parsed from Slack #sales-rep-eods (Pillar 6)
-- ---------------------------------------------------------------------------
create table if not exists closer_eod_reports (
  id              text primary key,
  date            date not null,
  closer_name     text not null,
  calls_shown     integer not null default 0,
  calls_closed    integer not null default 0,
  cash_collected  numeric not null default 0,
  raw_message     text,
  slack_ts        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (date, closer_name)
);
create index if not exists eod_date_idx on closer_eod_reports (date);
create index if not exists eod_closer_idx on closer_eod_reports (closer_name);

-- ---------------------------------------------------------------------------
-- lead_scores — combined quant + qual scoring (Pillar 5.5)
-- ---------------------------------------------------------------------------
create table if not exists lead_scores (
  lead_id          text primary key references leads(id) on delete cascade,
  quant_score      numeric,
  qual_score       numeric,
  combined_score   numeric,
  qual_summary     text,
  qual_red_flags   text[],
  qual_green_flags text[],
  transcript_embed vector(1536),
  scored_at        timestamptz not null default now(),
  scored_model     text
);
