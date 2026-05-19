// src/lib/reports/main.ts
// Pure aggregation functions for the Main Dashboard. Every function takes
// already-fetched data + a {from, to} window and returns a result object.
// API routes call these.

export interface DateWindow {
  from: string; // ISO YYYY-MM-DD
  to: string;
}

export interface HeadlineKPIs {
  totalPayments: number;
  approved: number;
  failed: number;
  refunded: number;
  totalCash: number;        // approved minus refunded
  afterFinancing: number;   // totalCash minus financing fees (best-effort)
  count: number;
}

interface IncomeRow {
  amount: number;
  status?: string | null;
  payment_type?: string | null;
  source?: string | null;
  date?: string | null;
  financing_fee?: number | null;
}

const inWindow = (date: string | null | undefined, w: DateWindow): boolean => {
  if (!date) return false;
  return date >= w.from && date <= w.to;
};

/**
 * Aggregate t06_income_processors rows into the 6 headline KPI cards
 * shown at the top of the Main Dashboard (mirrors Metabase board 133).
 */
export function aggregateHeadline(rows: IncomeRow[], window: DateWindow): HeadlineKPIs {
  let approved = 0;
  let failed = 0;
  let refunded = 0;
  let financingFees = 0;
  let count = 0;

  for (const r of rows) {
    if (!inWindow(r.date, window)) continue;
    count++;
    const amt = Number(r.amount ?? 0);
    const status = (r.status ?? '').toLowerCase();
    const ptype = (r.payment_type ?? '').toLowerCase();

    if (ptype === 'refund' || amt < 0) {
      refunded += Math.abs(amt);
      continue;
    }
    if (status === 'failed' || status === 'declined') {
      failed += amt;
      continue;
    }
    // success / approved / null treated as approved
    approved += amt;
    financingFees += Number(r.financing_fee ?? 0);
  }

  const totalPayments = approved + failed + refunded;
  const totalCash = approved - refunded;
  const afterFinancing = totalCash - financingFees;

  return {
    totalPayments,
    approved,
    failed,
    refunded,
    totalCash,
    afterFinancing,
    count,
  };
}

export type RevenueCategory =
  | 'mastermind'
  | 'ar'
  | 'renewals_upsells'
  | 'new'
  | 'refund';

export interface RevenueCompositionSlice {
  category: RevenueCategory;
  amount: number;
  count: number;
}

/**
 * Group income rows for the Main Dashboard's Revenue Composition donut.
 * Buckets per the operator's spec (2026-04-28):
 *   1. Mastermind tickets   — offer ILIKE '%mastermind%'
 *   2. AR (Receivables)     — payment_type='renewal' + payment_structure='Payment Plan'
 *                             (recurring installments on existing contracts)
 *   3. Renewals & Upsells   — true renewals (Full Pay) + upgrades
 *   4. New Cash             — payment_type='new'
 *   5. Refunds              — payment_type='refund' OR amount<0
 */
export function aggregateRevenueComposition(
  rows: (IncomeRow & { offer?: string | null; payment_structure?: string | null })[],
  window: DateWindow
): RevenueCompositionSlice[] {
  const buckets: Record<RevenueCategory, { amount: number; count: number }> = {
    mastermind:        { amount: 0, count: 0 },
    ar:                { amount: 0, count: 0 },
    renewals_upsells:  { amount: 0, count: 0 },
    new:               { amount: 0, count: 0 },
    refund:            { amount: 0, count: 0 },
  };

  for (const r of rows) {
    if (!inWindow(r.date, window)) continue;
    const rawAmt = Number(r.amount ?? 0);
    const amt = Math.abs(rawAmt);
    if (amt === 0) continue;

    const offer = (r.offer ?? '').toLowerCase();
    const ptype = (r.payment_type ?? '').toLowerCase();
    const pstruct = (r.payment_structure ?? '').toLowerCase();

    // Refunds win first (regardless of offer)
    if (ptype === 'refund' || rawAmt < 0) {
      buckets.refund.amount += amt;
      buckets.refund.count += 1;
      continue;
    }

    // Mastermind takes precedence over payment_type categorization
    if (offer.includes('mastermind')) {
      buckets.mastermind.amount += amt;
      buckets.mastermind.count += 1;
      continue;
    }

    if (ptype === 'renewal' && pstruct === 'payment plan') {
      buckets.ar.amount += amt;
      buckets.ar.count += 1;
      continue;
    }

    if (ptype === 'renewal' || ptype === 'upgrade' || ptype === 'upsell') {
      buckets.renewals_upsells.amount += amt;
      buckets.renewals_upsells.count += 1;
      continue;
    }

    if (ptype === 'new' || ptype === 'initial') {
      buckets.new.amount += amt;
      buckets.new.count += 1;
      continue;
    }

    // Fallback: bucket as new cash so unclassified income still shows
    buckets.new.amount += amt;
    buckets.new.count += 1;
  }

  return (['mastermind', 'ar', 'renewals_upsells', 'new', 'refund'] as const).map((c) => ({
    category: c,
    amount: buckets[c].amount,
    count: buckets[c].count,
  }));
}

export interface FunnelBySourceRow {
  source: string;
  leads: number;
  bookings: number;
  showed: number;
  closed: number;
  cash: number;
  leadToBookPct: number;
  closePct: number;
}

/**
 * Per-source funnel for the Main Dashboard. Driven by the unified Lead[]
 * already enriched by dataSources.ts (GHL + Calendly + Whop + scoring).
 */
export function aggregateFunnelBySource<L extends {
  source?: string | null;
  date: string;
  demoBooked?: boolean;
  showStatus?: string;
  callOutcome?: string;
  cashCollected?: number;
}>(leads: L[], window: DateWindow): FunnelBySourceRow[] {
  const byKey = new Map<string, FunnelBySourceRow>();

  for (const l of leads) {
    if (!inWindow(l.date, window)) continue;
    const src = l.source && l.source.length > 0 ? l.source : 'Unknown';
    let row = byKey.get(src);
    if (!row) {
      row = {
        source: src,
        leads: 0,
        bookings: 0,
        showed: 0,
        closed: 0,
        cash: 0,
        leadToBookPct: 0,
        closePct: 0,
      };
      byKey.set(src, row);
    }
    row.leads += 1;
    if (l.demoBooked) row.bookings += 1;
    if (l.showStatus === 'Showed') row.showed += 1;
    if (l.callOutcome === 'Closed Won') {
      row.closed += 1;
      row.cash += Number(l.cashCollected ?? 0);
    }
  }

  for (const row of byKey.values()) {
    row.leadToBookPct = row.leads > 0 ? (row.bookings / row.leads) * 100 : 0;
    row.closePct = row.showed > 0 ? (row.closed / row.showed) * 100 : 0;
  }

  return Array.from(byKey.values()).sort((a, b) => b.cash - a.cash);
}

export interface CloserLeaderboardRow {
  closer: string;
  // 'setter' = setter (e.g. an Instagram DM setter — books
  // appointments but doesn't close); 'csm' = account manager (cash from
  // upsells, no pipeline activity); 'closer' = full sales pipeline.
  role: 'closer' | 'csm' | 'setter';
  booked: number;
  showed: number;
  noShows: number;       // sum of t05 no_shows
  cancelled: number;     // sum of t05 calls_cancelled
  closed: number;
  showPct: number;       // shows / (shows + no_shows + cancelled)
  cancelPct: number;     // cancelled / booked
  closePct: number;      // closed / shows
  cash: number;          // total cash across all deal types
  contracted: number;    // total contracted across all deal types
  newDeals: number;      // count of deal_type='new'
  renewals: number;      // count of deal_type='renewal'
  upsells: number;       // count of deal_type='upsell'
  // Cash Per Call = cash / showed. the operator 2026-04-30: "the number one
  // indicator of who our best closer is." Computed in the API so the UI
  // can sort by it.
  cashPerCall: number;
}

/**
 * Per-closer leaderboard for the Main Dashboard. Aggregates from the unified
 * Lead[] (already enriched with EOD + closed-deal data via dataSources).
 */
export function aggregateCloserLeaderboard<L extends {
  date: string;
  assignedCloser?: string;
  demoBooked?: boolean;
  showStatus?: string;
  callOutcome?: string;
  cashCollected?: number;
  contractedRevenue?: number;
}>(leads: L[], window: DateWindow): CloserLeaderboardRow[] {
  const byKey = new Map<string, CloserLeaderboardRow>();

  for (const l of leads) {
    if (!inWindow(l.date, window)) continue;
    const closer = l.assignedCloser?.trim();
    if (!closer) continue;
    let row = byKey.get(closer);
    if (!row) {
      row = {
        closer,
        role: 'closer',
        booked: 0,
        showed: 0,
        noShows: 0,
        cancelled: 0,
        closed: 0,
        showPct: 0,
        cancelPct: 0,
        closePct: 0,
        cash: 0,
        contracted: 0,
        newDeals: 0,
        renewals: 0,
        upsells: 0,
      };
      byKey.set(closer, row);
    }
    if (l.demoBooked) row.booked += 1;
    if (l.showStatus === 'Showed') row.showed += 1;
    if (l.callOutcome === 'Closed Won') {
      row.closed += 1;
      row.cash += Number(l.cashCollected ?? 0);
      row.contracted += Number(l.contractedRevenue ?? 0);
      row.newDeals += 1;
    }
  }

  for (const row of byKey.values()) {
    const denom = row.showed + row.noShows + row.cancelled;
    row.showPct = denom > 0 ? (row.showed / denom) * 100 : 0;
    row.cancelPct = row.booked > 0 ? (row.cancelled / row.booked) * 100 : 0;
    row.closePct = row.showed > 0 ? (row.closed / row.showed) * 100 : 0;
  }

  return Array.from(byKey.values()).sort((a, b) => b.cash - a.cash);
}

export interface CashSliceRow {
  key: string;
  amount: number;
  count: number;
}

/**
 * Group closed-deal cash by source label (used for "Cash by Source" donut).
 */
export function aggregateCashBySource<L extends {
  date: string;
  source?: string | null;
  callOutcome?: string;
  cashCollected?: number;
}>(leads: L[], window: DateWindow): CashSliceRow[] {
  const byKey = new Map<string, CashSliceRow>();
  for (const l of leads) {
    if (!inWindow(l.date, window)) continue;
    if (l.callOutcome !== 'Closed Won') continue;
    const key = l.source && l.source.length > 0 ? l.source : 'Unknown';
    const cash = Number(l.cashCollected ?? 0);
    if (cash <= 0) continue;
    let row = byKey.get(key);
    if (!row) {
      row = { key, amount: 0, count: 0 };
      byKey.set(key, row);
    }
    row.amount += cash;
    row.count += 1;
  }
  return Array.from(byKey.values()).sort((a, b) => b.amount - a.amount);
}

/**
 * Group cash from a deals table by `offer` (program label).
 * Works against any row shape with { offer, cash, date }.
 */
export function aggregateCashByOffer(
  rows: { offer?: string | null; cash?: number | null; cash_collected?: number | null; date?: string | null }[],
  window: DateWindow
): CashSliceRow[] {
  const byKey = new Map<string, CashSliceRow>();
  for (const r of rows) {
    if (!inWindow(r.date ?? null, window)) continue;
    const key = r.offer && r.offer.length > 0 ? r.offer : 'Unknown';
    const cash = Number(r.cash ?? r.cash_collected ?? 0);
    if (cash <= 0) continue;
    let row = byKey.get(key);
    if (!row) {
      row = { key, amount: 0, count: 0 };
      byKey.set(key, row);
    }
    row.amount += cash;
    row.count += 1;
  }
  return Array.from(byKey.values()).sort((a, b) => b.amount - a.amount);
}

export interface ExpenseBreakdownRow {
  expense_type: string;
  amount: number;
  count: number;
}

/**
 * Group t08_expenses rows by expense_type for the Main Dashboard donut.
 */
export function aggregateExpenseBreakdown(
  rows: { expense_type?: string | null; amount?: number | null; date?: string | null }[],
  window: DateWindow
): ExpenseBreakdownRow[] {
  const byKey = new Map<string, ExpenseBreakdownRow>();
  for (const r of rows) {
    if (!inWindow(r.date ?? null, window)) continue;
    const key = (r.expense_type && r.expense_type.length > 0 ? r.expense_type : 'unknown').toLowerCase();
    const amt = Math.abs(Number(r.amount ?? 0));
    if (amt === 0) continue;
    let row = byKey.get(key);
    if (!row) {
      row = { expense_type: key, amount: 0, count: 0 };
      byKey.set(key, row);
    }
    row.amount += amt;
    row.count += 1;
  }
  return Array.from(byKey.values()).sort((a, b) => b.amount - a.amount);
}

export interface VendorAggregateRow {
  vendor: string;
  amount: number;
  count: number;
  expense_type: string | null;
}

/**
 * Normalize a Mercury transaction name into a vendor key. Strips dates,
 * trailing numbers, common payment-processor noise, and lowercases. Goal:
 * "Anthropic Inv 4517" / "ANTHROPIC PBC" / "Anthropic - April 2026" all
 * collapse to the same vendor row when summed across the timeframe.
 */
export function normalizeVendor(raw: string): string {
  let s = raw.toLowerCase().trim();
  // Strip leading provider prefixes Mercury appends
  s = s.replace(/^(ach\s+|wire\s+|debit\s+|credit\s+|pos\s+)/, '');
  // Drop dates / invoice numbers / id suffixes
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '');
  s = s.replace(/\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, '');
  s = s.replace(/\b(inv|invoice|ref|id|txn|order|po)[#:\-\s]*\w+\b/g, '');
  s = s.replace(/[#*]+\s*\d+/g, '');
  s = s.replace(/\s+\d{4,}\s*$/g, ''); // trailing long numbers
  // Strip punctuation / collapse spaces
  s = s.replace(/[_\-,.]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Take first 3 tokens — enough to identify "anthropic", "google ads", "openai api"
  const tokens = s.split(' ').filter(Boolean).slice(0, 3);
  if (tokens.length === 0) return 'unknown';
  return tokens.join(' ');
}

/**
 * Aggregate t08_expenses by vendor (normalized transaction_name) for the
 * "Highest Cost Categories" panel on the Main Dashboard. the operator's spec:
 * "if Anthropic billed us 100 times in the month, sum them all and show
 *  the total — not single transactions."
 */
export function aggregateVendors(
  rows: {
    transaction_name?: string | null;
    expense_type?: string | null;
    amount?: number | null;
    date?: string | null;
  }[],
  window: DateWindow,
  topN = 10
): VendorAggregateRow[] {
  const byKey = new Map<string, VendorAggregateRow>();
  for (const r of rows) {
    if (!inWindow(r.date ?? null, window)) continue;
    const amt = Math.abs(Number(r.amount ?? 0));
    if (amt === 0) continue;
    const raw = (r.transaction_name ?? '').trim();
    if (!raw) continue;
    const key = normalizeVendor(raw);
    let row = byKey.get(key);
    if (!row) {
      row = { vendor: key, amount: 0, count: 0, expense_type: r.expense_type ?? null };
      byKey.set(key, row);
    }
    row.amount += amt;
    row.count += 1;
    // Prefer non-null expense_type when we have one
    if (!row.expense_type && r.expense_type) row.expense_type = r.expense_type;
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, topN);
}
