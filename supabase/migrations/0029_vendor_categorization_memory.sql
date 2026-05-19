-- ============================================================
-- 0029: t08a_vendor_categorization_memory — learn from manual fixes
-- ============================================================
-- Per the operator (2026-04-30): "I want to confirm that whenever I fill in data,
-- like if I mark an expense as labor / marketing / overhead / coaching,
-- you learn from that and improve accuracy of new expenses."
--
-- Workflow:
--   1. Team categorizes an uncategorized expense in the queue
--      → t08_expenses.expense_type updates AND a learning row is upserted
--        here keyed by normalized vendor_pattern.
--   2. Next Mercury sync: for each new transaction, lookup vendor_pattern
--      in this table FIRST. Hit → apply learned expense_type.
--      Miss → fall back to keyword rules → if no match, lands in queue.
--   3. Over time, recurring vendors get learned, queue shrinks.
--
-- vendor_pattern is the lowercased, digit-stripped, whitespace-normalised
-- transaction_name. e.g. "UPWORK *-913284471" → "upwork".
-- ============================================================

CREATE TABLE IF NOT EXISTS t08a_vendor_categorization_memory (
  vendor_pattern  TEXT PRIMARY KEY,
  expense_type    TEXT NOT NULL,
  learned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  learned_by      TEXT,
  hit_count       INT NOT NULL DEFAULT 0,
  last_used_at    TIMESTAMPTZ,
  source_sample   TEXT  -- raw transaction_name that taught us this pattern
);

CREATE INDEX IF NOT EXISTS t08a_vendor_memory_type_idx
  ON t08a_vendor_categorization_memory (expense_type);
