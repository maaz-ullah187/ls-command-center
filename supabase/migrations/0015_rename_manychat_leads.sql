-- ============================================================
-- 0015: Rename t11_manychat_leads → t18_manychat_leads
-- ============================================================
-- Naming convention cleanup (the operator 2026-04-23). ManyChat leads
-- are a lead source, not a content channel, so moving them out
-- of the t11–t15 content block. t18 keeps them alongside lead-
-- related tables (t01 leads, etc.) while leaving t11 slot open.
-- ============================================================

alter table if exists t11_manychat_leads rename to t18_manychat_leads;
