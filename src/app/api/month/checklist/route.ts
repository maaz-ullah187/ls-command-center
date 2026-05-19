import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { todayET, monthYM_ET } from '@/lib/timeframe';

export const dynamic = 'force-dynamic';

/**
 * GET /api/month/checklist?month=YYYY-MM
 *
 * Powers /month's monthly CEO review per the operator's PDF spec dated
 * 2026-05-02. Default month = the last COMPLETED calendar month (e.g.
 * on May 5 returns April; on Apr 5 returns March) since the monthly
 * retro happens after the month closes.
 *
 * Sections returned:
 *   • yearSoFar       — 12-month bars, YTD totals, pace vs annual target
 *   • revenueQuality  — cash vs target, AR aging, CSM upsells
 *   • constraint      — auto-flags worst of {acquisition / sales / fulfillment / team}
 *   • expenseEfficiency — total + per-category vs target + top vendors
 *   • doubleDownKill  — top funnel / closer / setter / content surface
 *   • monthlySeries   — raw data the UI uses to draw the year-strip chart
 */

// ── Helpers ────────────────────────────────────────────────────────────

const pad = (n: number) => n.toString().padStart(2, '0');

/** "2026-04" → previous month "2026-03" (handles January). */
function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${pad(m - 1)}`;
}

/** "2026-04" → first/last day strings { from: '2026-04-01', to: '2026-04-30' } */
function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${pad(last)}` };
}

/** Last completed calendar month in ET — i.e. if today is May, returns April. */
function lastCompletedMonthET(): string {
  return prevMonth(monthYM_ET());
}

/** Build the 12-month series ending at the requested month, oldest first. */
function rolling12Months(endMonth: string): string[] {
  const out: string[] = [];
  let m = endMonth;
  out.push(m);
  for (let i = 0; i < 11; i++) {
    m = prevMonth(m);
    out.unshift(m);
  }
  return out;
}

// Same canonSource as the rest of the dashboard (twitter→X, fb→Facebook Ads, etc.)
function canonSource(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return 'Unknown';
  const k = s.toLowerCase();
  if (k === 'twitter' || k === 'x' || k === 'x.com') return 'X';
  if (k === 'fb' || k === 'facebook' || k === 'meta' || k === 'facebook ads' || k === 'paid' || k === 'paid ads') return 'Facebook Ads';
  if (k === 'yt' || k === 'youtube' || k === 'youtube ads') return 'YouTube';
  if (k === 'ig' || k === 'instagram') return 'Instagram';
  if (k === 'li' || k === 'linkedin') return 'LinkedIn';
  if (k === 'organic' || k === 'seo') return 'Organic';
  if (k === 'referral' || k === 'ref' || k === 'referred') return 'Referral';
  if (k === 'webinar' || k === 'webinars') return 'Webinar';
  return s;
}

// ── Aggregators ────────────────────────────────────────────────────────

interface IncRow { date: string; payment_type: string | null; status: string | null; final_amount: number | string | null; amount: number | string | null }

function aggIncome(rows: IncRow[]) {
  let newCash = 0, ar = 0, upsellRenewal = 0, mastermind = 0, refunds = 0, uncategorized = 0;
  for (const r of rows) {
    const ptype = (r.payment_type ?? '').toLowerCase();
    const status = (r.status ?? '').toLowerCase();
    if (ptype === 'excluded') continue;
    const amt = Number(r.final_amount ?? r.amount ?? 0);
    if (status === 'refunded' || ptype === 'refund') { refunds += Math.abs(amt); continue; }
    if (status !== 'paid') continue;
    if (ptype === 'new_client' || ptype === 'new') newCash += amt;
    else if (ptype === 'account_receivable') ar += amt;
    else if (ptype === 'upsell_renewal') upsellRenewal += amt;
    else if (ptype === 'mastermind') mastermind += amt;
    else uncategorized += amt;
  }
  const gross = newCash + ar + upsellRenewal + mastermind + uncategorized;
  return { newCash, ar, upsellRenewal, mastermind, refunds, uncategorized, gross, net: gross - refunds };
}

function aggExpense(rows: Array<{ amount: number | string | null; expense_type: string | null }>) {
  let total = 0;
  const byCategory: Record<string, number> = {};
  for (const r of rows) {
    const cat = (r.expense_type ?? '').toLowerCase();
    if (!cat || cat === 'unknown' || cat === 'other') continue;
    if (cat === 'personal' || cat === "personal (shouldn't be there)") continue;
    const amt = Number(r.amount ?? 0);
    total += amt;
    const key = cat === 'labour' ? 'labour'
      : cat === 'marketing' ? 'marketing'
      : cat === 'overhead' ? 'overhead'
      : cat === 'coaching' ? 'coaching'
      : 'other';
    byCategory[key] = (byCategory[key] ?? 0) + amt;
  }
  return { total, byCategory };
}

// ── GET handler ────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const monthParam = url.searchParams.get('month');
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : lastCompletedMonthET();
  const { from, to } = monthBounds(month);
  const priorM = prevMonth(month);
  const priorBounds = monthBounds(priorM);
  const yearStart = `${month.slice(0, 4)}-01-01`;
  const trendMonths = rolling12Months(month);
  const trendStart = monthBounds(trendMonths[0]).from;

  const supa = await getServerSupabaseAsync();
  if (!supa) return NextResponse.json({ configured: false }, { status: 500 });

  // Pull roster for CSM identification
  const { data: rosterRows } = await supa
    .from('t90_team_roster')
    .select('name, role, active')
    .eq('active', true);
  const csmFirstNames = new Set<string>();
  const closerFirstNames = new Set<string>();
  const setterFirstNames = new Set<string>();
  for (const r of (rosterRows ?? []) as Array<{ name: string | null; role: string | null }>) {
    const fn = (r.name ?? '').trim().toLowerCase().split(/\s+/)[0];
    if (!fn) continue;
    const role = (r.role ?? '').toLowerCase();
    if (role === 'account_manager') csmFirstNames.add(fn);
    else if (role === 'setter') setterFirstNames.add(fn);
    else closerFirstNames.add(fn);
  }
  const matchRoleFirstName = (raw: string | null | undefined, set: Set<string>): boolean => {
    const fn = (raw ?? '').trim().toLowerCase().split(/\s+/)[0];
    return fn ? set.has(fn) : false;
  };

  // the operator 2026-05-02: Supabase silently caps a single response at 1000
  // rows. The previous .limit(50000) was a no-op — only the first 1000
  // were returned, which made the 12-month series under-count badly
  // (April showed $176k instead of the real $470k). Page through with
  // .range() so all rows arrive.
  type IncRowFull = { date: string | null; payment_type: string | null; status: string | null; final_amount: number | string | null; amount: number | string | null };
  type ExpRowFull = { date: string | null; amount: number | string | null; expense_type: string | null; transaction_name?: string | null };
  async function pageAll<T>(
    table: string,
    cols: string,
    column: string,
    from: string,
    to: string,
  ): Promise<T[]> {
    const PAGE = 1000;
    const out: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supa!
        .from(table)
        .select(cols)
        .gte(column, from)
        .lte(column, to)
        .range(offset, offset + PAGE - 1);
      if (error) break;
      const batch = (data ?? []) as T[];
      out.push(...batch);
      if (batch.length < PAGE) break;
    }
    return out;
  }

  const [t07ThisArr, t07PriorArr, t07YearArr, t08ThisArr, t08PriorArr, t08YearArr, t06ThisRes, t06PriorRes, t01ThisRes, t05ThisRes, t21Targets] = await Promise.all([
    pageAll<IncRowFull>('t07_income_processors', 'date, payment_type, status, final_amount, amount', 'date', from, to),
    pageAll<IncRowFull>('t07_income_processors', 'date, payment_type, status, final_amount, amount', 'date', priorBounds.from, priorBounds.to),
    pageAll<IncRowFull>('t07_income_processors', 'date, payment_type, status, final_amount, amount', 'date', trendStart, to),
    pageAll<ExpRowFull>('t08_expenses', 'date, amount, expense_type, transaction_name', 'date', from, to),
    pageAll<ExpRowFull>('t08_expenses', 'date, amount, expense_type', 'date', priorBounds.from, priorBounds.to),
    pageAll<ExpRowFull>('t08_expenses', 'date, amount, expense_type', 'date', trendStart, to),
    supa.from('t06_deals_closed').select('date_closed, closer, source, offer, cash_collected, contracted_revenue, deal_type').gte('date_closed', from).lte('date_closed', to).limit(5000),
    supa.from('t06_deals_closed').select('date_closed, closer, source, cash_collected, deal_type').gte('date_closed', priorBounds.from).lte('date_closed', priorBounds.to).limit(5000),
    supa.from('t01_leads').select('source, date').gte('date', from).lte('date', to).limit(20000),
    supa.from('t05_eod_reports').select('date, closer_name, calls_booked, calls_shown, calls_closed, no_shows, calls_cancelled, cash_collected').gte('date', from).lte('date', to).limit(5000),
    supa.from('t21_monthly_projections').select('section, metric, target_value').eq('month', month),
  ]);
  const t07This = { data: t07ThisArr };
  const t07Prior = { data: t07PriorArr };
  const t07Year = { data: t07YearArr };
  const t08This = { data: t08ThisArr };
  const t08Prior = { data: t08PriorArr };
  const t08Year = { data: t08YearArr };
  const t06This = t06ThisRes;
  const t06Prior = t06PriorRes;
  const t01This = t01ThisRes;
  const t05This = t05ThisRes;

  // ── Targets from t21 ──
  let monthlyCashTarget = 0;
  let monthlyArTarget = 0;
  let monthlyExpenseCap = 0;
  for (const r of (t21Targets.data ?? []) as Array<{ section: string | null; metric: string | null; target_value: number | string | null }>) {
    const sec = (r.section ?? '').toLowerCase();
    const v = Number(r.target_value ?? 0);
    if (sec === 'cash_collected') monthlyCashTarget += v;
    else if (sec === 'receivables') monthlyArTarget += v;
    else if (sec === 'expenses') monthlyExpenseCap += v;
  }
  const monthlyRevTarget = monthlyCashTarget + monthlyArTarget;

  // ── Income aggregates ──
  type IncRowT = IncRow;
  const incomeThis = aggIncome((t07This.data ?? []) as IncRowT[]);
  const incomePrior = aggIncome((t07Prior.data ?? []) as IncRowT[]);

  // ── Expense aggregates ──
  type ExpRow = { date: string | null; amount: number | string | null; expense_type: string | null; transaction_name?: string | null };
  const expThis = aggExpense((t08This.data ?? []) as ExpRow[]);
  const expPrior = aggExpense((t08Prior.data ?? []) as ExpRow[]);

  // Top vendors — for the "renegotiate or cut" prompt.
  const vendorTotals = new Map<string, number>();
  for (const r of (t08This.data ?? []) as ExpRow[]) {
    const v = (r.transaction_name ?? '?').trim();
    const cat = (r.expense_type ?? '').toLowerCase();
    if (!cat || cat === 'unknown' || cat === 'other' || cat.includes('personal')) continue;
    vendorTotals.set(v, (vendorTotals.get(v) ?? 0) + Number(r.amount ?? 0));
  }
  const topVendors = Array.from(vendorTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([vendor, total]) => ({ vendor, total }));

  // ── 12-month series (cash + expenses + profit) ──
  type MonthSeries = { month: string; netCash: number; expenses: number; profit: number };
  const monthlyMap = new Map<string, { netCash: number; expenses: number }>();
  for (const m of trendMonths) monthlyMap.set(m, { netCash: 0, expenses: 0 });
  for (const r of (t07Year.data ?? []) as IncRowT[]) {
    const ym = (r.date ?? '').slice(0, 7);
    if (!monthlyMap.has(ym)) continue;
    const ptype = (r.payment_type ?? '').toLowerCase();
    const status = (r.status ?? '').toLowerCase();
    if (ptype === 'excluded') continue;
    const amt = Number(r.final_amount ?? r.amount ?? 0);
    const e = monthlyMap.get(ym)!;
    if (status === 'refunded' || ptype === 'refund') e.netCash -= Math.abs(amt);
    else if (status === 'paid') e.netCash += amt;
  }
  for (const r of (t08Year.data ?? []) as ExpRow[]) {
    const ym = (r.date ?? '').slice(0, 7);
    if (!monthlyMap.has(ym)) continue;
    const cat = (r.expense_type ?? '').toLowerCase();
    if (!cat || cat === 'unknown' || cat === 'other') continue;
    if (cat === 'personal' || cat === "personal (shouldn't be there)") continue;
    monthlyMap.get(ym)!.expenses += Number(r.amount ?? 0);
  }
  const monthlySeries: MonthSeries[] = trendMonths.map((m) => {
    const v = monthlyMap.get(m)!;
    return { month: m, netCash: v.netCash, expenses: v.expenses, profit: v.netCash - v.expenses };
  });
  const ytdSeries = monthlySeries.filter((m) => m.month >= yearStart.slice(0, 7));
  const ytdNetCash = ytdSeries.reduce((s, m) => s + m.netCash, 0);
  const ytdExpenses = ytdSeries.reduce((s, m) => s + m.expenses, 0);
  const ytdProfit = ytdNetCash - ytdExpenses;
  const monthsElapsedInYear = ytdSeries.filter((m) => m.netCash > 0 || m.expenses > 0).length || 1;
  // the operator 2026-05-02: explicit annual goal of $12M for ProgB (his
  // stated target). Falls back to monthly-target × 12 if a different
  // year is being viewed.
  const yearKey = month.slice(0, 4);
  const ANNUAL_TARGETS: Record<string, number> = { '2026': 12_000_000 };
  const annualTargetCash = ANNUAL_TARGETS[yearKey] ?? (monthlyRevTarget * 12);
  const annualPacePct = annualTargetCash > 0 ? (ytdNetCash / annualTargetCash) * 100 : null;
  const monthsElapsedPct = (monthsElapsedInYear / 12) * 100;
  const bestMonth = [...monthlySeries].sort((a, b) => b.netCash - a.netCash)[0];
  const worstMonth = [...monthlySeries].filter((m) => m.netCash > 0).sort((a, b) => a.netCash - b.netCash)[0] || null;

  // ── Year trajectory: Jan-Dec of the requested month's year ──
  // the operator 2026-05-02: he wants the Year So Far card to look like the
  // main dashboard's Revenue Trajectory (cumulative actual + target
  // reference + projected EOY) but at year scale instead of month scale.
  //
  // Historical-month overrides: the operator supplied actual Jan/Feb/Mar
  // numbers manually (data wasn't in t07/t08 since those tables only
  // got populated mid-April). We use these as-is for those months;
  // April onward computes from Supabase live.
  const HISTORICAL_OVERRIDES: Record<string, { revenue: number; expenses: number; profit: number }> = {
    '2026-01': { revenue: 286_323,    expenses: 140_753.66, profit: 145_569.34 },
    '2026-02': { revenue: 393_000,    expenses: 226_108,    profit: 166_892 },
    '2026-03': { revenue: 298_636,    expenses: 173_000,    profit: 116_269.36 },
  };
  const yearMonthsAll: string[] = [];
  for (let m = 1; m <= 12; m++) yearMonthsAll.push(`${yearKey}-${pad(m)}`);
  const yearMap = new Map<string, { netCash: number; expenses: number; profit: number; isOverride: boolean }>();
  for (const m of yearMonthsAll) {
    const ovr = HISTORICAL_OVERRIDES[m];
    if (ovr) {
      yearMap.set(m, { netCash: ovr.revenue, expenses: ovr.expenses, profit: ovr.profit, isOverride: true });
    } else {
      yearMap.set(m, { netCash: 0, expenses: 0, profit: 0, isOverride: false });
    }
  }
  for (const r of (t07YearArr) as IncRowFull[]) {
    const ym = (r.date ?? '').slice(0, 7);
    if (!yearMap.has(ym)) continue;
    if (yearMap.get(ym)!.isOverride) continue; // skip months that are manually backlogged
    const ptype = (r.payment_type ?? '').toLowerCase();
    const status = (r.status ?? '').toLowerCase();
    if (ptype === 'excluded') continue;
    const amt = Number(r.final_amount ?? r.amount ?? 0);
    const e = yearMap.get(ym)!;
    if (status === 'refunded' || ptype === 'refund') e.netCash -= Math.abs(amt);
    else if (status === 'paid') e.netCash += amt;
  }
  for (const r of (t08YearArr) as ExpRowFull[]) {
    const ym = (r.date ?? '').slice(0, 7);
    if (!yearMap.has(ym)) continue;
    if (yearMap.get(ym)!.isOverride) continue;
    const cat = (r.expense_type ?? '').toLowerCase();
    if (!cat || cat === 'unknown' || cat === 'other') continue;
    if (cat === 'personal' || cat === "personal (shouldn't be there)") continue;
    yearMap.get(ym)!.expenses += Number(r.amount ?? 0);
  }
  // Compute profit for non-override months
  for (const [, v] of yearMap) {
    if (!v.isOverride) v.profit = v.netCash - v.expenses;
  }

  // Walk Jan-Dec, building cumulative actual / linear-target / projected
  // lines for THREE metrics: revenue, expenses, profit. Annual goals:
  //   revenue:  $12M (the operator stated)
  //   expenses: $3M  (≈25% of revenue — typical for ProgB)
  //   profit:   $9M  (revenue annual - expense cap)
  // the operator can swap these later via t21 'annual_*' rows.
  const ANNUAL_EXPENSE_CAP = annualTargetCash * 0.25;
  const ANNUAL_PROFIT_GOAL = annualTargetCash - ANNUAL_EXPENSE_CAP;

  // monthsCompleted = months with non-zero data up to and including current.
  let monthsWithData = 0;
  for (const m of yearMonthsAll) {
    if (m > month) break;
    const v = yearMap.get(m)!;
    if (v.netCash > 0 || v.expenses > 0 || v.isOverride) monthsWithData += 1;
  }
  const monthIndex0 = Math.max(1, monthsWithData);

  // Cumulative-through-current for each metric (projection anchor)
  let cumRevThroughCurrent = 0, cumExpThroughCurrent = 0, cumProfThroughCurrent = 0;
  for (const m of yearMonthsAll) {
    if (m > month) break;
    const v = yearMap.get(m)!;
    cumRevThroughCurrent += v.netCash;
    cumExpThroughCurrent += v.expenses;
    cumProfThroughCurrent += v.profit;
  }
  const runRateRevenue = monthIndex0 > 0 ? cumRevThroughCurrent / monthIndex0 : 0;
  const runRateExpenses = monthIndex0 > 0 ? cumExpThroughCurrent / monthIndex0 : 0;
  const runRateProfit = monthIndex0 > 0 ? cumProfThroughCurrent / monthIndex0 : 0;

  let cumRev = 0, cumExp = 0, cumProf = 0;
  const yearSeries = yearMonthsAll.map((m, idx) => {
    const monthNum = idx + 1;
    const v = yearMap.get(m)!;
    const isFuture = m > month;
    if (!isFuture) { cumRev += v.netCash; cumExp += v.expenses; cumProf += v.profit; }
    const targetRev = (annualTargetCash / 12) * monthNum;
    const targetExp = (ANNUAL_EXPENSE_CAP / 12) * monthNum;
    const targetProf = (ANNUAL_PROFIT_GOAL / 12) * monthNum;
    let projRev: number | null = null, projExp: number | null = null, projProf: number | null = null;
    if (isFuture) {
      const monthsAhead = monthNum - monthIndex0;
      projRev  = cumRevThroughCurrent  + runRateRevenue * monthsAhead;
      projExp  = cumExpThroughCurrent  + runRateExpenses * monthsAhead;
      projProf = cumProfThroughCurrent + runRateProfit * monthsAhead;
    }
    return {
      month: m,
      monthLabel: new Date(Number(yearKey), monthNum - 1, 1).toLocaleString('en-US', { month: 'short' }),
      // monthly numbers (for tooltip)
      monthlyRevenue: v.netCash,
      monthlyExpenses: v.expenses,
      monthlyProfit: v.profit,
      // cumulative actual lines (null on future months)
      cumRevenue: isFuture ? null : cumRev,
      cumExpenses: isFuture ? null : cumExp,
      cumProfit: isFuture ? null : cumProf,
      // linear target lines (always present)
      targetRevenue: targetRev,
      targetExpenses: targetExp,
      targetProfit: targetProf,
      // projected continuation (only future months)
      projectedRevenue: projRev,
      projectedExpenses: projExp,
      projectedProfit: projProf,
      isFuture,
      isOverride: v.isOverride,
    };
  });

  const monthsRemaining = 12 - monthIndex0;
  const projectedEoyRevenue  = cumRevThroughCurrent  + runRateRevenue  * monthsRemaining;
  const projectedEoyExpenses = cumExpThroughCurrent  + runRateExpenses * monthsRemaining;
  const projectedEoyProfit   = cumProfThroughCurrent + runRateProfit   * monthsRemaining;
  const gapToTarget = projectedEoyRevenue - annualTargetCash;
  const paceNeeded = monthsRemaining > 0
    ? Math.max(0, annualTargetCash - cumRevThroughCurrent) / monthsRemaining
    : 0;
  // Pace gap = where you SHOULD be by end of selected month vs where you ARE.
  // This is what the operator wants front-and-center — much more meaningful than
  // EOY projected gap because it tells you "are we on track right now?"
  const linearTargetThroughCurrent = (annualTargetCash / 12) * monthIndex0;
  const paceGapRevenue = cumRevThroughCurrent - linearTargetThroughCurrent;
  const linearExpThroughCurrent = (ANNUAL_EXPENSE_CAP / 12) * monthIndex0;
  const paceGapExpenses = cumExpThroughCurrent - linearExpThroughCurrent;
  const linearProfThroughCurrent = (ANNUAL_PROFIT_GOAL / 12) * monthIndex0;
  const paceGapProfit = cumProfThroughCurrent - linearProfThroughCurrent;

  // Override YTD totals from the new yearMap (which respects historical
  // overrides for Jan/Feb/Mar). The earlier monthlySeries-based ytd
  // calculation only captured live months and missed the backlog.
  const ytdNetCashCorrected  = cumRevThroughCurrent;
  const ytdExpensesCorrected = cumExpThroughCurrent;
  const ytdProfitCorrected   = cumProfThroughCurrent;
  const ytdMarginCorrected   = ytdNetCashCorrected > 0 ? (ytdProfitCorrected / ytdNetCashCorrected) * 100 : 0;
  const annualPacePctCorrected = annualTargetCash > 0 ? (ytdNetCashCorrected / annualTargetCash) * 100 : null;
  // Best/worst month re-pulled from yearMap (which has overrides) so April
  // doesn't get crowned best when Feb actually was.
  type MPt = { month: string; netCash: number; expenses: number; profit: number };
  const yearMonthlyArr: MPt[] = yearMonthsAll
    .filter((m) => m <= month)
    .map((m) => {
      const v = yearMap.get(m)!;
      return { month: m, netCash: v.netCash, expenses: v.expenses, profit: v.profit };
    });
  const bestMonthCorr = [...yearMonthlyArr].sort((a, b) => b.netCash - a.netCash)[0] ?? bestMonth;
  const worstMonthCorr = [...yearMonthlyArr].filter((m) => m.netCash > 0).sort((a, b) => a.netCash - b.netCash)[0] ?? null;

  const yearSoFar = {
    yearSeries,
    monthlySeries,
    ytd: {
      netCash: ytdNetCashCorrected,
      expenses: ytdExpensesCorrected,
      profit: ytdProfitCorrected,
      marginPct: ytdMarginCorrected,
    },
    annualTargetCash,
    annualExpenseCap: ANNUAL_EXPENSE_CAP,
    annualProfitGoal: ANNUAL_PROFIT_GOAL,
    annualPacePct: annualPacePctCorrected,
    monthsElapsedPct,
    onPace: annualPacePctCorrected !== null ? annualPacePctCorrected >= monthsElapsedPct : null,
    bestMonth: bestMonthCorr,
    worstMonth: worstMonthCorr,
    momGrowthPct: incomePrior.net > 0 ? ((incomeThis.net - incomePrior.net) / incomePrior.net) * 100 : null,
    // Trajectory metrics (matches Revenue Trajectory shape) — per metric
    runRate: { revenue: runRateRevenue, expenses: runRateExpenses, profit: runRateProfit },
    paceNeeded,
    projectedEoy: { revenue: projectedEoyRevenue, expenses: projectedEoyExpenses, profit: projectedEoyProfit },
    gapToTarget,
    paceGap: { revenue: paceGapRevenue, expenses: paceGapExpenses, profit: paceGapProfit },
    monthsRemaining,
    monthsCompleted: monthIndex0,
    yearKey,
  };

  // ── Revenue Quality ──
  type DealRow = { date_closed: string; closer: string | null; source: string | null; offer: string | null; cash_collected: number | string | null; contracted_revenue: number | string | null; deal_type: string | null };
  const dealsThis = (t06This.data ?? []) as DealRow[];

  // AR aging — uses contracted_revenue minus cash_collected per deal in
  // a synthetic 30/60/90+ bucket based on date_closed age vs `to`.
  const today = todayET();
  const todayMs = new Date(today + 'T12:00:00Z').getTime();
  const agingBuckets = { current: 0, d30: 0, d60: 0, d90Plus: 0 };
  for (const d of dealsThis) {
    const cash = Number(d.cash_collected ?? 0);
    const contracted = Number(d.contracted_revenue ?? 0);
    const owed = Math.max(0, contracted - cash);
    if (owed === 0) continue;
    const ms = new Date(d.date_closed + 'T12:00:00Z').getTime();
    const ageDays = (todayMs - ms) / (1000 * 60 * 60 * 24);
    if (ageDays <= 30) agingBuckets.current += owed;
    else if (ageDays <= 60) agingBuckets.d30 += owed;
    else if (ageDays <= 90) agingBuckets.d60 += owed;
    else agingBuckets.d90Plus += owed;
  }

  // CSM upsells per CSM (target ≥ 2 each per the operator's weekly checklist)
  const CSM_UPSELL_TARGET = 2;
  const csmCounts = new Map<string, { upsells: number; cash: number }>();
  for (const d of dealsThis) {
    if (!matchRoleFirstName(d.closer, csmFirstNames)) continue;
    const name = (d.closer ?? '').trim();
    const ent = csmCounts.get(name) ?? { upsells: 0, cash: 0 };
    const dt = (d.deal_type ?? '').toLowerCase();
    if (dt === 'upsell' || dt === 'renewal' || dt === 'upgrade') ent.upsells += 1;
    ent.cash += Number(d.cash_collected ?? 0);
    csmCounts.set(name, ent);
  }
  const csmUpsells = Array.from(csmCounts.entries()).map(([name, v]) => ({ name, upsells: v.upsells, cash: v.cash, hitTarget: v.upsells >= CSM_UPSELL_TARGET }));

  // Channel breakdown (which underperformed)
  const channelCash = new Map<string, number>();
  for (const d of dealsThis) {
    const src = canonSource(d.source);
    channelCash.set(src, (channelCash.get(src) ?? 0) + Number(d.cash_collected ?? 0));
  }
  const channelBreakdown = Array.from(channelCash.entries()).map(([source, cash]) => ({ source, cash })).sort((a, b) => b.cash - a.cash);

  const revenueQuality = {
    cashTarget: monthlyCashTarget,
    cashActual: incomeThis.newCash,
    cashGap: incomeThis.newCash - monthlyCashTarget,
    cashHit: monthlyCashTarget > 0 ? incomeThis.newCash >= monthlyCashTarget : null,
    arTarget: monthlyArTarget,
    arActual: incomeThis.ar,
    arGap: incomeThis.ar - monthlyArTarget,
    arHit: monthlyArTarget > 0 ? incomeThis.ar >= monthlyArTarget : null,
    netRevenue: incomeThis.net,
    refunds: incomeThis.refunds,
    refundRatePct: incomeThis.gross > 0 ? (incomeThis.refunds / incomeThis.gross) * 100 : 0,
    profitabilityTarget: monthlyRevTarget - monthlyExpenseCap,
    profitabilityActual: incomeThis.net - expThis.total,
    arAging: agingBuckets,
    csmUpsells,
    csmTarget: CSM_UPSELL_TARGET,
    channelBreakdown,
  };

  // ── Constraint Diagnosis ──
  // Score each pillar 0-100. Lower = bigger problem.
  // Acquisition: lead volume vs prior month
  // Sales: combined show% (target 70) + close% (target 25) blended
  // Fulfillment: refund rate (lower = better) + AR collection rate
  // Team: count of CSMs hitting upsell + closer activity
  type Eod = { closer_name: string | null; calls_booked: number | null; calls_shown: number | null; calls_closed: number | null; no_shows: number | null; calls_cancelled: number | null; cash_collected: number | string | null };
  const eod = (t05This.data ?? []) as Eod[];
  let totalBooked = 0, totalShown = 0, totalNoShows = 0, totalCancelled = 0, totalClosed = 0;
  for (const e of eod) {
    totalBooked += Number(e.calls_booked ?? 0);
    totalShown += Number(e.calls_shown ?? 0);
    totalNoShows += Number(e.no_shows ?? 0);
    totalCancelled += Number(e.calls_cancelled ?? 0);
    totalClosed += Number(e.calls_closed ?? 0);
  }
  const showRate = (totalBooked - totalCancelled) > 0 ? (totalShown / (totalBooked - totalCancelled)) * 100 : 0;
  const closeRate = totalShown > 0 ? (totalClosed / totalShown) * 100 : 0;
  const leadsThis = (t01This.data ?? []) as Array<{ source: string | null; date: string }>;
  const leadCount = leadsThis.length;
  const totalContracted = dealsThis.reduce((s, d) => s + Number(d.contracted_revenue ?? 0), 0);
  const totalCashFromDeals = dealsThis.reduce((s, d) => s + Number(d.cash_collected ?? 0), 0);
  const arCollectionPct = totalContracted > 0 ? (totalCashFromDeals / totalContracted) * 100 : 100;

  // Score 0-100 each pillar (higher = healthier)
  const SHOW_TARGET = 70, CLOSE_TARGET = 25;
  const acquisitionScore = leadCount >= 100 ? 100 : (leadCount / 100) * 100;
  const salesScore = ((Math.min(showRate, SHOW_TARGET) / SHOW_TARGET) * 50) + ((Math.min(closeRate, CLOSE_TARGET) / CLOSE_TARGET) * 50);
  const refundPenalty = Math.min(revenueQuality.refundRatePct * 2, 50);
  const fulfillmentScore = Math.max(0, (arCollectionPct - refundPenalty));
  const csmHitCount = csmUpsells.filter((c) => c.hitTarget).length;
  const totalCsms = csmUpsells.length;
  const teamScore = totalCsms > 0 ? (csmHitCount / totalCsms) * 100 : 50;

  const pillars = [
    { name: 'Acquisition', score: acquisitionScore, hint: `${leadCount} leads this month` },
    { name: 'Sales',       score: salesScore,       hint: `${showRate.toFixed(0)}% show · ${closeRate.toFixed(0)}% close` },
    { name: 'Fulfillment', score: fulfillmentScore, hint: `${revenueQuality.refundRatePct.toFixed(1)}% refund · ${arCollectionPct.toFixed(0)}% AR collection` },
    { name: 'Team',        score: teamScore,        hint: `${csmHitCount}/${totalCsms} CSMs hit upsell target` },
  ].sort((a, b) => a.score - b.score);
  const constraint = {
    pillar: pillars[0]?.name ?? null,
    score: pillars[0]?.score ?? 0,
    hint: pillars[0]?.hint ?? '',
    pillars,
  };

  // ── Expense Efficiency ──
  const categoryTargets: Record<string, number> = {};
  for (const r of (t21Targets.data ?? []) as Array<{ section: string | null; metric: string | null; target_value: number | string | null }>) {
    if ((r.section ?? '').toLowerCase() !== 'expenses') continue;
    const m = (r.metric ?? '').toLowerCase();
    const bucket = m.includes('labor') || m.includes('labour') ? 'labour'
      : m.includes('marketing') ? 'marketing'
      : m.includes('overhead') ? 'overhead'
      : m.includes('coaching') ? 'coaching'
      : 'other';
    categoryTargets[bucket] = (categoryTargets[bucket] ?? 0) + Number(r.target_value ?? 0);
  }
  const expenseCategories = ['marketing', 'labour', 'overhead', 'coaching']
    .map((k) => ({
      category: k,
      actual: expThis.byCategory[k] ?? 0,
      target: categoryTargets[k] ?? 0,
      overBy: (expThis.byCategory[k] ?? 0) - (categoryTargets[k] ?? 0),
      overBudget: (categoryTargets[k] ?? 0) > 0 && (expThis.byCategory[k] ?? 0) > (categoryTargets[k] ?? 0),
      pctOfTarget: (categoryTargets[k] ?? 0) > 0 ? ((expThis.byCategory[k] ?? 0) / (categoryTargets[k] ?? 0)) * 100 : null,
    }))
    .sort((a, b) => b.overBy - a.overBy);

  const expenseEfficiency = {
    actual: expThis.total,
    target: monthlyExpenseCap,
    overBy: expThis.total - monthlyExpenseCap,
    momDelta: expThis.total - expPrior.total,
    categories: expenseCategories,
    biggestOverspend: expenseCategories[0]?.overBudget ? expenseCategories[0] : null,
    topVendors,
  };

  // ── Double Down / Kill ──
  // Top funnel = top channel by cash
  const topFunnel = channelBreakdown[0] ?? null;
  // Best closer = highest close rate AND lowest refund rate (refund per closer
  // not in t05 — approximate by closer cash on closed deals).
  const closerStats = new Map<string, { booked: number; shown: number; closed: number; cash: number }>();
  for (const e of eod) {
    if (!matchRoleFirstName(e.closer_name, closerFirstNames)) continue;
    const name = (e.closer_name ?? '').trim();
    const v = closerStats.get(name) ?? { booked: 0, shown: 0, closed: 0, cash: 0 };
    v.booked += Number(e.calls_booked ?? 0);
    v.shown += Number(e.calls_shown ?? 0);
    v.closed += Number(e.calls_closed ?? 0);
    v.cash += Number(e.cash_collected ?? 0);
    closerStats.set(name, v);
  }
  const closerRanking = Array.from(closerStats.entries()).map(([name, v]) => ({
    name,
    closeRate: v.shown > 0 ? (v.closed / v.shown) * 100 : 0,
    cashPerCall: v.shown > 0 ? Math.round(v.cash / v.shown) : 0,
    cash: v.cash,
    shown: v.shown,
  })).filter((c) => c.shown >= 5).sort((a, b) => b.closeRate - a.closeRate);
  const bestCloser = closerRanking[0] ?? null;

  // Best setter = most calls booked (proxy for most "shows that closed")
  const setterStats = new Map<string, { booked: number; shown: number }>();
  for (const e of eod) {
    if (!matchRoleFirstName(e.closer_name, setterFirstNames)) continue;
    const name = (e.closer_name ?? '').trim();
    const v = setterStats.get(name) ?? { booked: 0, shown: 0 };
    v.booked += Number(e.calls_booked ?? 0);
    v.shown += Number(e.calls_shown ?? 0);
    setterStats.set(name, v);
  }
  const setterRanking = Array.from(setterStats.entries()).map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.booked - a.booked);
  const bestSetter = setterRanking[0] ?? null;

  const doubleDownKill = {
    topFunnel,
    bestCloser,
    bestSetter,
    closerRanking,
    setterRanking,
    channelBreakdown,
  };

  return NextResponse.json(
    {
      configured: true,
      month,
      window: { from, to },
      yearSoFar,
      revenueQuality,
      constraint,
      expenseEfficiency,
      doubleDownKill,
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate' } }
  );
}
