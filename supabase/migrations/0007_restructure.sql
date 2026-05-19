-- LS Command Center — Schema Restructure
-- Separates data into clean, auditable tables matching the operator's data model.
-- All new tables are additive — existing tables are left intact until sync
-- workers are confirmed writing to the new tables.

-- ---------------------------------------------------------------------------
-- 1. LEADS — add missing columns to existing table
-- ---------------------------------------------------------------------------
alter table leads
  add column if not exists offer            text,           -- product/program sold (e.g. "Program B 6-Month")
  add column if not exists contact_link     text,           -- GHL contact URL for quick lookup
  add column if not exists app_answers      text;           -- full application Q&A as formatted text

-- ---------------------------------------------------------------------------
-- 2. BOOKINGS — one row per Calendly booking (active / upcoming / past)
-- Source: Calendly API
-- ---------------------------------------------------------------------------
create table if not exists bookings (
  id                  text primary key,           -- Calendly event UUID
  date_created        timestamptz not null,        -- when the booking was made
  date_booked_for     timestamptz not null,        -- scheduled call time
  name                text not null,
  email               text not null,
  phone               text,
  app_answers         text,                        -- qualification Q&A
  calendar            text,                        -- which calendar / closer
  showed              boolean,                     -- null = future, true/false = past
  call_outcome        text,                        -- Closed Won / No Decision / etc.
  calendly_event_url  text,
  ghl_contact_id      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists bookings_email_idx      on bookings (email);
create index if not exists bookings_date_idx       on bookings (date_booked_for);
create index if not exists bookings_calendar_idx   on bookings (calendar);
create index if not exists bookings_ghl_idx        on bookings (ghl_contact_id);

-- ---------------------------------------------------------------------------
-- 3. NO_SHOWS_CANCELS — cancelled or no-show bookings
-- Source: Calendly API (status = cancelled / no-show)
-- ---------------------------------------------------------------------------
create table if not exists no_shows_cancels (
  id                  text primary key,           -- Calendly event UUID
  date                timestamptz not null,        -- when cancellation was recorded
  date_booked_for     timestamptz not null,        -- original scheduled call time
  name                text not null,
  email               text not null,
  phone               text,
  app_answers         text,
  status              text not null check (status in ('no_show','cancelled','rescheduled')),
  reason              text,                        -- reason for cancelling (if provided)
  calendly_event_url  text,
  ghl_contact_id      text,
  created_at          timestamptz not null default now()
);
create index if not exists nsc_email_idx           on no_shows_cancels (email);
create index if not exists nsc_date_idx            on no_shows_cancels (date_booked_for);
create index if not exists nsc_status_idx          on no_shows_cancels (status);

-- ---------------------------------------------------------------------------
-- 4. DEALS_CLOSED — one row per closed deal
-- Source: Slack #new-clients (primary), Whop/Fanbasis for payment verification
-- ---------------------------------------------------------------------------
create table if not exists deals_closed (
  id                  text primary key,           -- slack_ts or whop payment id
  date_closed         date not null,
  name                text not null,
  email               text,
  phone               text,
  offer               text,                        -- product/program name
  cash_collected      numeric not null default 0,
  contracted_revenue  numeric not null default 0,
  source              text,                        -- Paid / YouTube / Instagram / Referral / etc.
  closer              text,
  campaign_name       text,
  ad_set_name         text,
  ad_name             text,
  ghl_contact_id      text,
  slack_ts            text unique,                 -- for dedup from Slack
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists dc_date_idx             on deals_closed (date_closed);
create index if not exists dc_email_idx            on deals_closed (email);
create index if not exists dc_closer_idx           on deals_closed (closer);
create index if not exists dc_source_idx           on deals_closed (source);

-- ---------------------------------------------------------------------------
-- 5. INCOME_PROCESSORS — every payment transaction from Whop / Fanbasis
-- Source: Whop API, Fanbasis API
-- Replaces the old `payments` table with the operator's full structure.
-- ---------------------------------------------------------------------------
create table if not exists income_processors (
  id                  text primary key,           -- processor's transaction ID
  date                date not null,
  name                text,                        -- customer name
  email               text not null,
  status              text not null check (status in ('paid','failed','refunded','pending')),
  payment_type        text not null check (payment_type in ('new','renewal','upgrade','refund','other')),
  payment_structure   text,                        -- "Full Pay" / "Payment Plan"
  closer              text,                        -- closer who closed the deal
  offer               text,                        -- product/program name
  financing_used      boolean not null default false,
  amount              numeric not null default 0,  -- gross amount charged
  processing_pct      numeric not null default 0,  -- processor fee %
  final_amount        numeric not null default 0,  -- net after processing fee
  processor           text not null,               -- "whop" / "fanbasis" / "stripe"
  notes               text,
  deal_id             text references deals_closed(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists ip_date_idx             on income_processors (date);
create index if not exists ip_email_idx            on income_processors (email);
create index if not exists ip_status_idx           on income_processors (status);
create index if not exists ip_type_idx             on income_processors (payment_type);
create index if not exists ip_processor_idx        on income_processors (processor);

-- ---------------------------------------------------------------------------
-- 6. EXPENSES — persistent Mercury banking transactions
-- Source: Mercury API (daily sync)
-- Replaces live fetch — now stored so history is preserved and auditable.
-- ---------------------------------------------------------------------------
create table if not exists expenses (
  id                  text primary key,           -- Mercury transaction ID
  date                date not null,
  transaction_name    text not null,               -- counterparty / description
  expense_type        text not null check (expense_type in ('labour','marketing','overhead','program_coaches','other')),
  amount              numeric not null default 0,  -- positive = expense
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists exp_date_idx            on expenses (date);
create index if not exists exp_type_idx            on expenses (expense_type);

-- ---------------------------------------------------------------------------
-- 7. CLOSER_EOD_REPORTS — already exists, add missing columns
-- ---------------------------------------------------------------------------
alter table closer_eod_reports
  add column if not exists contracted_revenue numeric not null default 0,
  add column if not exists show_rate          numeric,        -- computed: shown / booked
  add column if not exists close_rate         numeric;        -- computed: closed / shown

-- ---------------------------------------------------------------------------
-- 8. Indexes on existing tables that help with common dashboard queries
-- ---------------------------------------------------------------------------
create index if not exists leads_offer_idx         on leads (offer);
create index if not exists deals_closed_name_idx   on deals_closed (lower(name));
create index if not exists income_proc_closer_idx  on income_processors (closer);
