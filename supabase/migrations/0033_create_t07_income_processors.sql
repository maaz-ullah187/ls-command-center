-- ============================================================
-- 0033: Create t07_income_processors table
-- ============================================================
-- Recovery migration: the original CREATE TABLE for t07_income_processors
-- was missing from the migration history, but later migrations
-- (0019 revenue_category, 0024 payment_type_buckets, 0026 excluded bucket)
-- assumed the table existed. The sync/income route fails with
-- "Could not find the table public.t07_income_processors" without this.
--
-- This file creates the table with the FINAL schema — all column additions
-- and the latest payment_type CHECK constraint folded in — so it stands
-- alone if you're bootstrapping a fresh Supabase project.
--
-- Source of truth for the schema: src/app/api/sync/income/route.ts
-- (Whop + Fanbasis upserts), plus downstream readers in
-- src/app/api/main/* and src/app/api/billing/categorize.
-- ============================================================

CREATE TABLE IF NOT EXISTS t07_income_processors (
  -- Primary key: Whop payment id, or "fanbasis-<id>", or "<id>-refund"
  -- for synthetic refund rows. Always a stable, processor-derived string.
  id                  text         PRIMARY KEY,

  -- When the payment was charged (YYYY-MM-DD).
  date                date         NOT NULL,

  -- Customer identity. Email is the join key to t06_deals_closed for
  -- deal_id / closer enrichment, so it should always be populated by sync.
  name                text,
  email               text         NOT NULL,

  -- Lifecycle status. Sync maps Whop's raw status into this vocabulary.
  status              text         NOT NULL
                                   CHECK (status IN (
                                     'paid',
                                     'pending',
                                     'failed',
                                     'refunded',
                                     'chargedback'
                                   )),

  -- Categorization bucket. The Daily Review Queue lets operators reclassify
  -- via /api/billing/categorize; sync preserves manual edits.
  -- Legacy values ('new','renewal','upgrade') stay valid for back-compat
  -- with rows that pre-date migration 0024's vocabulary expansion.
  payment_type        text         NOT NULL DEFAULT 'other'
                                   CHECK (payment_type IN (
                                     'new_client',
                                     'account_receivable',
                                     'upsell_renewal',
                                     'mastermind',
                                     'refund',
                                     'excluded',
                                     'other',
                                     -- legacy, kept for back-compat
                                     'new',
                                     'renewal',
                                     'upgrade'
                                   )),

  -- "Full Pay" vs "Payment Plan" — derived from Whop's billing_reason.
  payment_structure   text,

  -- Closer enrichment — populated from t06_deals_closed on the email join.
  closer              text,

  -- Product / offer name (Whop productName or Fanbasis productTitle).
  -- Free-form; operators can normalize to canonical buckets
  -- ('Program A', 'Program B', 'Program C') via the queue.
  offer               text,

  -- True if the customer used third-party financing (Affirm, etc.).
  financing_used      boolean      NOT NULL DEFAULT false,

  -- Gross amount charged. Negative for refund/chargeback rows so SUM()
  -- across the table nets out automatically.
  amount              numeric(12,2) NOT NULL,

  -- Processor fee as a percentage (e.g. 2.9). Rounded to 2 decimals.
  processing_pct      numeric(6,2)  NOT NULL DEFAULT 0,

  -- Net amount after processor fees. Negative for refund rows.
  -- This is the field most revenue cards aggregate.
  final_amount        numeric(12,2) NOT NULL,

  -- Which upstream processor this row came from.
  processor           text         NOT NULL
                                   CHECK (processor IN ('whop', 'fanbasis')),

  -- Direct deep-link to the transaction in the processor's dashboard.
  -- NULL for Fanbasis (no public transaction URL).
  payment_link        text,

  -- Free-form notes (e.g. refund reason, subscription status).
  notes               text,

  -- FK-style link to t06_deals_closed. Nullable: many payments will not
  -- have a matching deal record (e.g. AR installments before a deal was
  -- ever logged in Slack #new-clients).
  deal_id             text,

  -- Revenue donut bucket (Monthly view). Added in migration 0019 — kept
  -- nullable because historical rows weren't backfilled.
  revenue_category    text         CHECK (
                                     revenue_category IS NULL
                                     OR revenue_category IN ('new', 'renewal', 'upsell', 'refund')
                                   ),

  -- Last-touched timestamp. Used by /api/monitor/staleness to detect when
  -- the 6-hour sync hasn't run (cadence: 120 min).
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────
-- Most dashboard queries filter by date range (revenue cards, projections,
-- monthly composition, weekly checklists).
CREATE INDEX IF NOT EXISTS idx_t07_date
  ON t07_income_processors (date);

-- payment_type is the primary group-by key for revenue buckets / composition.
CREATE INDEX IF NOT EXISTS idx_t07_payment_type_date
  ON t07_income_processors (payment_type, date);

-- status filter is used in nearly every aggregation (status = 'paid').
CREATE INDEX IF NOT EXISTS idx_t07_status_date
  ON t07_income_processors (status, date);

-- email is the join key for the 14-day new-client window rule + deal lookup.
CREATE INDEX IF NOT EXISTS idx_t07_email
  ON t07_income_processors (lower(email));

-- revenue_category index added by migration 0019 for the Monthly donut.
CREATE INDEX IF NOT EXISTS idx_t07_revenue_category
  ON t07_income_processors (revenue_category, date);

-- Staleness monitor reads updated_at.
CREATE INDEX IF NOT EXISTS idx_t07_updated_at
  ON t07_income_processors (updated_at);
