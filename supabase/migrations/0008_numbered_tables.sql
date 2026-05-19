-- 0008_numbered_tables.sql
-- Reorganize all tables to numbered naming convention.
-- Migrates historical data, creates new tables for gaps, drops dead tables.
-- Run once. Idempotent via IF EXISTS guards and DO $$ blocks.

-- ============================================================
-- STEP 1: Drop FK-dependent empty tables first
-- ============================================================
drop table if exists income_processors;
drop table if exists deals_closed;
drop table if exists bookings;
drop table if exists no_shows_cancels;
drop table if exists expenses;

-- Drop dead/empty legacy tables
drop table if exists payments;
drop table if exists calls;
drop table if exists daily_metrics;
drop table if exists payment_log;

-- ============================================================
-- STEP 2: Rename tables with data to numbered convention
-- PostgreSQL automatically updates FK references on rename.
-- ============================================================
do $$ begin
  if exists (select 1 from pg_tables where tablename = 'leads' and schemaname = 'public') then
    alter table leads rename to t01_leads;
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_tables where tablename = 'ads' and schemaname = 'public') then
    alter table ads rename to t02_ads;
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_tables where tablename = 'closer_eod_reports' and schemaname = 'public') then
    alter table closer_eod_reports rename to t08_eod_reports;
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_tables where tablename = 'lead_scores' and schemaname = 'public') then
    alter table lead_scores rename to t10_lead_scores;
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_tables where tablename = 'overrides' and schemaname = 'public') then
    alter table overrides rename to t16_overrides;
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_tables where tablename = 'competitors' and schemaname = 'public') then
    alter table competitors rename to t17_competitors;
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_tables where tablename = 'csm_action_logs' and schemaname = 'public') then
    alter table csm_action_logs rename to t18_csm_actions;
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_tables where tablename = 'slack_payment_notis' and schemaname = 'public') then
    alter table slack_payment_notis rename to t19_payment_notis;
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_tables where tablename = 'slack_new_clients' and schemaname = 'public') then
    alter table slack_new_clients rename to t20_slack_new_clients;
  end if;
end $$;

-- ============================================================
-- STEP 3: Update overrides table_name values to new names
-- ============================================================
update t16_overrides set table_name = 't01_leads' where table_name = 'leads';
update t16_overrides set table_name = 't02_ads' where table_name = 'ads';
update t16_overrides set table_name = 't08_eod_reports' where table_name = 'closer_eod_reports';
update t16_overrides set table_name = 't10_lead_scores' where table_name = 'lead_scores';

-- ============================================================
-- STEP 4: Create new numbered tables
-- ============================================================

-- t03_bookings (Calendly active events)
create table if not exists t03_bookings (
  id                  text primary key,
  date_created        timestamptz not null,
  date_booked_for     timestamptz not null,
  name                text not null,
  email               text not null,
  phone               text,
  app_answers         text,
  calendar            text,
  showed              boolean,
  call_outcome        text,
  calendly_event_url  text,
  ghl_contact_id      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists t03_bookings_email_idx on t03_bookings (email);
create index if not exists t03_bookings_date_idx on t03_bookings (date_booked_for);

-- t04_no_shows_cancels (Calendly cancelled events)
create table if not exists t04_no_shows_cancels (
  id                  text primary key,
  date                timestamptz not null,
  date_booked_for     timestamptz not null,
  name                text not null,
  email               text not null,
  phone               text,
  app_answers         text,
  status              text not null check (status in ('no_show','cancelled','rescheduled')),
  reason              text,
  calendly_event_url  text,
  ghl_contact_id      text,
  created_at          timestamptz not null default now()
);
create index if not exists t04_nsc_email_idx on t04_no_shows_cancels (email);

-- t05_deals_closed (from Slack #new-clients)
create table if not exists t05_deals_closed (
  id                  text primary key,
  date_closed         date not null,
  name                text not null,
  email               text,
  phone               text,
  offer               text,
  cash_collected      numeric not null default 0,
  contracted_revenue  numeric not null default 0,
  source              text,
  closer              text,
  campaign_name       text,
  ad_set_name         text,
  ad_name             text,
  ghl_contact_id      text,
  slack_ts            text unique,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists t05_deals_email_idx on t05_deals_closed (email);
create index if not exists t05_deals_date_idx on t05_deals_closed (date_closed);
create index if not exists t05_deals_closer_idx on t05_deals_closed (closer);

-- t06_income_processors (Whop + Fanbasis payments)
create table if not exists t06_income_processors (
  id                text primary key,
  date              date not null,
  name              text,
  email             text not null,
  status            text not null check (status in ('paid','failed','refunded','pending')),
  payment_type      text not null check (payment_type in ('new','renewal','upgrade','refund','other')),
  payment_structure text,
  closer            text,
  offer             text,
  financing_used    boolean not null default false,
  amount            numeric not null default 0,
  processing_pct    numeric not null default 0,
  final_amount      numeric not null default 0,
  processor         text not null,
  notes             text,
  deal_id           text references t05_deals_closed(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists t06_income_email_idx on t06_income_processors (email);
create index if not exists t06_income_date_idx on t06_income_processors (date);
create index if not exists t06_income_processor_idx on t06_income_processors (processor);

-- t07_expenses (Mercury Banking)
create table if not exists t07_expenses (
  id                text primary key,
  date              date not null,
  transaction_name  text not null,
  expense_type      text not null check (expense_type in ('labour','marketing','overhead','program_coaches','other')),
  amount            numeric not null default 0,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists t07_expenses_date_idx on t07_expenses (date);
create index if not exists t07_expenses_type_idx on t07_expenses (expense_type);

-- t09_clients (Monday.com — active client management)
create table if not exists t09_clients (
  id            text primary key,
  name          text not null,
  status        text not null default 'Active',
  agency_name   text,
  email         text,
  phone         text,
  renewal_date  date,
  start_date    date,
  program       text,
  board_name    text,
  csm           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists t09_clients_status_idx on t09_clients (status);
create index if not exists t09_clients_csm_idx on t09_clients (csm);

-- t11_manychat_leads (ManyChat — Instagram DM keyword funnel)
create table if not exists t11_manychat_leads (
  id               text primary key,
  name             text not null,
  ig_username      text,
  profile_pic      text,
  email            text,
  stage            text,
  optin_keyword    text,
  setter           text,
  subscribed_at    timestamptz,
  last_interaction timestamptz,
  last_message     text,
  chat_link        text,
  trigger_source   text,
  ads_type         text,
  ghl_lead_id      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists t11_manychat_email_idx on t11_manychat_leads (email);
create index if not exists t11_manychat_keyword_idx on t11_manychat_leads (optin_keyword);

-- t12_content_youtube (YouTube videos)
create table if not exists t12_content_youtube (
  id                  text primary key,
  title               text not null,
  date                date not null,
  type                text not null default 'video',
  views               integer not null default 0,
  likes               integer not null default 0,
  comments            integer not null default 0,
  engagement_rate     numeric not null default 0,
  follows             integer not null default 0,
  reach               integer not null default 0,
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
create index if not exists t12_yt_date_idx on t12_content_youtube (date);

-- t13_content_instagram (Instagram posts/reels)
create table if not exists t13_content_instagram (
  id                  text primary key,
  title               text not null default '',
  date                date not null,
  type                text not null default 'post',
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
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists t13_ig_date_idx on t13_content_instagram (date);

-- t14_content_linkedin (LinkedIn posts)
create table if not exists t14_content_linkedin (
  id                  text primary key,
  title               text not null default '',
  date                date not null,
  type                text not null default 'post',
  views               integer not null default 0,
  reach               integer not null default 0,
  follows             integer not null default 0,
  engagement_rate     numeric not null default 0,
  likes               integer not null default 0,
  comments            integer not null default 0,
  shares              integer not null default 0,
  saves               integer not null default 0,
  leads               integer not null default 0,
  booked              integer not null default 0,
  showed              integer not null default 0,
  closed              integer not null default 0,
  cash_collected      numeric not null default 0,
  contracted_revenue  numeric not null default 0,
  thumbnail_url       text,
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists t14_li_date_idx on t14_content_linkedin (date);

-- t15_content_x (X / Twitter posts)
create table if not exists t15_content_x (
  id                  text primary key,
  title               text not null default '',
  date                date not null,
  type                text not null default 'post',
  views               integer not null default 0,
  reach               integer not null default 0,
  follows             integer not null default 0,
  engagement_rate     numeric not null default 0,
  likes               integer not null default 0,
  comments            integer not null default 0,
  shares              integer not null default 0,
  leads               integer not null default 0,
  booked              integer not null default 0,
  showed              integer not null default 0,
  closed              integer not null default 0,
  cash_collected      numeric not null default 0,
  contracted_revenue  numeric not null default 0,
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists t15_x_date_idx on t15_content_x (date);

-- ============================================================
-- STEP 5: Migrate content_posts → per-channel tables
-- ============================================================

insert into t12_content_youtube (
  id, title, date, type, views, likes, comments, engagement_rate,
  follows, reach, shares, saves, dm_trigger, dm_replies,
  leads, booked, showed, closed, cash_collected, contracted_revenue,
  thumbnail_url, duration, raw, created_at, updated_at
)
select
  id, coalesce(title, ''), date, type, views, likes, comments, engagement_rate,
  follows, reach, shares, saves, dm_trigger, dm_replies,
  leads, booked, showed, closed, cash_collected, contracted_revenue,
  thumbnail_url, duration, raw, created_at, updated_at
from content_posts
where channel::text = 'YouTube'
on conflict (id) do nothing;

insert into t13_content_instagram (
  id, title, date, type, views, reach, follows, engagement_rate,
  likes, comments, shares, saves, dm_trigger, dm_replies,
  leads, booked, showed, closed, cash_collected, contracted_revenue,
  thumbnail_url, raw, created_at, updated_at
)
select
  id, coalesce(title, ''), date, type, views, reach, follows, engagement_rate,
  likes, comments, shares, saves, dm_trigger, dm_replies,
  leads, booked, showed, closed, cash_collected, contracted_revenue,
  thumbnail_url, raw, created_at, updated_at
from content_posts
where channel::text = 'Instagram'
on conflict (id) do nothing;

insert into t14_content_linkedin (
  id, title, date, type, views, reach, follows, engagement_rate,
  likes, comments, shares, saves,
  leads, booked, showed, closed, cash_collected, contracted_revenue,
  thumbnail_url, raw, created_at, updated_at
)
select
  id, coalesce(title, ''), date, type, views, reach, follows, engagement_rate,
  likes, comments, shares, saves,
  leads, booked, showed, closed, cash_collected, contracted_revenue,
  thumbnail_url, raw, created_at, updated_at
from content_posts
where channel::text = 'LinkedIn'
on conflict (id) do nothing;

insert into t15_content_x (
  id, title, date, type, views, reach, follows, engagement_rate,
  likes, comments, shares,
  leads, booked, showed, closed, cash_collected, contracted_revenue,
  raw, created_at, updated_at
)
select
  id, coalesce(title, ''), date, type, views, reach, follows, engagement_rate,
  likes, comments, shares,
  leads, booked, showed, closed, cash_collected, contracted_revenue,
  raw, created_at, updated_at
from content_posts
where channel::text = 'X'
on conflict (id) do nothing;

-- ============================================================
-- STEP 6: Migrate t20_slack_new_clients → t05_deals_closed
-- ============================================================

insert into t05_deals_closed (
  id, date_closed, name, email, phone, offer,
  cash_collected, contracted_revenue, source, closer,
  ghl_contact_id, slack_ts, created_at, updated_at
)
select
  concat('slack-', slack_ts) as id,
  date::date as date_closed,
  coalesce(lead_name, closer_name, 'Unknown') as name,
  email,
  phone,
  program as offer,
  coalesce(cash_collected::numeric, 0),
  coalesce(contracted_revenue::numeric, 0),
  case
    when lower(coalesce(source,'')) like '%fb%' or lower(coalesce(source,'')) like '%facebook%'
      or lower(coalesce(source,'')) like '%paid%' or lower(coalesce(source,'')) like '%ads%' then 'Paid'
    when lower(coalesce(source,'')) like '%instagram%' or lower(coalesce(source,'')) like '%ig%' then 'Instagram'
    when lower(coalesce(source,'')) like '%youtube%' or lower(coalesce(source,'')) like '%yt%' then 'YouTube'
    when lower(coalesce(source,'')) like '%linkedin%' then 'LinkedIn'
    when lower(coalesce(source,'')) like '%referral%' or lower(coalesce(source,'')) like '%ref%' then 'Referral'
    when lower(coalesce(source,'')) like '%organic%' then 'Organic'
    else coalesce(nullif(trim(coalesce(source,'')), ''), 'Unknown')
  end as source,
  closer_name as closer,
  (regexp_match(coalesce(ghl_contact_url, ''), '/contacts/([a-zA-Z0-9]+)'))[1] as ghl_contact_id,
  slack_ts,
  now() as created_at,
  now() as updated_at
from t20_slack_new_clients
where slack_ts is not null
on conflict (slack_ts) do nothing;

-- ============================================================
-- STEP 7: Drop content_posts (data migrated above)
-- ============================================================
drop table if exists content_posts;
