/**
 * Commission configuration for the entire sales + marketing + content team.
 *
 * Source: "AI Offer - Commission Structure & Earnings - Addi's Revisions (for Review)"
 *         shared by the operator 2026-04-23.
 *
 * ⚠️ THIS PDF IS MARKED "FOR REVIEW". Rates below are encoded verbatim from
 * that draft. If Addi's final structure differs, update this file only —
 * everything in /commissions reads from here. No database migration needed
 * for rate changes.
 *
 * Global rules (applied in order):
 *   1. Split-It (financing): 15% deducted off the top BEFORE any commission %.
 *      Example: $10K collected via Split-It → commissionable base = $8,500.
 *   2. Refunds: deducted from commission in the period the refund lands.
 *   3. Chargebacks: same treatment as refunds.
 *   4. Paid-in-Full bonus: only on true PIF deals (NOT Split-It, NOT payment plan).
 *   5. Source split (paid vs organic): determined per deal from t01_leads.source.
 */

export interface TeamMember {
  name: string;
  role: 'setter' | 'closer' | 'ig_dm_closer' | 'csm' | 'sales_manager' | 'marketing_manager' | 'content_manager';
  rateOrganic: number;                      // % as decimal (0.08 = 8%)
  ratePaid: number;                         // % applied to paid-ads-sourced deals
  basedOn:
    | 'upfront_cash'                        // Upfront cash collected (deposit) only
    | 'total_package'                       // Full deal value — includes all payment plan installments as collected
    | 'cash_collected'                      // Every payment as it lands (recurring, renewals, installments)
    | 'all_new_cash'                        // All UPFRONT new cash, not renewals
    | 'ad_funnel_profit'                    // Profit from ad-sourced closes only (revenue - ad spend - processing)
    | 'upfront_cash_only';                  // Like upfront_cash but explicitly excludes payment plans & renewals
  floor?: number;                           // Monthly minimum $ payout (if commission < floor, pay floor)
  pifBonusEligible?: boolean;               // True = gets PIF_BONUS_BY_PROGRAM on PIF deals
  notes: string;
}

export const DEFAULT_TEAM: TeamMember[] = [
  // ─── CLOSERS (10% paid / 8% organic + PIF bonus) ──────────────────────────
  {
    name: 'Closer One',
    role: 'closer',
    rateOrganic: 0.08,
    ratePaid: 0.10,
    basedOn: 'total_package',
    pifBonusEligible: true,
    notes: 'Closer. Includes payment plan collections. PIF bonus: $200 ProgB / $100 ProgA.',
  },
  {
    name: 'Closer Two',
    role: 'closer',
    rateOrganic: 0.08,
    ratePaid: 0.10,
    basedOn: 'total_package',
    pifBonusEligible: true,
    notes: 'Closer. Includes payment plan collections. PIF bonus: $200 ProgB / $100 ProgA.',
  },
  {
    name: 'Closer Three',
    role: 'closer',
    rateOrganic: 0.08,
    ratePaid: 0.10,
    basedOn: 'total_package',
    pifBonusEligible: true,
    notes: 'Closer. Same terms as the other closers.',
  },

  // ─── SETTERS (5% paid / 8% organic) ───────────────────────────────────────
  {
    name: 'Setter One',
    role: 'setter',
    rateOrganic: 0.08,
    ratePaid: 0.05,
    basedOn: 'total_package',
    pifBonusEligible: false,
    notes: 'Setter (triage calls → demo bookings). Includes payment plan collections. Split-It 15% deducted first.',
  },

  // ─── IG DM CLOSER (4% of cash collected on full package) ──────────────────
  {
    name: 'James',
    role: 'ig_dm_closer',
    rateOrganic: 0.04,
    ratePaid: 0.04,
    basedOn: 'cash_collected',
    pifBonusEligible: false,
    notes: '4% of cash collected per payment as it lands. Sample $15K deal split 3×$5K = $200/payment ($600/deal). NOT paid on renewals.',
  },

  // ─── SALES MANAGER (6% flat, upfront only) ────────────────────────────────
  {
    name: 'Team Member',
    role: 'sales_manager',
    rateOrganic: 0.06,
    ratePaid: 0.06,
    basedOn: 'upfront_cash_only',
    pifBonusEligible: false,
    notes: '6% flat on upfront cash ONLY. No payment plans, no backend retainer, no placement fees. Deducts closes via DM or from non-managed closers.',
  },

  // ─── MARKETING MANAGER (7.5% ad funnel profit, floor $7,500/mo) ───────────
  {
    name: 'Marketing Manager',
    role: 'marketing_manager',
    rateOrganic: 0,
    ratePaid: 0.075,
    basedOn: 'ad_funnel_profit',
    floor: 7500,
    pifBonusEligible: false,
    notes: '7.5% of ad funnel profit. Profit = Upfront Cash - Ad Spend - Processing. NO payment plans, NO backend. Floor $7,500/mo.',
  },

  // ─── CSMs (10% renewals/upsells + TP + testimonials) ──────────────────────
  {
    name: 'CSM One',
    role: 'csm',
    rateOrganic: 0.10,
    ratePaid: 0.10,
    basedOn: 'cash_collected',
    pifBonusEligible: false,
    notes: 'CSM — Program A board. 10% on upsell/renewal cash. $50/TP review + $100/testimonial. NO initial-sale commission.',
  },
  {
    name: 'CSM Two',
    role: 'csm',
    rateOrganic: 0.10,
    ratePaid: 0.10,
    basedOn: 'cash_collected',
    pifBonusEligible: false,
    notes: 'CSM — Program B board. 10% on upsell/renewal cash. $50/TP + $100/testimonial.',
  },
  // NOTE (the operator 2026-04-23): Founder Two is a co-founder — NOT a
  // commissioned CSM. Program C upsells/renewals accrue no CSM commission.
  // If you ever hire a dedicated Program C CSM, add them back here with
  // programByCSM mapping to ['Program C'].

  // ─── CONTENT MANAGER (per-piece rates) ────────────────────────────────────
  {
    name: 'Michael',
    role: 'content_manager',
    rateOrganic: 0,
    ratePaid: 0,
    basedOn: 'total_package',  // unused for content_manager — see CONTENT_RATES below
    pifBonusEligible: false,
    notes: 'Per-piece content rates. See CONTENT_RATES constant below for the schedule.',
  },
];

// ─── GLOBAL CONSTANTS ─────────────────────────────────────────────────────────

/** Split-It financing fee. Deducted off the top BEFORE any commission %. */
export const SPLIT_IT_FEE = 0.15;

/** @deprecated Use SPLIT_IT_FEE. Kept as alias for 3 legacy callers. */
export const FINANCING_FEE = SPLIT_IT_FEE;

/** Payment processing fee (Whop / Fanbasis). 3% typical. Already reflected in t07.final_amount, but used for the marketing-manager profit calc. */
export const PROCESSING_FEE = 0.03;

/** PIF (Paid In Full) bonus by program. Applies only to true PIF — NOT Split-It, NOT payment plan. Only closers are eligible. */
export const PIF_BONUS_BY_PROGRAM: Record<string, number> = {
  'Program A': 100,
  'Program B': 200,
  // Program C bonus not specified in Addi's PDF — default to ProgB rate as placeholder. Confirm with the operator.
  'Program C': 200,
};

/**
 * Normalize a raw t06.offer / t07.offer string to the canonical program name
 * used as a key in PIF_BONUS_BY_PROGRAM + CSM attribution.
 *
 * Real values in DB:
 *   "Program A (Lower-Ticket)"        → "Program A"
 *   "Program B (High-Ticket)"       → "Program B"
 *   "Program C Build (Done For You)"       → "Program C"
 *   "Program C Build"                      → "Program C"
 *   "Program C Coaching (Done With You)" → "Program C"
 */
export function normalizeOfferToProgram(rawOffer: string | null | undefined): string {
  if (!rawOffer) return 'Unknown';
  const o = rawOffer.toLowerCase();
  if (o.includes('launch') && o.includes('land')) return 'Program A';
  if (o.includes('program b')) return 'Program B';
  if (o.includes('ai agent') || o.includes('program c') || o.includes('ai coaching') || o.includes('dfy')) return 'Program C';
  return rawOffer;
}

/** @deprecated Use PIF_BONUS_BY_PROGRAM. Kept as alias for legacy callers. */
export const PIF_BONUS = PIF_BONUS_BY_PROGRAM;

/** CSM per-action bonuses. Separate from the 10% commission. */
export const CSM_BONUSES = {
  tpReviewCollected: 50,
  videoTestimonialReleased: 100,
};

/** Michael's content rates (per piece released). */
export const CONTENT_RATES: Record<string, number> = {
  'Standard Ad': 25,
  'TYP Video + Thumbnail (basic)': 62.5,
  'TYP Video + Thumbnail (premium)': 137.5,
  'TYP VSL': 150,
  'Full VSL': 450,
  'YouTube Video': 365,
  'IG Organic Post': 92,
};

// ─── DISPLAY HELPERS ──────────────────────────────────────────────────────────

export const ROLE_LABELS: Record<TeamMember['role'], string> = {
  setter: 'Setter',
  closer: 'Closer',
  ig_dm_closer: 'IG DM Closer',
  csm: 'CSM',
  sales_manager: 'Sales Manager',
  marketing_manager: 'Marketing Manager',
  content_manager: 'Content Manager',
};

export const ROLE_COLORS: Record<TeamMember['role'], string> = {
  setter: 'bg-purple-500/20 text-purple-400',
  closer: 'bg-blue-500/20 text-blue-400',
  ig_dm_closer: 'bg-pink-500/20 text-pink-400',
  csm: 'bg-emerald-500/20 text-emerald-400',
  sales_manager: 'bg-amber-500/20 text-amber-400',
  marketing_manager: 'bg-cyan-500/20 text-cyan-400',
  content_manager: 'bg-orange-500/20 text-orange-400',
};

// ─── MONDAY BOARD MAP (CSM client tracking) ───────────────────────────────────

// Configure your Monday.com board IDs via env vars.
export const MONDAY_BOARDS = {
  programA: process.env.MONDAY_BOARD_PROGRAM_A ?? '',
  programC: process.env.MONDAY_BOARD_PROGRAM_C ?? '',
  programB: process.env.MONDAY_BOARD_PROGRAM_B ?? '',
};

export const CSM_BOARD_MAP: Record<string, string> = {
  // 'CSM One': MONDAY_BOARDS.programA,
  // 'CSM Two': MONDAY_BOARDS.programB,
};

// ─── SOURCE ATTRIBUTION HELPER ────────────────────────────────────────────────
// Maps the `source` field on t01_leads / t06_deals_closed to "paid" vs "organic"
// for commission rate selection.

const PAID_SOURCES = new Set([
  'Facebook Ads', 'Meta Ads', 'Instagram Ads', 'Paid', 'FB', 'Paid Ads',
  'YouTube Ads', 'LinkedIn Ads',
]);

/** Returns 'paid' | 'organic' for a lead source. Defaults to 'organic' when unclear. */
export function attributionTypeForSource(source: string | null | undefined): 'paid' | 'organic' {
  if (!source) return 'organic';
  const s = source.trim();
  if (PAID_SOURCES.has(s)) return 'paid';
  return 'organic'; // YouTube, Referral, Organic IG, etc. — all organic
}

// ─── NAME NORMALIZATION ───────────────────────────────────────────────────────
// t06_deals_closed.closer is stored as Slack-normalized names. t04_call_recordings.closer_email
// uses the @example.com address. This map unifies both back to the canonical
// config name so commission attribution works regardless of which source row we see.

// Add aliases here so first-name variants and email addresses unify back
// to canonical config names. Example shape — replace with your team:
export const CLOSER_NAME_ALIASES: Record<string, string> = {
  // 'Firstname': 'Firstname Lastname',
  // 'firstname.lastname@example.com': 'Firstname Lastname',
  // Setter + manager aliases
  'Setter One': 'Setter One',
  'Setter One': 'Setter One',
};

export function canonicalName(rawName: string | null | undefined): string | null {
  if (!rawName) return null;
  const trimmed = rawName.trim();
  return CLOSER_NAME_ALIASES[trimmed] ?? CLOSER_NAME_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}
