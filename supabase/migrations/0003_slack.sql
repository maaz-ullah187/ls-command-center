-- Pillar 6: Slack integration tables
-- Run this in Supabase SQL Editor after 0001 and 0002.

-- Add missing columns to closer_eod_reports (0001 only had basics)
alter table closer_eod_reports
  add column if not exists calls_booked integer not null default 0,
  add column if not exists no_shows integer not null default 0,
  add column if not exists calls_cancelled integer not null default 0,
  add column if not exists offers_given integer not null default 0,
  add column if not exists deposits integer not null default 0,
  add column if not exists revenue_generated numeric not null default 0,
  add column if not exists feedback text,
  add column if not exists new_calls integer not null default 0,
  add column if not exists follow_up_calls integer not null default 0;

-- New client signed notifications from #new-clients
create table if not exists slack_new_clients (
  id                  text primary key,
  slack_ts            text unique not null,
  date                date not null default current_date,
  closer_name         text not null,
  program             text,
  lead_name           text,
  email               text,
  phone               text,
  source              text,
  payment_structure   text,
  cash_collected      numeric not null default 0,
  contracted_revenue  numeric not null default 0,
  payment_plan        text,
  recording_url       text,
  ghl_contact_url     text,
  key_points          text,
  created_at          timestamptz not null default now()
);
create index if not exists snc_date_idx on slack_new_clients (date);
create index if not exists snc_closer_idx on slack_new_clients (closer_name);
create index if not exists snc_email_idx on slack_new_clients (email);

-- Payment notifications from #payment-notifications
create table if not exists slack_payment_notis (
  id            text primary key,
  slack_ts      text unique not null,
  date          date not null default current_date,
  action        text not null,
  full_name     text,
  email         text,
  amount        numeric not null default 0,
  reason        text,
  created_at    timestamptz not null default now()
);
create index if not exists spn_date_idx on slack_payment_notis (date);
create index if not exists spn_action_idx on slack_payment_notis (action);
create index if not exists spn_email_idx on slack_payment_notis (email);
