import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projections?month=YYYY-MM
 *
 * Returns the 14-row Pace vs Projection table that mirrors the operator's sheet:
 *
 *   contracted     — Patient Trust System (single $7,000 offer)
 *   cash_collected — Upfront cash collected (% UFCC × contracted)
 *   receivables    — MRR (account_receivable) / Deposit Revenue (deposit payments)
 *   refunds        — Total Refunds (single row, stored positive)
 *   expenses       — Overhead / Labor / Marketing
 *
 * Targets come from t21_monthly_projections (saved per month). When no row
 * is saved, we synthesize a sensible default so the card never sits empty.
 *
 * Actuals are computed live from t06_deals_closed (contracted), t07_income_processors
 * (cash + receivables + refunds), and t08_expenses (operating expenses).
 *
 * Status logic:
 *   revenue rows → ahead/on_pace/behind/critical based on day-of-month pace.
 *   expense rows → under/at_cap/over_cap based on % of cap consumed.
 *   refund rows  → flipped (lower is better).
 */

type Section = 'contracted' | 'cash_collected' | 'receivables' | 'refunds' | 'expenses';
type Kind = 'revenue' | 'expense' | 'refund';
type Status = 'ahead' | 'on_pace' | 'behind' | 'critical' | 'under' | 'at_cap' | 'over_cap';

interface PaceRow {
  id?: string;
  month: string;
  section: Section;
  metric: string;
  kind: Kind;
  target_value: number;
  target_units: number | null;
  target_pct: number | null;
  unit_price: number | null;
  ar_base: number | null;
  actual_value: number;
  pct_of_target: number;
  status: Status;
  reason: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

interface SavedRow {
  id: string;
  month: string;
  section: string;
  metric: string;
  kind: string | null;
  target_value: number | string;
  target_units: number | string | null;
  target_pct: number | string | null;
  unit_price: number | string | null;
  ar_base: number | string | null;
  reason: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

function monthBounds(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const lastDay = new Date(year, mon, 0).getDate();
  return {
    from: `${m[1]}-${m[2]}-01`,
    to: `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Day-of-month / days-in-month, capped to 1 for past months. */
function expectedPace(month: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return 1;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const now = new Date();
  const lastDay = new Date(year, mon, 0).getDate();
  // Past month → fully expected. Future month → 0. Current month → day/last.
  if (year < now.getFullYear() || (year === now.getFullYear() && mon < now.getMonth() + 1)) return 1;
  if (year > now.getFullYear() || (year === now.getFullYear() && mon > now.getMonth() + 1)) return 0;
  return now.getDate() / lastDay;
}

function statusForRevenue(actual: number, target: number, expected: number): Status {
  if (target <= 0) return 'under';
  const pct = actual / target;
  if (pct >= expected + 0.05) return 'ahead';
  if (pct >= expected - 0.05) return 'on_pace';
  if (pct >= expected - 0.20) return 'behind';
  return 'critical';
}

function statusForExpenses(actual: number, cap: number): Status {
  if (cap <= 0) return 'under';
  const pct = actual / cap;
  if (pct >= 1) return 'over_cap';
  if (pct >= 0.9) return 'at_cap';
  return 'under';
}

/** Refunds: lower is better. Status flips — actual ≥ projected refund $ = bad. */
function statusForRefunds(actual: number, target: number): Status {
  if (target <= 0) return actual > 0 ? 'critical' : 'under';
  const pct = actual / target;
  if (pct >= 1.5) return 'critical';
  if (pct >= 1) return 'behind';
  if (pct >= 0.5) return 'on_pace';
  return 'ahead';
}

// ─── Offer-name matching helpers ────────────────────────────────────────────
//
// t07_income_processors.offer is free-form (Whop productName / Fanbasis productTitle).
// Same for t06_deals_closed.offer. We bucket via case-insensitive substring match.
// the operator can refine/correct via card feedback.

// Single-offer model: Patient Trust System ($7,000). Any non-mastermind deal
// attributes to PTS — we used to split across Program A / B / C but the
// business now sells one flagship offer.
const matchesPTS = (offer: string) => {
  const o = offer.toLowerCase();
  if (o.includes('mastermind')) return false;
  // Match the canonical name plus common abbreviations the team uses.
  return (
    o.includes('patient trust') ||
    o.includes('pts') ||
    // Fallback: any non-mastermind offer in t06 belongs to the single program.
    o.trim().length > 0
  );
};

const matchesMastermind = (offer: string) => offer.toLowerCase().includes('mastermind');

// ─── Default target template (mirrors the operator's sheet) ──────────────────────

/**
 * Default per-offer unit prices used when no saved unit_price exists yet for
 * the row's month. the operator 2026-05-02: prices are now editable inline via the
 * Set Projections modal (Founder Two's request — offers get repriced
 * periodically), so any positive saved unit_price wins; this map is a
 * defaults-only fallback for fresh months.
 */
const DEFAULT_UNIT_PRICES: Record<string, number> = {
  'Patient Trust System': 7000,
};

const resolveUnitPrice = (metric: string, saved: number | string | null | undefined): number => {
  const n = saved == null ? NaN : Number(saved);
  if (Number.isFinite(n) && n > 0) return n;
  return DEFAULT_UNIT_PRICES[metric] ?? 0;
};

/**
 * Map cash_collected → matching contracted metric, so % UFCC × contracted
 * computes the upfront $ target.
 */
const CASH_TO_CONTRACTED: Record<string, string> = {
  'Patient Trust System Upfront': 'Patient Trust System',
};

interface Tmpl {
  section: Section;
  metric: string;
  kind: Kind;
  defaultUnits?: number;
  defaultPct?: number;
  defaultArBase?: number;
  /** Direct dollar default if not derivable from units/pct. */
  defaultValue?: number;
}

const TEMPLATE: Tmpl[] = [
  // 1. Contracted revenue — single offer (Patient Trust System @ $7,000).
  //    Units AND price/unit both editable; price defaults from DEFAULT_UNIT_PRICES.
  { section: 'contracted', metric: 'Patient Trust System', kind: 'revenue', defaultUnits: 20 },
  // 2. Cash collected upfront — only `% UFCC` editable; target $ = pct × contracted target
  { section: 'cash_collected', metric: 'Patient Trust System Upfront', kind: 'revenue', defaultPct: 0.6 },
  // 3. Receivables / backend — flat $ targets, both sourced from t07_income_processors.
  //    MRR             = sum of paid rows where payment_type='account_receivable'
  //    Deposit Revenue = sum of paid rows where the offer/product name matches a deposit
  { section: 'receivables', metric: 'MRR',             kind: 'revenue', defaultValue: 60000 },
  { section: 'receivables', metric: 'Deposit Revenue', kind: 'revenue', defaultValue: 20000 },
  // 4. Refunds — single row (stored positive, status flipped: lower actuals = better)
  { section: 'refunds', metric: 'Total Refunds', kind: 'refund', defaultValue: 20000 },
  // 5. Operating expenses — flat $ caps
  { section: 'expenses', metric: 'Overhead',                kind: 'expense', defaultValue: 9715 },
  { section: 'expenses', metric: 'Labor / Program Coaches', kind: 'expense', defaultValue: 106200 },
  { section: 'expenses', metric: 'Marketing',               kind: 'expense', defaultValue: 108600 },
  { section: 'expenses', metric: 'Coaching',                kind: 'expense', defaultValue: 0 },
];

function templateDefault(_t: Tmpl): {
  target_units: number | null;
  target_pct: number | null;
  ar_base: number | null;
  flat_value: number;
} {
  // the operator 2026-05-02: monthly targets should reset every month.
  // Returning the TEMPLATE's hardcoded defaults (e.g. 20 ProgA units,
  // $60k Mastermind tickets) caused May to inherit April's numbers
  // and made the dashboard look like the targets carried over.
  // Now: blank slate every month — the operator sets new projections via
  // the "Set Targets" modal. The TEMPLATE still defines WHICH rows
  // appear (so the table layout is consistent), only the values
  // start at zero.
  return { target_units: 0, target_pct: 0, ar_base: 0, flat_value: 0 };
}

/**
 * Single source of truth for target_value. Always recomputed at read time
 * from natural inputs — never trust a stored target_value for derived rows.
 *
 *   contracted        → units × resolved unit_price (saved value, else DEFAULT_UNIT_PRICES[metric])
 *   cash_collected    → pct × contractedMap[parent metric]
 *   receivables AR    → ar_base × pct
 *   everything else   → flat $ (stored target_value)
 */
function computeTargetValue(args: {
  section: Section;
  metric: string;
  target_units: number | null;
  target_pct: number | null;
  unit_price: number | null;
  ar_base: number | null;
  flat_value: number;
  contractedTargets: Map<string, number>;
}): number {
  const { section, metric, target_units, target_pct, unit_price, ar_base, flat_value, contractedTargets } = args;
  if (section === 'contracted') {
    const price = resolveUnitPrice(metric, unit_price);
    return Number(target_units ?? 0) * price;
  }
  if (section === 'cash_collected') {
    const parentMetric = CASH_TO_CONTRACTED[metric];
    const parent = parentMetric ? (contractedTargets.get(parentMetric) ?? 0) : 0;
    return Number(target_pct ?? 0) * parent;
  }
  // (No AR base × pct rows after the receivables simplification — MRR and
  // Deposit Revenue are both flat-$ targets.)
  return Number(flat_value ?? 0);
}

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const monthParam = searchParams.get('month') ?? undefined;
  const now = new Date();
  const month = monthParam ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const supa = await getServerSupabase();

  // 1. Saved targets (if any).
  let savedRows: SavedRow[] = [];
  if (supa) {
    const { data, error } = await supa
      .from('t21_monthly_projections')
      .select('id, month, section, metric, kind, target_value, target_units, target_pct, unit_price, ar_base, reason, updated_by, updated_at')
      .eq('month', month);
    if (!error && Array.isArray(data)) savedRows = data as SavedRow[];
  }
  const savedByKey = new Map<string, SavedRow>();
  for (const r of savedRows) savedByKey.set(`${r.section}|${r.metric}`, r);

  // 2. Compute actuals from source tables for the month.
  const bounds = monthBounds(month);
  const actuals = {
    contractedPTS: 0,    // Patient Trust System contracted revenue
    cashPTS: 0,          // Patient Trust System upfront cash collected
    mrr: 0,              // Monthly Recurring Revenue (t07 payment_type='account_receivable')
    depositRevenue: 0,   // Stripe/deposit payments (t07 offer ILIKE '%deposit%')
    refundsTotal: 0,
    expOverhead: 0,
    expLabor: 0,
    expMarketing: 0,
    expCoaching: 0,
  };

  if (supa && bounds) {
    const [dealsRes, incRes, expRes] = await Promise.all([
      supa
        .from('t06_deals_closed')
        .select('offer, contracted_revenue, cash_collected, deal_type, date_closed')
        .gte('date_closed', bounds.from)
        .lte('date_closed', bounds.to)
        .limit(20000),
      supa
        .from('t07_income_processors')
        .select('amount, final_amount, status, payment_type, offer, date')
        .gte('date', bounds.from)
        .lte('date', bounds.to)
        .limit(50000),
      supa
        .from('t08_expenses')
        .select('amount, expense_type, date')
        .gte('date', bounds.from)
        .lte('date', bounds.to)
        .limit(20000),
    ]);

    // ─── t06_deals_closed: contracted + upfront cash for NEW deals ─────────
    // Per the operator: "go to T06 Deals Closed and pull cash collected and
    // contracted revenue per offer". For NEW deals only — upsell/renewal/
    // mastermind/AR all live in t07 now (Architecture B + queue work).
    // This keeps the "Contracted" rows + "Upfront Cash" rows tied to the
    // closer-announced numbers from #new-clients, matching Cash by Offer
    // (which also pulls t06).
    for (const d of dealsRes.data ?? []) {
      const row = d as {
        offer: string | null;
        contracted_revenue: number | string | null;
        cash_collected: number | string | null;
        deal_type: string | null;
      };
      const offer = String(row.offer ?? '');
      const cash = Number(row.cash_collected ?? 0);
      const dtype = String(row.deal_type ?? '').toLowerCase();

      // Skip non-new deals — t06 renewal/upsell rows are headlined separately
      // in t07.payment_type='upsell_renewal' which is the source we use for
      // Backend Ascensions+Renewals so the totals match Revenue Composition.
      if (dtype === 'renewal' || dtype === 'upsell' || dtype === 'upgrade') continue;

      // Skip mastermind from t06 — the operator 2026-04-30: mastermind classification
      // happens in t07 (payment_type='mastermind') because Whop product names
      // don't reliably tag mastermind clients. Pulling from t07 below.
      if (matchesMastermind(offer)) continue;

      if (matchesPTS(offer)) {
        // Cash side still sourced from t06_deals_closed (closer-announced
        // upfront collection per the operator's spec).
        actuals.cashPTS += cash;
      }
      // NB: contractedPTS is no longer summed from t06.contracted_revenue
      // here — it's derived below from t05_eod_reports.calls_closed × $7,000
      // so the figure matches the count-of-deals × price-per-PTS-deal model
      // the operator switched to.
    }

    // ─── t05_eod_reports: contractedPTS = sum(calls_closed) × $7,000 ───────
    // Per the operator's spec change: contracted Patient Trust System
    // revenue is now COUNT-based rather than sum of t06.contracted_revenue.
    // Every closed deal in the EOD reports is a PTS deal at the canonical
    // $7,000 unit price.
    const PTS_UNIT_PRICE = 7000;
    const { data: eodRows } = await supa
      .from('t05_eod_reports')
      .select('calls_closed, date')
      .gte('date', bounds.from)
      .lte('date', bounds.to)
      .limit(20000);
    let ptsCallsClosed = 0;
    for (const r of (eodRows ?? []) as Array<{ calls_closed: number | string | null }>) {
      ptsCallsClosed += Number(r.calls_closed ?? 0);
    }
    actuals.contractedPTS = ptsCallsClosed * PTS_UNIT_PRICE;

    // ─── t07_income_processors: receivables + mastermind + upsells + refunds ──
    // the operator 2026-04-30: switch all back-end revenue rows to source from t07
    // (the queue work is canonical). Now the projections "Receivables" rows
    // reconcile to Revenue Composition exactly:
    //   - ProgB BE AR (Receivables)         = sum of payment_type='account_receivable'
    //   - Backend Ascensions+Renewals     = sum of payment_type='upsell_renewal'
    //   - Mastermind Tickets              = sum of payment_type='mastermind'
    //   - Total Refunds                   = sum of |amount| where status='refunded' OR payment_type='refund'
    for (const r of incRes.data ?? []) {
      const row = r as {
        amount: number | string | null;
        final_amount: number | string | null;
        status: string | null;
        payment_type: string | null;
        offer: string | null;
      };
      const amt = Number(row.final_amount ?? row.amount ?? 0);
      const status = String(row.status ?? '').toLowerCase();
      const ptype = String(row.payment_type ?? '').toLowerCase();

      // Skip 'excluded' rows — wrong-business / mis-routed payments removed via the queue.
      if (ptype === 'excluded') continue;

      if (status === 'refunded' || ptype === 'refund') {
        actuals.refundsTotal += Math.abs(amt);
        continue;
      }
      if (status !== 'paid') continue;

      // Deposit detection runs BEFORE the AR bucket so a deposit booked as
      // account_receivable still lands in Deposit Revenue (and not double-counted).
      const offer = String(row.offer ?? '').toLowerCase();
      const isDeposit = offer.includes('deposit');

      if (isDeposit) {
        actuals.depositRevenue += amt;
      } else if (ptype === 'account_receivable') {
        actuals.mrr += amt;
      }
      // Note: upsell_renewal + mastermind payment_types are intentionally
      // ignored here — they're tracked in Revenue Composition but no longer
      // surfaced in the Pace vs Projection table.
    }

    // ─── t08_expenses (operating expenses by bucket) ──
    for (const r of expRes.data ?? []) {
      const row = r as { amount: number | string | null; expense_type: string | null };
      const amt = Number(row.amount ?? 0);
      const cat = String(row.expense_type ?? '').toLowerCase();
      if (cat === 'overhead') actuals.expOverhead += amt;
      else if (cat === 'labour' || cat === 'labor') actuals.expLabor += amt;
      else if (cat === 'marketing') actuals.expMarketing += amt;
      else if (cat === 'coaching') actuals.expCoaching += amt;
      // other/unknown/personal not in the projection sheet — ignored here
    }
  }

  const actualForKey = (key: string): number => {
    switch (key) {
      case 'contracted|Patient Trust System':         return actuals.contractedPTS;
      case 'cash_collected|Patient Trust System Upfront': return actuals.cashPTS;
      case 'receivables|MRR':             return actuals.mrr;
      case 'receivables|Deposit Revenue': return actuals.depositRevenue;
      case 'refunds|Total Refunds':            return actuals.refundsTotal;
      case 'expenses|Overhead':                return actuals.expOverhead;
      case 'expenses|Labor / Program Coaches': return actuals.expLabor;
      case 'expenses|Marketing':               return actuals.expMarketing;
      case 'expenses|Coaching':                return actuals.expCoaching;
      default: return 0;
    }
  };

  const expected = expectedPace(month);

  // 3. First pass: resolve natural inputs per row (saved → template default).
  type Resolved = {
    tmpl: Tmpl;
    saved: SavedRow | undefined;
    target_units: number | null;
    target_pct: number | null;
    unit_price: number | null;
    ar_base: number | null;
    flat_value: number;
  };
  const resolved: Resolved[] = TEMPLATE.map((t) => {
    const key = `${t.section}|${t.metric}`;
    const saved = savedByKey.get(key);
    const def = templateDefault(t);
    const target_units = saved?.target_units != null ? Number(saved.target_units) : def.target_units;
    const target_pct = saved?.target_pct != null ? Number(saved.target_pct) : def.target_pct;
    const ar_base = saved?.ar_base != null ? Number(saved.ar_base) : def.ar_base;
    // unit_price is only meaningful for contracted rows. Fall back to the
    // default map when the saved row has nothing positive stored.
    const unit_price =
      t.section === 'contracted' ? resolveUnitPrice(t.metric, saved?.unit_price) : null;
    // For flat-$ rows, prefer saved.target_value; for derived rows it's recomputed below.
    const flat_value = saved?.target_value != null ? Number(saved.target_value) : def.flat_value;
    return { tmpl: t, saved, target_units, target_pct, unit_price, ar_base, flat_value };
  });

  // 4. Pre-compute contracted targets so cash_collected rows can derive from them.
  const contractedTargets = new Map<string, number>();
  for (const r of resolved) {
    if (r.tmpl.section !== 'contracted') continue;
    const tv = computeTargetValue({
      section: r.tmpl.section,
      metric: r.tmpl.metric,
      target_units: r.target_units,
      target_pct: r.target_pct,
      unit_price: r.unit_price,
      ar_base: r.ar_base,
      flat_value: r.flat_value,
      contractedTargets: new Map(),
    });
    contractedTargets.set(r.tmpl.metric, tv);
  }

  // 5. Build final rows — target_value always computed from natural inputs.
  const rows: PaceRow[] = resolved.map(({ tmpl, saved, target_units, target_pct, unit_price, ar_base, flat_value }) => {
    const key = `${tmpl.section}|${tmpl.metric}`;
    const target_value = computeTargetValue({
      section: tmpl.section,
      metric: tmpl.metric,
      target_units,
      target_pct,
      unit_price,
      ar_base,
      flat_value,
      contractedTargets,
    });
    const actual_value = actualForKey(key);
    const pct_of_target = target_value > 0 ? actual_value / target_value : 0;

    let status: Status;
    if (tmpl.kind === 'expense') status = statusForExpenses(actual_value, target_value);
    else if (tmpl.kind === 'refund') status = statusForRefunds(actual_value, target_value);
    else status = statusForRevenue(actual_value, target_value, expected);

    return {
      id: saved?.id,
      month,
      section: tmpl.section,
      metric: tmpl.metric,
      kind: tmpl.kind,
      target_value,
      target_units,
      target_pct,
      unit_price,
      ar_base,
      actual_value,
      pct_of_target,
      status,
      reason: saved?.reason ?? null,
      updated_by: saved?.updated_by ?? null,
      updated_at: saved?.updated_at ?? null,
    };
  });

  // 4. Section totals + grand totals.
  const sumBy = (s: Section, fn: (r: PaceRow) => number) => rows.filter((r) => r.section === s).reduce((acc, r) => acc + fn(r), 0);
  const totals = {
    contracted: { target: sumBy('contracted', (r) => r.target_value), actual: sumBy('contracted', (r) => r.actual_value) },
    cash_collected: { target: sumBy('cash_collected', (r) => r.target_value), actual: sumBy('cash_collected', (r) => r.actual_value) },
    receivables: { target: sumBy('receivables', (r) => r.target_value), actual: sumBy('receivables', (r) => r.actual_value) },
    refunds: { target: sumBy('refunds', (r) => r.target_value), actual: sumBy('refunds', (r) => r.actual_value) },
    expenses: { target: sumBy('expenses', (r) => r.target_value), actual: sumBy('expenses', (r) => r.actual_value) },
  };
  // Projected revenue = cash collected + receivables - refunds (matches sheet's "PROJECTED REVENUE" row)
  const projectedRevenue = {
    target: totals.cash_collected.target + totals.receivables.target - totals.refunds.target,
    actual: totals.cash_collected.actual + totals.receivables.actual - totals.refunds.actual,
  };

  return NextResponse.json(
    {
      month,
      expected_pace: expected,
      rows,
      totals,
      projected_revenue: projectedRevenue,
    },
    {
      // Belt-and-suspenders: even with `dynamic = 'force-dynamic'` set above,
      // the operator 2026-04-30 saw stale $0 actuals because the browser had a
      // cached response from a pre-fix deploy. Force every client to refetch.
      headers: {
        'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
      },
    }
  );
}

// ─── POST ───────────────────────────────────────────────────────────────────
// Two modes:
//   1. Single upsert: { month, section, metric, target_value, ... } — used by
//      inline cell edits on the Pace card.
//   2. Bulk upsert:   { month, rows: PartialRow[] } — used by the "Set
//      Targets" modal to save all 14 rows in one round-trip.

interface UpsertPayload {
  month: string;
  section: string;
  metric: string;
  kind?: string;
  target_value?: number;
  target_units?: number | null;
  target_pct?: number | null;
  unit_price?: number | null;
  ar_base?: number | null;
  reason?: string | null;
  updated_by?: string;
}

export async function POST(req: NextRequest) {
  let body: { month?: string; rows?: UpsertPayload[]; section?: string; metric?: string; kind?: string;
    target_value?: number; target_units?: number | null; target_pct?: number | null;
    unit_price?: number | null; ar_base?: number | null; reason?: string | null; updated_by?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body?.month) {
    return NextResponse.json({ error: 'month is required' }, { status: 400 });
  }

  const supa = await getServerSupabase();
  if (!supa) {
    return NextResponse.json({ error: 'Supabase not configured', received: body }, { status: 503 });
  }

  // Bulk mode
  if (Array.isArray(body.rows) && body.rows.length > 0) {
    const stamp = new Date().toISOString();
    const payload = body.rows.map((r) => ({
      month: body.month!,
      section: r.section,
      metric: r.metric,
      kind: r.kind ?? 'revenue',
      target_value: Number(r.target_value ?? 0),
      target_units: r.target_units != null ? Number(r.target_units) : null,
      target_pct: r.target_pct != null ? Number(r.target_pct) : null,
      unit_price: r.unit_price != null ? Number(r.unit_price) : null,
      ar_base: r.ar_base != null ? Number(r.ar_base) : null,
      reason: r.reason ?? null,
      updated_by: r.updated_by ?? body.updated_by ?? 'the operator',
      updated_at: stamp,
    }));
    const { data, error } = await supa
      .from('t21_monthly_projections')
      .upsert(payload, { onConflict: 'month,section,metric' })
      .select();
    if (error) return NextResponse.json({ error: error.message ?? 'bulk_upsert_failed' }, { status: 502 });
    return NextResponse.json({ ok: true, count: data?.length ?? 0, rows: data });
  }

  // Single mode
  if (typeof body.metric !== 'string' || typeof body.section !== 'string') {
    return NextResponse.json({ error: 'rows[] (or section+metric+target_value) is required' }, { status: 400 });
  }

  const row = {
    month: body.month,
    section: body.section,
    metric: body.metric,
    kind: body.kind ?? 'revenue',
    target_value: Number(body.target_value ?? 0),
    target_units: body.target_units != null ? Number(body.target_units) : null,
    target_pct: body.target_pct != null ? Number(body.target_pct) : null,
    unit_price: body.unit_price != null ? Number(body.unit_price) : null,
    ar_base: body.ar_base != null ? Number(body.ar_base) : null,
    reason: body.reason ?? null,
    updated_by: body.updated_by ?? 'the operator',
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supa
    .from('t21_monthly_projections')
    .upsert(row, { onConflict: 'month,section,metric' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message ?? 'upsert_failed', row }, { status: 502 });
  return NextResponse.json({ ok: true, row: data });
}
