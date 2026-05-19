/**
 * Commission calculator.
 *
 * Given a date range + the team roster from `commission-config.ts`, produces
 * a per-person breakdown of what's owed this period:
 *
 *   - Eligible deals / payments
 *   - Commissionable base (after Split-It 15% deduction)
 *   - Rate applied (paid vs organic split by deal)
 *   - PIF bonuses on top
 *   - Monthly floor enforcement (marketing manager)
 *   - CSM bonus add-ons (TP reviews, testimonials)
 *
 * Pure function — takes Supabase-fetched rows and returns a structured report.
 * No DB writes. The UI layer handles "mark as paid" via a separate table.
 */

import 'server-only';
import {
  DEFAULT_TEAM,
  PIF_BONUS_BY_PROGRAM,
  SPLIT_IT_FEE,
  PROCESSING_FEE,
  attributionTypeForSource,
  canonicalName,
  normalizeOfferToProgram,
  type TeamMember,
} from '@/lib/commission-config';

// ─── INPUT ROW SHAPES ─────────────────────────────────────────────────────────

export interface DealRow {
  id: string;
  date_closed: string;             // YYYY-MM-DD
  name: string | null;
  email: string | null;
  offer: string | null;            // "Program B" | "Program A" | "Program C" | other
  cash_collected: number;          // upfront cash on the deal
  contracted_revenue: number;      // full deal value
  source: string | null;           // "Facebook Ads" | "YouTube" | etc
  closer: string | null;           // raw closer name, run through canonicalName()
  payment_structure?: string | null;   // "Paid In Full" | "Payment Plan" | "Split-It" | etc
  close_path?: string | null;      // 'funnel' (booking→close) | 'direct' (DM/off-platform)
  deal_type?: string | null;       // 'new' | 'upsell' | 'renewal' — derived in sync/deals
}

export interface PaymentRow {
  id: string;
  date: string;
  email: string;
  amount: number;                  // gross
  final_amount: number;            // net after processor fees
  status: string;                  // 'paid' | 'refunded' | ...
  payment_type: string;            // 'new' | 'renewal' | 'refund'
  payment_structure: string;
  offer: string | null;
  processor: string;
  deal_id: string | null;          // linked t06 deal
}

export interface AdSpendRow {
  date: string;
  spend: number;                   // US dollars
}

export interface CommissionInput {
  periodStart: string;             // YYYY-MM-DD inclusive
  periodEnd: string;               // YYYY-MM-DD inclusive
  deals: DealRow[];
  payments: PaymentRow[];
  adSpend?: AdSpendRow[];          // for marketing manager's profit calc
  csmBonuses?: Record<string, { tpReviews: number; testimonials: number }>; // manual input
}

// ─── OUTPUT SHAPES ────────────────────────────────────────────────────────────

export interface PersonCommission {
  name: string;
  role: TeamMember['role'];
  roleLabel: string;

  eligibleDealCount: number;
  grossBase: number;                // pre–Split-It gross used for the calc
  splitItDeducted: number;          // how much Split-It took off the top
  commissionableBase: number;       // what % gets applied to
  ratePaidDeals: number;            // # deals where paid-ads rate was used
  rateOrganicDeals: number;         // # deals where organic rate was used
  commission: number;               // raw % × base
  pifBonusTotal: number;
  csmBonusTotal: number;
  floorAdjustment: number;          // positive if floor kicked in
  totalOwed: number;                // final number — the row users care about

  lineItems: CommissionLineItem[];
  notes: string[];
}

export interface CommissionLineItem {
  dealId: string | null;
  paymentId: string | null;
  date: string;
  prospect: string;
  offer: string | null;
  source: string | null;
  attribution: 'paid' | 'organic';
  grossAmount: number;
  afterSplitIt: number;
  rateApplied: number;
  commissionAmount: number;
  pifBonus: number;
  note?: string;
}

export interface CommissionReport {
  periodStart: string;
  periodEnd: string;
  people: PersonCommission[];
  totals: {
    commissionPaidOut: number;
    pifBonusesPaidOut: number;
    csmBonusesPaidOut: number;
    grandTotal: number;
  };
  orphanedPayments: PaymentRow[];   // payments w/o a linked deal — can't attribute
  generatedAt: string;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function isSplitIt(paymentStructure: string | null | undefined): boolean {
  if (!paymentStructure) return false;
  return /split.?it|financing|financed/i.test(paymentStructure);
}

function isPIF(paymentStructure: string | null | undefined): boolean {
  if (!paymentStructure) return false;
  // Must be TRUE PIF — not Split-It, not payment plan
  if (isSplitIt(paymentStructure)) return false;
  if (/payment.?plan|installment/i.test(paymentStructure)) return false;
  return /paid.in.full|full.?pay|pif/i.test(paymentStructure);
}

function inPeriod(dateStr: string, start: string, end: string): boolean {
  return dateStr >= start && dateStr <= end;
}

/** Apply Split-It deduction to a gross amount. Returns the commissionable base. */
function applySplitIt(grossAmount: number, paymentStructure: string | null): number {
  if (isSplitIt(paymentStructure)) {
    return grossAmount * (1 - SPLIT_IT_FEE);
  }
  return grossAmount;
}

// ─── CORE CALCULATION ─────────────────────────────────────────────────────────

export function calculateCommissions(input: CommissionInput): CommissionReport {
  const { periodStart, periodEnd, deals, payments, adSpend = [], csmBonuses = {} } = input;

  const dealsInPeriod = deals.filter(d => inPeriod(d.date_closed, periodStart, periodEnd));
  const paidPaymentsInPeriod = payments.filter(
    p => p.status === 'paid' && inPeriod(p.date, periodStart, periodEnd),
  );

  const totalAdSpend = adSpend
    .filter(a => inPeriod(a.date, periodStart, periodEnd))
    .reduce((s, a) => s + (a.spend ?? 0), 0);

  const people: PersonCommission[] = DEFAULT_TEAM.map(member => {
    return computePersonCommission(member, {
      dealsInPeriod,
      paidPaymentsInPeriod,
      totalAdSpend,
      csmBonus: csmBonuses[member.name],
    });
  });

  // Orphaned payments — status=paid in period but no linked deal. We can't
  // attribute commission on these. Display to the operator for manual review.
  const orphanedPayments = paidPaymentsInPeriod.filter(p => !p.deal_id);

  const totals = {
    commissionPaidOut: people.reduce((s, p) => s + p.commission + p.floorAdjustment, 0),
    pifBonusesPaidOut: people.reduce((s, p) => s + p.pifBonusTotal, 0),
    csmBonusesPaidOut: people.reduce((s, p) => s + p.csmBonusTotal, 0),
    grandTotal: people.reduce((s, p) => s + p.totalOwed, 0),
  };

  return {
    periodStart,
    periodEnd,
    people,
    totals,
    orphanedPayments,
    generatedAt: new Date().toISOString(),
  };
}

interface ComputeContext {
  dealsInPeriod: DealRow[];
  paidPaymentsInPeriod: PaymentRow[];
  totalAdSpend: number;
  csmBonus: { tpReviews: number; testimonials: number } | undefined;
}

function computePersonCommission(member: TeamMember, ctx: ComputeContext): PersonCommission {
  switch (member.role) {
    case 'closer':
      return closerCommission(member, ctx);
    case 'setter':
      return setterCommission(member, ctx);
    case 'ig_dm_closer':
      return igDmCloserCommission(member, ctx);
    case 'sales_manager':
      return salesManagerCommission(member, ctx);
    case 'marketing_manager':
      return marketingManagerCommission(member, ctx);
    case 'csm':
      return csmCommission(member, ctx);
    case 'content_manager':
      return contentManagerCommission(member);
    default:
      return emptyPerson(member);
  }
}

// ─── CLOSERS ──────────────────────────────────────────────────────────────────

function closerCommission(member: TeamMember, ctx: ComputeContext): PersonCommission {
  const canonical = member.name;
  const myDeals = ctx.dealsInPeriod.filter(d => canonicalName(d.closer) === canonical);

  let commissionableBase = 0;
  let splitItDeducted = 0;
  let commission = 0;
  let pifBonusTotal = 0;
  let ratePaidDeals = 0;
  let rateOrganicDeals = 0;
  const lineItems: CommissionLineItem[] = [];

  for (const deal of myDeals) {
    const attribution = attributionTypeForSource(deal.source);
    const rate = attribution === 'paid' ? member.ratePaid : member.rateOrganic;
    if (attribution === 'paid') ratePaidDeals++;
    else rateOrganicDeals++;

    const grossBase = deal.contracted_revenue || 0;
    const afterSplitIt = applySplitIt(grossBase, deal.payment_structure ?? null);
    const thisSplitItDed = grossBase - afterSplitIt;
    const thisCommission = afterSplitIt * rate;

    // PIF bonus — normalize offer ("Program A (Lower-Ticket)" → "Program A")
    let pifBonus = 0;
    if (member.pifBonusEligible && isPIF(deal.payment_structure ?? null)) {
      const program = normalizeOfferToProgram(deal.offer);
      const bonus = PIF_BONUS_BY_PROGRAM[program] ?? 0;
      pifBonus = bonus;
    }

    commissionableBase += afterSplitIt;
    splitItDeducted += thisSplitItDed;
    commission += thisCommission;
    pifBonusTotal += pifBonus;

    lineItems.push({
      dealId: deal.id,
      paymentId: null,
      date: deal.date_closed,
      prospect: deal.name ?? '',
      offer: deal.offer,
      source: deal.source,
      attribution,
      grossAmount: grossBase,
      afterSplitIt,
      rateApplied: rate,
      commissionAmount: thisCommission,
      pifBonus,
    });
  }

  const totalOwed = commission + pifBonusTotal;
  return {
    name: member.name,
    role: member.role,
    roleLabel: 'Closer',
    eligibleDealCount: myDeals.length,
    grossBase: myDeals.reduce((s, d) => s + (d.contracted_revenue ?? 0), 0),
    splitItDeducted,
    commissionableBase,
    ratePaidDeals,
    rateOrganicDeals,
    commission,
    pifBonusTotal,
    csmBonusTotal: 0,
    floorAdjustment: 0,
    totalOwed,
    lineItems,
    notes: [member.notes],
  };
}

// ─── SETTERS ──────────────────────────────────────────────────────────────────

function setterCommission(member: TeamMember, ctx: ComputeContext): PersonCommission {
  // Setter commission — the operator rule (2026-04-23):
  //   • BASE = cash_collected (upfront only), NOT contracted_revenue (which
  //     includes back-end / payment plan installments / renewals).
  //   • Only deals the setter specifically set — direct closes (DM, referrals,
  //     off-platform) are excluded via close_path='direct' filter.
  //   • (Future) Once t03_bookings.setter_assigned is populated via Calendly,
  //     add a per-deal filter here like canonicalName(deal.setter_assigned) === member.name.
  //     Today that field doesn't exist so we attribute all funnel closes to
  //     the one active setter (Setter One). If you add another setter this WILL
  //     double-count — wire setter_assigned before then.
  let commissionableBase = 0;
  let splitItDeducted = 0;
  let commission = 0;
  let ratePaidDeals = 0;
  let rateOrganicDeals = 0;
  const lineItems: CommissionLineItem[] = [];
  const eligibleDeals: DealRow[] = [];

  for (const deal of ctx.dealsInPeriod) {
    // Skip IG-DM-sourced deals (handled by ig_dm_closer member)
    if ((deal.source ?? '').toLowerCase().includes('ig dm')) continue;

    // Skip direct-path closes — no setter call → no setter commission
    if (deal.close_path === 'direct') continue;

    eligibleDeals.push(deal);

    const attribution = attributionTypeForSource(deal.source);
    const rate = attribution === 'paid' ? member.ratePaid : member.rateOrganic;
    if (attribution === 'paid') ratePaidDeals++;
    else rateOrganicDeals++;

    // UPFRONT CASH only — not contracted_revenue.
    // contracted_revenue was including the full deal value including back-end.
    const grossBase = deal.cash_collected || 0;
    const afterSplitIt = applySplitIt(grossBase, deal.payment_structure ?? null);
    const thisCommission = afterSplitIt * rate;

    commissionableBase += afterSplitIt;
    splitItDeducted += (grossBase - afterSplitIt);
    commission += thisCommission;

    lineItems.push({
      dealId: deal.id,
      paymentId: null,
      date: deal.date_closed,
      prospect: deal.name ?? '',
      offer: deal.offer,
      source: deal.source,
      attribution,
      grossAmount: grossBase,
      afterSplitIt,
      rateApplied: rate,
      commissionAmount: thisCommission,
      pifBonus: 0,
    });
  }

  return {
    name: member.name,
    role: member.role,
    roleLabel: 'Setter',
    eligibleDealCount: eligibleDeals.length,
    grossBase: eligibleDeals.reduce((s, d) => s + (d.cash_collected ?? 0), 0),
    splitItDeducted,
    commissionableBase,
    ratePaidDeals,
    rateOrganicDeals,
    commission,
    pifBonusTotal: 0,
    csmBonusTotal: 0,
    floorAdjustment: 0,
    totalOwed: commission,
    lineItems,
    notes: [member.notes, 'Base = upfront cash_collected only (not contracted_revenue).'],
  };
}

// ─── IG DM CLOSER (4% per payment as it lands) ────────────────────────────────

function igDmCloserCommission(member: TeamMember, ctx: ComputeContext): PersonCommission {
  // Attribute payments where the lead source is IG DM
  const igPayments = ctx.paidPaymentsInPeriod.filter(
    p => (p.offer ?? '').toLowerCase().includes('ig') ||
         (p.payment_structure ?? '').toLowerCase().includes('ig'),
  );

  let commissionableBase = 0;
  let commission = 0;
  const lineItems: CommissionLineItem[] = [];

  for (const p of igPayments) {
    const rate = member.ratePaid;
    const thisCommission = (p.final_amount ?? 0) * rate;
    commissionableBase += p.final_amount ?? 0;
    commission += thisCommission;
    lineItems.push({
      dealId: p.deal_id,
      paymentId: p.id,
      date: p.date,
      prospect: p.email,
      offer: p.offer,
      source: 'IG DM',
      attribution: 'organic',
      grossAmount: p.amount,
      afterSplitIt: p.final_amount ?? 0,
      rateApplied: rate,
      commissionAmount: thisCommission,
      pifBonus: 0,
    });
  }

  return {
    name: member.name,
    role: member.role,
    roleLabel: 'IG DM Closer',
    eligibleDealCount: igPayments.length,
    grossBase: igPayments.reduce((s, p) => s + (p.amount ?? 0), 0),
    splitItDeducted: 0,
    commissionableBase,
    ratePaidDeals: 0,
    rateOrganicDeals: igPayments.length,
    commission,
    pifBonusTotal: 0,
    csmBonusTotal: 0,
    floorAdjustment: 0,
    totalOwed: commission,
    lineItems,
    notes: [member.notes],
  };
}

// ─── SALES MANAGER (6% upfront only, deducts DM + non-managed closer deals) ──

function salesManagerCommission(member: TeamMember, ctx: ComputeContext): PersonCommission {
  const managedClosers = DEFAULT_TEAM.filter(m => m.role === 'closer').map(m => m.name);
  const eligible = ctx.dealsInPeriod.filter(d => {
    const cl = canonicalName(d.closer);
    if (!cl || !managedClosers.includes(cl)) return false;  // only managed closers
    if ((d.source ?? '').toLowerCase().includes('ig dm')) return false; // exclude DM closes
    return true;
  });

  let commissionableBase = 0;
  let commission = 0;
  const lineItems: CommissionLineItem[] = [];

  for (const deal of eligible) {
    const upfront = deal.cash_collected ?? 0;
    const afterSplitIt = applySplitIt(upfront, deal.payment_structure ?? null);
    const thisCommission = afterSplitIt * member.ratePaid; // same rate regardless of attribution
    commissionableBase += afterSplitIt;
    commission += thisCommission;
    lineItems.push({
      dealId: deal.id,
      paymentId: null,
      date: deal.date_closed,
      prospect: deal.name ?? '',
      offer: deal.offer,
      source: deal.source,
      attribution: attributionTypeForSource(deal.source),
      grossAmount: upfront,
      afterSplitIt,
      rateApplied: member.ratePaid,
      commissionAmount: thisCommission,
      pifBonus: 0,
    });
  }

  return {
    name: member.name,
    role: member.role,
    roleLabel: 'Sales Manager',
    eligibleDealCount: eligible.length,
    grossBase: eligible.reduce((s, d) => s + (d.cash_collected ?? 0), 0),
    splitItDeducted: eligible.reduce((s, d) => s + ((d.cash_collected ?? 0) - applySplitIt(d.cash_collected ?? 0, d.payment_structure ?? null)), 0),
    commissionableBase,
    ratePaidDeals: eligible.length,
    rateOrganicDeals: 0,
    commission,
    pifBonusTotal: 0,
    csmBonusTotal: 0,
    floorAdjustment: 0,
    totalOwed: commission,
    lineItems,
    notes: [member.notes],
  };
}

// ─── MARKETING MANAGER (7.5% ad funnel profit, floor $7,500/mo) ───────────────

function marketingManagerCommission(member: TeamMember, ctx: ComputeContext): PersonCommission {
  // Profit = upfront cash (paid-ads only) - ad spend - processing fees
  const adDeals = ctx.dealsInPeriod.filter(d => attributionTypeForSource(d.source) === 'paid');

  const upfrontFromAds = adDeals.reduce((s, d) => {
    const upfront = d.cash_collected ?? 0;
    return s + applySplitIt(upfront, d.payment_structure ?? null);
  }, 0);
  const processing = upfrontFromAds * PROCESSING_FEE;
  const profit = upfrontFromAds - ctx.totalAdSpend - processing;
  const commission = Math.max(0, profit) * member.ratePaid;

  // Floor
  const floor = member.floor ?? 0;
  const floorAdjustment = commission < floor ? floor - commission : 0;
  const totalOwed = Math.max(commission, floor);

  return {
    name: member.name,
    role: member.role,
    roleLabel: 'Marketing Manager',
    eligibleDealCount: adDeals.length,
    grossBase: upfrontFromAds,
    splitItDeducted: 0,
    commissionableBase: Math.max(0, profit),
    ratePaidDeals: adDeals.length,
    rateOrganicDeals: 0,
    commission,
    pifBonusTotal: 0,
    csmBonusTotal: 0,
    floorAdjustment,
    totalOwed,
    lineItems: [],  // roll-up only — individual deal breakdown for mkt mgr is noisy
    notes: [
      member.notes,
      `Upfront (paid ads, post-SplitIt): $${upfrontFromAds.toFixed(2)}`,
      `Ad spend in period: $${ctx.totalAdSpend.toFixed(2)}`,
      `Processing (3%): $${processing.toFixed(2)}`,
      `Profit: $${profit.toFixed(2)}`,
      floor > 0 && commission < floor ? `⚠ Floor ($${floor}) kicked in — commission was $${commission.toFixed(2)}` : '',
    ].filter(Boolean),
  };
}

// ─── CSMs (10% renewals + TP + testimonials) ──────────────────────────────────

function csmCommission(member: TeamMember, ctx: ComputeContext): PersonCommission {
  // CSMs get 10% on upsell/renewal deals for clients in THEIR program.
  //
  // Attribution rule (the operator 2026-04-23):
  //   - Attribute by PROGRAM: each CSM owns one program's client base.
  //     CSM One → Program A, CSM Two → Program B, Founder Two → Program C.
  //   - Filter t06 rows where deal_type ∈ ('upsell', 'renewal') AND
  //     normalized program matches member's assigned program(s).
  //   - Base = upfront cash_collected (consistent with setter rule).
  //
  // The `closer` field on each deal shows who ran the upsell call. The CSM
  // may or may not be the same person. If a CSM also closes their own
  // upsell, they receive both the closer commission (when configured as a
  // closer) and the CSM commission. Renewals aren't in the closer bucket
  // by default — adjust as needed for your business.
  const programByCSM: Record<string, string[]> = {
    'CSM One': ['Program A'],
    'CSM Two': ['Program B'],
  };
  const myPrograms = programByCSM[member.name] ?? [];

  const myDeals = ctx.dealsInPeriod.filter(d => {
    if (d.deal_type !== 'upsell' && d.deal_type !== 'renewal') return false;
    const normalizedProgram = normalizeOfferToProgram(d.offer);
    return myPrograms.includes(normalizedProgram);
  });

  let commissionableBase = 0;
  let splitItDeducted = 0;
  let commission = 0;
  const lineItems: CommissionLineItem[] = [];

  for (const deal of myDeals) {
    const rate = member.ratePaid; // 10%
    const grossBase = deal.cash_collected || 0;
    const afterSplitIt = applySplitIt(grossBase, deal.payment_structure ?? null);
    const thisCommission = afterSplitIt * rate;

    commissionableBase += afterSplitIt;
    splitItDeducted += (grossBase - afterSplitIt);
    commission += thisCommission;

    lineItems.push({
      dealId: deal.id,
      paymentId: null,
      date: deal.date_closed,
      prospect: deal.name ?? deal.email ?? '',
      offer: deal.offer,
      source: deal.source,
      attribution: 'organic',
      grossAmount: grossBase,
      afterSplitIt,
      rateApplied: rate,
      commissionAmount: thisCommission,
      pifBonus: 0,
      note: `${deal.deal_type} · closed by ${deal.closer ?? '?'}`,
    });
  }

  // TP reviews + testimonials (manual input from csmBonuses — bonus UI to come)
  const bonusInputs = ctx.csmBonus ?? { tpReviews: 0, testimonials: 0 };
  const csmBonusTotal = (bonusInputs.tpReviews * 50) + (bonusInputs.testimonials * 100);

  return {
    name: member.name,
    role: member.role,
    roleLabel: 'CSM',
    eligibleDealCount: myDeals.length,
    grossBase: myDeals.reduce((s, d) => s + (d.cash_collected ?? 0), 0),
    splitItDeducted,
    commissionableBase,
    ratePaidDeals: 0,
    rateOrganicDeals: myDeals.length,
    commission,
    pifBonusTotal: 0,
    csmBonusTotal,
    floorAdjustment: 0,
    totalOwed: commission + csmBonusTotal,
    lineItems,
    notes: [
      member.notes,
      `10% on upsell + renewal deals for ${myPrograms.join(' / ')}`,
      `TP reviews: ${bonusInputs.tpReviews} × $50 = $${bonusInputs.tpReviews * 50}`,
      `Testimonials: ${bonusInputs.testimonials} × $100 = $${bonusInputs.testimonials * 100}`,
    ],
  };
}

// ─── CONTENT MANAGER (per-piece, manual input for now) ────────────────────────

function contentManagerCommission(member: TeamMember): PersonCommission {
  // Piece counts are manually entered in the UI for now. Default to zeros —
  // UI will allow editing. Could be automated later by counting video drops
  // in a Drive folder / IG post scraper.
  return {
    name: member.name,
    role: member.role,
    roleLabel: 'Content Manager',
    eligibleDealCount: 0,
    grossBase: 0,
    splitItDeducted: 0,
    commissionableBase: 0,
    ratePaidDeals: 0,
    rateOrganicDeals: 0,
    commission: 0,
    pifBonusTotal: 0,
    csmBonusTotal: 0,
    floorAdjustment: 0,
    totalOwed: 0,
    lineItems: [],
    notes: [member.notes, 'Enter piece counts in the UI to compute this month.'],
  };
}

function emptyPerson(member: TeamMember): PersonCommission {
  return {
    name: member.name,
    role: member.role,
    roleLabel: member.role,
    eligibleDealCount: 0,
    grossBase: 0,
    splitItDeducted: 0,
    commissionableBase: 0,
    ratePaidDeals: 0,
    rateOrganicDeals: 0,
    commission: 0,
    pifBonusTotal: 0,
    csmBonusTotal: 0,
    floorAdjustment: 0,
    totalOwed: 0,
    lineItems: [],
    notes: [member.notes],
  };
}
