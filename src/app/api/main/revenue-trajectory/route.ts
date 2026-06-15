import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const revalidate = 60;
export const dynamic = 'force-dynamic';

// Cached t07 fetch for revenue-trajectory. Used by both the current-period
// and prior-period queries, so a single helper keyed by (from,to) serves both.
type TrajRow = {
  date: string;
  final_amount: number | string | null;
  amount: number | string | null;
  status: string | null;
  payment_type: string | null;
};

const fetchTrajectoryRows = unstable_cache(
  async (from: string, to: string): Promise<TrajRow[]> => {
    const supa = await getServerSupabaseAsync();
    if (!supa) return [];
    const all: TrajRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supa
        .from('t07_income_processors')
        .select('date, final_amount, amount, status, payment_type')
        .eq('review_status', 'approved')  // ← Payment Review Queue gate
        .gte('date', from)
        .lte('date', to)
        .range(offset, offset + 999);
      if (error) throw new Error(error.message ?? 'query_failed');
      if (!data || data.length === 0) break;
      all.push(...(data as TrajRow[]));
      if (data.length < 1000) break;
    }
    return all;
  },
  ['main:revenue-trajectory:t07'],
  { revalidate: 60, tags: ['t07'] },
);

/**
 * GET /api/main/revenue-trajectory?month=YYYY-MM
 *
 * Powers the Revenue Trajectory card on the Main Dashboard. Returns the
 * data needed for the cumulative-MTD line chart:
 *
 *   - Daily cumulative net revenue (per day from day 1 → today)
 *   - Monthly target (sum of saved targets from t21_monthly_projections)
 *   - Days elapsed + days remaining + days in month
 *   - Daily run-rate (mtd_total / days_elapsed)
 *   - Projected EOM at current run-rate
 *   - Status: ahead / on_pace / behind / critical relative to target
 *
 * the operator 2026-04-30: keeps consistent with the rest of the dashboard:
 *   - Net revenue source = t07_income_processors (matches Revenue
 *     Composition's netRevenue)
 *   - Targets source = t21_monthly_projections (matches Pace vs Projection)
 *   - Refunds subtracted (matches netRevenue calculation)
 */

interface DailyPoint {
  date: string; // YYYY-MM-DD
  daily: number; // net revenue on this day
  cumulative: number; // running revenue total through this day
  target: number; // pace-adjusted REVENUE target for this day (linear pace × days_so_far)
  // Expense + profit overlays
  dailyExpense: number; // expenses on this day
  cumulativeExpense: number; // running expense total through this day
  expenseTarget: number; // OLD: linear pace from fixed expense cap (kept for back-compat)
  cumulativeProfit: number; // cumulative - cumulativeExpense
  // the operator 2026-04-30: expense + profit goals should SCALE WITH ACTUAL
  // REVENUE, not be locked to a fixed monthly cap. If revenue is 75% of
  // target, expenses should be allowed up to 75% of cap (labor is a % of
  // revenue, marketing is a % of revenue, etc.). These two fields express
  // the revenue-adjusted goal at this day's actual cumulative revenue:
  expenseTargetAdj: number; // = expensePctOfRevenue × cumulative
  profitTargetAdj: number;  // = profitMarginPct × cumulative
}

interface PriorMonthPoint {
  day: number; // day-of-month
  cumulative: number; // running total through that day
}

// the operator 2026-04-30: defensive ET fallback — same as the other
// month-aware routes. Old client bundles compute month via
// toISOString().slice(0,7) which lands on next month at evening ET.
import { monthYM_ET } from '@/lib/timeframe';

function monthBounds(monthParam: string | null): { from: string; to: string; year: number; mon: number } {
  const currentET = monthYM_ET();
  let resolved = currentET;
  if (monthParam) {
    const m = /^(\d{4})-(\d{2})$/.exec(monthParam);
    if (m) {
      const requested = `${m[1]}-${m[2]}`;
      resolved = requested > currentET ? currentET : requested;
    }
  }
  const [yStr, mStr] = resolved.split('-');
  const year = Number(yStr);
  const mon = Number(mStr);
  const last = new Date(year, mon, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    from: `${year}-${pad(mon)}-01`,
    to: `${year}-${pad(mon)}-${pad(last)}`,
    year,
    mon,
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const monthParam = url.searchParams.get('month');
  const { from, to, year, mon } = monthBounds(monthParam);
  const monthKey = `${year}-${String(mon).padStart(2, '0')}`;

  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ configured: false, points: [], target: 0 }, { status: 500 });
  }

  // ── Pull all paid + refund t07 rows + t08 expenses for the month ────
  // t07 reads are cached for 60s per (from,to) via unstable_cache.
  type Row = TrajRow;
  type ExpRow = { date: string; amount: number | string | null; expense_type: string | null };
  let all: Row[];
  try {
    all = await fetchTrajectoryRows(from, to);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'query_failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Pull expenses for the month (t08). Treat 'personal'/'unknown' as
  // out-of-scope (matching the Pace vs Projection convention), everything
  // else counts toward operating expenses.
  const allExpenses: ExpRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data } = await supa
      .from('t08_expenses')
      .select('date, amount, expense_type')
      .gte('date', from)
      .lte('date', to)
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allExpenses.push(...(data as ExpRow[]));
    if (data.length < 1000) break;
  }

  // ── Sum saved monthly targets so the chart has the same goal as Pace ──
  let monthlyTarget = 0;
  let expenseCap = 0;
  try {
    const { data: tRows } = await supa
      .from('t21_monthly_projections')
      .select('section, kind, target_value')
      .eq('month', monthKey);
    for (const r of (tRows ?? []) as Array<{ section: string | null; kind: string | null; target_value: number | string | null }>) {
      const v = Number(r.target_value ?? 0);
      // Match the Pace vs Projection card's "PROJECTED REVENUE" calc:
      //   cash_collected + receivables - refunds (expenses ignored).
      const sec = (r.section ?? '').toLowerCase();
      if (sec === 'cash_collected' || sec === 'receivables') monthlyTarget += v;
      else if (sec === 'refunds') monthlyTarget -= v;
      else if (sec === 'expenses') expenseCap += v; // total expense budget for the month
    }
  } catch {
    // No targets saved yet — leave at 0
  }

  // ── Build daily map: date → { paid, refunds } ─────────────────────────
  const lastDay = Number(to.slice(8, 10));
  const dailyMap = new Map<string, number>(); // date → net revenue (paid - refunds)
  const dailyExpenseMap = new Map<string, number>(); // date → expenses
  for (let day = 1; day <= lastDay; day += 1) {
    const dateStr = `${monthKey}-${String(day).padStart(2, '0')}`;
    dailyMap.set(dateStr, 0);
    dailyExpenseMap.set(dateStr, 0);
  }
  for (const r of all) {
    const ptype = String(r.payment_type ?? '').toLowerCase();
    const status = String(r.status ?? '').toLowerCase();
    // Skip 'excluded' — wrong-business / mis-routed payments.
    if (ptype === 'excluded') continue;
    const amt = Number(r.final_amount ?? r.amount ?? 0);
    const isRefund = status === 'refunded' || ptype === 'refund';
    const isPaidNet = status === 'paid' && !isRefund;
    if (!isPaidNet && !isRefund) continue;
    const date = r.date;
    if (!dailyMap.has(date)) continue;
    if (isPaidNet) dailyMap.set(date, dailyMap.get(date)! + amt);
    else if (isRefund) dailyMap.set(date, dailyMap.get(date)! - Math.abs(amt));
  }
  // Aggregate daily expenses (skip out-of-scope categories per Pace vs
  // Projection convention: 'personal', 'unknown', empty all ignored).
  for (const e of allExpenses) {
    const cat = String(e.expense_type ?? '').toLowerCase();
    if (!cat || cat === 'personal' || cat === "personal (shouldn't be there)" || cat === 'unknown' || cat === 'other') continue;
    const amt = Number(e.amount ?? 0);
    if (!dailyExpenseMap.has(e.date)) continue;
    dailyExpenseMap.set(e.date, dailyExpenseMap.get(e.date)! + amt);
  }

  // ── Determine "today" relative to the month being viewed ──────────────
  const todayObj = new Date();
  const todayMonthKey = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}`;
  const isCurrentMonth = todayMonthKey === monthKey;
  const todayDay = isCurrentMonth
    ? todayObj.getDate()
    : monthKey > todayMonthKey
    ? 0 // future month — nothing happened yet
    : lastDay; // past month — fully elapsed

  // Daily target = monthlyTarget / lastDay (linear pace)
  const dailyPace = lastDay > 0 ? monthlyTarget / lastDay : 0;
  const dailyExpensePace = lastDay > 0 ? expenseCap / lastDay : 0;

  // the operator 2026-04-30: revenue-adjusted goals.
  // expensePctOfRevenue = what fraction of revenue we BUDGETED for expenses.
  // profitMarginPct      = what fraction of revenue we BUDGETED as profit.
  // These ratios stay constant; the dollar goals scale with actual revenue.
  const expensePctOfRevenue = monthlyTarget > 0 ? expenseCap / monthlyTarget : 0;
  const profitMarginPct = monthlyTarget > 0 ? (monthlyTarget - expenseCap) / monthlyTarget : 0;

  // ── Build the points array ─────────────────────────────────────────────
  const points: DailyPoint[] = [];
  let cumulative = 0;
  let cumulativeExpense = 0;
  for (let day = 1; day <= lastDay; day += 1) {
    const dateStr = `${monthKey}-${String(day).padStart(2, '0')}`;
    const daily = dailyMap.get(dateStr) ?? 0;
    const dailyExp = dailyExpenseMap.get(dateStr) ?? 0;
    cumulative += daily;
    cumulativeExpense += dailyExp;
    points.push({
      date: dateStr,
      daily,
      cumulative,
      target: dailyPace * day,
      dailyExpense: dailyExp,
      cumulativeExpense,
      expenseTarget: dailyExpensePace * day,
      cumulativeProfit: cumulative - cumulativeExpense,
      // Revenue-adjusted goal lines that follow the actual revenue curve:
      expenseTargetAdj: expensePctOfRevenue * cumulative,
      profitTargetAdj: profitMarginPct * cumulative,
    });
  }

  const mtdTotal = todayDay > 0 ? points[Math.min(todayDay, lastDay) - 1].cumulative : 0;
  const mtdExpense = todayDay > 0 ? points[Math.min(todayDay, lastDay) - 1].cumulativeExpense : 0;
  const mtdProfit = mtdTotal - mtdExpense;
  const dailyRunRate = todayDay > 0 ? mtdTotal / todayDay : 0;
  const dailyExpenseRunRate = todayDay > 0 ? mtdExpense / todayDay : 0;
  const projectedEom = dailyRunRate * lastDay;
  const projectedEomExpense = dailyExpenseRunRate * lastDay;
  const projectedEomProfit = projectedEom - projectedEomExpense;
  const pctOfTarget = monthlyTarget > 0 ? (mtdTotal / monthlyTarget) * 100 : 0;
  const projectedPctOfTarget = monthlyTarget > 0 ? (projectedEom / monthlyTarget) * 100 : 0;
  const expensePctOfCap = expenseCap > 0 ? (mtdExpense / expenseCap) * 100 : 0;
  const projectedExpensePctOfCap = expenseCap > 0 ? (projectedEomExpense / expenseCap) * 100 : 0;
  const profitTarget = monthlyTarget - expenseCap;

  // ── Revenue-adjusted goals (scale with actual revenue, not fixed) ─────
  // expenseGoalAtMtdRev    = what we SHOULD have spent given MTD revenue
  // expenseGoalAtProjected = what we should spend by EOM at projected revenue
  // Profit equivalents track the same way.
  const expenseGoalAtMtdRev = expensePctOfRevenue * mtdTotal;
  const expenseGoalAtProjectedRev = expensePctOfRevenue * projectedEom;
  const profitGoalAtMtdRev = profitMarginPct * mtdTotal;
  const profitGoalAtProjectedRev = profitMarginPct * projectedEom;

  // Status: where will we end up vs target?
  let status: 'ahead' | 'on_pace' | 'behind' | 'critical' = 'on_pace';
  if (projectedPctOfTarget >= 100) status = 'ahead';
  else if (projectedPctOfTarget >= 90) status = 'on_pace';
  else if (projectedPctOfTarget >= 75) status = 'behind';
  else status = 'critical';

  // ── Momentum: count consecutive days at the END of the elapsed period
  //    that were above-pace (good streak) vs below-pace (warning streak).
  //    "Above pace" = day's incremental >= dailyPace.
  let streakDays = 0;
  let streakDirection: 'above' | 'below' = 'above';
  if (todayDay > 0 && dailyPace > 0) {
    // Walk backward from today
    for (let i = Math.min(todayDay, lastDay) - 1; i >= 0; i -= 1) {
      const d = points[i].daily;
      const above = d >= dailyPace;
      if (i === Math.min(todayDay, lastDay) - 1) {
        streakDirection = above ? 'above' : 'below';
        streakDays = 1;
      } else if ((above && streakDirection === 'above') || (!above && streakDirection === 'below')) {
        streakDays += 1;
      } else {
        break;
      }
    }
  }

  // ── Days behind / ahead: cumulative behavior translated to "calendar
  //    days of pace owed". = (mtd_target - mtd_actual) / dailyPace
  const mtdTargetSoFar = todayDay > 0 ? dailyPace * todayDay : 0;
  const daysBehind = dailyPace > 0 ? (mtdTargetSoFar - mtdTotal) / dailyPace : 0;

  // ── Prior month: same shape, used by the chart's overlay ──────────────
  let priorMonthPoints: PriorMonthPoint[] = [];
  let priorMonthLabel = '';
  let priorMonthTotal = 0;
  try {
    const priorMonObj = new Date(year, mon - 2, 1);
    const priorYear = priorMonObj.getFullYear();
    const priorMon = priorMonObj.getMonth() + 1;
    const priorLast = new Date(priorYear, priorMon, 0).getDate();
    const pad = (n: number) => String(n).padStart(2, '0');
    const priorFrom = `${priorYear}-${pad(priorMon)}-01`;
    const priorTo = `${priorYear}-${pad(priorMon)}-${pad(priorLast)}`;
    priorMonthLabel = priorMonObj.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    // Prior-period t07 read goes through the same cached helper so a
    // repeat request for the same month hits cache for both windows.
    let priorRows: Row[] = [];
    try {
      priorRows = await fetchTrajectoryRows(priorFrom, priorTo);
    } catch {
      // Prior-period fetch failure is non-fatal — the chart overlay is
      // optional. Fall through with the empty array.
      priorRows = [];
    }
    const priorDaily = new Map<string, number>();
    for (let day = 1; day <= priorLast; day += 1) {
      priorDaily.set(`${priorYear}-${pad(priorMon)}-${pad(day)}`, 0);
    }
    for (const r of priorRows) {
      const ptype = String(r.payment_type ?? '').toLowerCase();
      const status = String(r.status ?? '').toLowerCase();
      if (ptype === 'excluded') continue;
      const amt = Number(r.final_amount ?? r.amount ?? 0);
      const isRefund = status === 'refunded' || ptype === 'refund';
      const isPaidNet = status === 'paid' && !isRefund;
      if (!isPaidNet && !isRefund) continue;
      if (!priorDaily.has(r.date)) continue;
      priorDaily.set(r.date, priorDaily.get(r.date)! + (isPaidNet ? amt : -Math.abs(amt)));
    }
    let cum = 0;
    for (let day = 1; day <= priorLast; day += 1) {
      cum += priorDaily.get(`${priorYear}-${pad(priorMon)}-${pad(day)}`) ?? 0;
      priorMonthPoints.push({ day, cumulative: cum });
    }
    priorMonthTotal = cum;
  } catch {
    priorMonthPoints = [];
  }

  return NextResponse.json(
    {
      configured: true,
      month: monthKey,
      monthLabel: new Date(year, mon - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      target: monthlyTarget,
      points,
      mtdTotal,
      dailyRunRate,
      projectedEom,
      pctOfTarget,
      projectedPctOfTarget,
      todayDay,
      lastDay,
      daysRemaining: Math.max(0, lastDay - todayDay),
      status,
      // New for the trajectory enhancements (the operator 2026-04-30):
      streakDays,
      streakDirection,
      daysBehind, // positive = behind by N days of pace, negative = ahead by N
      priorMonth: { label: priorMonthLabel, total: priorMonthTotal, points: priorMonthPoints },
      // Expense + profit overlays (the operator 2026-04-30):
      expenseCap,
      profitTarget,
      mtdExpense,
      mtdProfit,
      dailyExpenseRunRate,
      projectedEomExpense,
      projectedEomProfit,
      expensePctOfCap,
      projectedExpensePctOfCap,
      // Revenue-adjusted goals — scale with actual / projected revenue:
      expensePctOfRevenue,    // budget ratio (e.g. 0.367)
      profitMarginPct,        // budget ratio (e.g. 0.633)
      expenseGoalAtMtdRev,    // what we SHOULD have spent given MTD revenue
      expenseGoalAtProjectedRev, // ditto at projected EOM revenue
      profitGoalAtMtdRev,     // what profit SHOULD be given MTD revenue
      profitGoalAtProjectedRev,
      source: 't07_income_processors (paid - refunds) + t08_expenses + t21_monthly_projections',
    },
    {
      headers: { 'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate' },
    }
  );
}
