'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ComposedChart,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
  Line,
} from 'recharts';
import { Trophy, Flame, AlertTriangle } from 'lucide-react';
import CardShell from './CardShell';
import { useTimeframe } from '@/lib/useTimeframe';

interface DailyPoint {
  date: string;
  daily: number;
  cumulative: number;
  target: number;
  dailyExpense: number;
  cumulativeExpense: number;
  expenseTarget: number;
  cumulativeProfit: number;
}

interface PriorMonthPoint { day: number; cumulative: number }

interface ApiResponse {
  configured: boolean;
  month: string;
  monthLabel: string;
  target: number;
  points: DailyPoint[];
  mtdTotal: number;
  dailyRunRate: number;
  projectedEom: number;
  pctOfTarget: number;
  projectedPctOfTarget: number;
  todayDay: number;
  lastDay: number;
  daysRemaining: number;
  status: 'ahead' | 'on_pace' | 'behind' | 'critical';
  streakDays: number;
  streakDirection: 'above' | 'below';
  daysBehind: number;
  priorMonth: { label: string; total: number; points: PriorMonthPoint[] };
  // Expense + profit fields
  expenseCap: number;
  profitTarget: number;
  mtdExpense: number;
  mtdProfit: number;
  dailyExpenseRunRate: number;
  projectedEomExpense: number;
  projectedEomProfit: number;
  expensePctOfCap: number;
  projectedExpensePctOfCap: number;
  // Revenue-adjusted goals (the operator 2026-04-30): if revenue is below
  // target, the "fair" expense ceiling and profit goal scale down too.
  expensePctOfRevenue: number;
  profitMarginPct: number;
  expenseGoalAtMtdRev: number;
  expenseGoalAtProjectedRev: number;
  profitGoalAtMtdRev: number;
  profitGoalAtProjectedRev: number;
}

type ViewMode = 'combined' | 'revenue' | 'expenses' | 'profit';

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtUSDk = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${n < 0 ? '-' : ''}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${n < 0 ? '-' : ''}$${Math.round(a / 1000)}k`;
  return fmtUSD(n);
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const STATUS_LABEL: Record<ApiResponse['status'], string> = {
  ahead:    'Ahead of pace',
  on_pace:  'On pace',
  behind:   'Behind pace',
  critical: 'Critical',
};

/**
 * Revenue Trajectory — MTD pacing chart (the operator 2026-04-30).
 *
 * Top: Big GAP headline ("$157k SHORT") + status pill + momentum
 * indicator ("🔥 3 days above pace" / "⚠️ 4 days below pace").
 *
 * Chart:
 *   - Faded gray line:    LAST MONTH's cumulative at this same day-of-month
 *                         (so the operator can see "are we ahead of where we
 *                         were 30 days ago?")
 *   - Solid emerald line: this month's actual cumulative cash
 *   - Dashed amber line:  forecast continuation at trailing run-rate
 *   - Dashed gray line:   linear pace target
 *   - Horizontal emerald: monthly target reference
 *   - Daily contribution bars below the line — green when day was at/above
 *     the daily pace, red when below (spot which days drove vs dragged)
 *
 * Footer: Run rate · Pace needed · Days left · EOM forecast
 */
// Per-view config — keeps the chart palette / labels consistent across the
// 4 toggle states. the operator 2026-04-30: "I'd rather have revenue and expenses
// combined on one chart so I can SEE profit as the gap between them."
// 'combined' is the new default; the individual modes stay for drill-down.
const VIEW_CONFIG: Record<ViewMode, {
  label: string;
  primaryColor: string;
  primaryFill: string;
  paceColor: string;
  goalLabel: string;
  goodWhen: 'higher' | 'lower';
}> = {
  combined: { label: 'Combined', primaryColor: '#fbbf24', primaryFill: 'url(#profitFill)', paceColor: '#fbbf24', goalLabel: 'Profit goal', goodWhen: 'higher' },
  revenue:  { label: 'Revenue',  primaryColor: '#10b981', primaryFill: 'url(#revFill)',    paceColor: '#10b981', goalLabel: 'Target',     goodWhen: 'higher' },
  expenses: { label: 'Expenses', primaryColor: '#f43f5e', primaryFill: 'url(#expFill)',    paceColor: '#f43f5e', goalLabel: 'Cap',        goodWhen: 'lower'  },
  profit:   { label: 'Profit',   primaryColor: '#fbbf24', primaryFill: 'url(#profitFill)', paceColor: '#fbbf24', goalLabel: 'Profit goal', goodWhen: 'higher' },
};

interface RevenueTrajectoryProps {
  /** Pre-fetched payload from /api/main/dashboard-data → revenueTrajectory. */
  initialData?: ApiResponse;
}

export default function RevenueTrajectory({ initialData }: RevenueTrajectoryProps = {}) {
  const tf = useTimeframe();
  // the operator 2026-05-01: snap to the global timeframe filter — picking
  // "Last Month" should update this trajectory card too.
  const tfMonth = (tf.from && /^\d{4}-\d{2}/.test(tf.from)) ? tf.from.slice(0, 7) : currentMonth();
  const [month, setMonth] = useState<string>(tfMonth);
  useEffect(() => { setMonth(tfMonth); }, [tfMonth]);
  const [view, setView] = useState<ViewMode>('combined');
  const [data, setData] = useState<ApiResponse | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const seedConsumedRef = useRef(!initialData);

  useEffect(() => {
    if (!seedConsumedRef.current) {
      seedConsumedRef.current = true;
      return;
    }
    let cancelled = false;
    setLoading(true);
    const load = () => {
      fetch(`/api/main/revenue-trajectory?month=${month}&_t=${Date.now()}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: ApiResponse | null) => {
          if (!cancelled) setData(d);
        })
        .catch(() => { if (!cancelled) setData(null); })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    load();
    const onRefetch = () => load();
    window.addEventListener('billing:categorized', onRefetch);
    window.addEventListener('expense:categorized', onRefetch);
    window.addEventListener('targets:saved', onRefetch);
    return () => {
      cancelled = true;
      window.removeEventListener('billing:categorized', onRefetch);
      window.removeEventListener('expense:categorized', onRefetch);
      window.removeEventListener('targets:saved', onRefetch);
    };
  }, [month]);

  // Build chart rows: one entry per day-of-month with all overlays merged.
  // In 'combined' mode we expose BOTH revenue + expense series (and profit
  // as the gap between them as a filled area). In single-metric modes we
  // expose just that metric. Same row shape, the chart elements pick which
  // keys to render.
  const chartData = useMemo(() => {
    if (!data) return [] as Array<{
      day: number;
      // Combined-mode series:
      actualRevenue?: number;
      actualExpense?: number;
      profitBand?: number; // = actualRevenue - actualExpense (for area fill)
      forecastRevenue?: number;
      forecastExpense?: number;
      // Single-mode series (used by revenue/expenses/profit toggle):
      actual?: number;
      forecast?: number;
      target: number;
      lastMonth?: number;
      daily: number;
      dailyPace: number;
    }>;
    const { points, todayDay, lastDay, priorMonth } = data;
    const priorByDay = new Map<number, number>();
    for (const p of priorMonth?.points ?? []) priorByDay.set(p.day, p.cumulative);

    // Pick the cumulative + daily + target series that match the active view.
    const cumKey = view === 'revenue' ? 'cumulative'
      : view === 'expenses' ? 'cumulativeExpense'
      : view === 'profit' ? 'cumulativeProfit'
      : 'cumulative'; // combined uses revenue as the "primary" cum for forecast calc
    const dailyKey = view === 'expenses' ? 'dailyExpense' : 'daily';
    const targetKey: keyof DailyPoint = view === 'expenses' ? 'expenseTarget' : 'target';
    const goalTotal = view === 'revenue' ? data.target
      : view === 'expenses' ? data.expenseCap
      : view === 'profit' ? data.profitTarget
      : data.profitTarget; // combined goal line = profit goal
    const dailyPace = lastDay > 0 ? goalTotal / lastDay : 0;

    const todayCumRev = points[Math.min(todayDay, lastDay) - 1]?.cumulative ?? 0;
    const todayCumExp = points[Math.min(todayDay, lastDay) - 1]?.cumulativeExpense ?? 0;
    const todayCum = points[Math.min(todayDay, lastDay) - 1]?.[cumKey] ?? 0;
    const todayRunRate = todayDay > 0 ? todayCum / todayDay : 0;
    const revRunRate = todayDay > 0 ? todayCumRev / todayDay : 0;
    const expRunRate = todayDay > 0 ? todayCumExp / todayDay : 0;

    return points.map((p) => {
      const day = Number(p.date.slice(8, 10));
      const isPastOrToday = day <= todayDay;
      const isFuture = day > todayDay;
      const forecast = isFuture ? todayCum + todayRunRate * (day - todayDay) : undefined;

      // Target line per view. Revenue uses linear pace from monthly
      // target. Expense + profit use the REVENUE-ADJUSTED targets that
      // scale with actual revenue (the operator 2026-04-30): if revenue is
      // 74% of target, the "fair" expense goal is also 74% of cap.
      const targetVal =
        view === 'revenue' ? p.target
        : view === 'expenses' ? p.expenseTargetAdj
        : view === 'profit' ? p.profitTargetAdj
        : p.profitTargetAdj; // combined uses profit-goal-adjusted

      // Daily pace also scales with revenue for expense/profit views.
      // For a given day, the fair daily pace = goal_pct × that day's
      // actual revenue contribution. We approximate by using the day's
      // running goal_target_adj minus prior day's.
      const prevPoint = day > 1 ? points[day - 2] : null;
      const dailyPaceAdj =
        view === 'revenue' ? dailyPace
        : view === 'expenses'
        ? (p.expenseTargetAdj - (prevPoint?.expenseTargetAdj ?? 0))
        : view === 'profit' || view === 'combined'
        ? (p.profitTargetAdj - (prevPoint?.profitTargetAdj ?? 0))
        : dailyPace;

      // Combined-mode series
      const actualRevenue = isPastOrToday ? p.cumulative : undefined;
      const actualExpense = isPastOrToday ? p.cumulativeExpense : undefined;
      const profitBand = isPastOrToday ? p.cumulativeProfit : undefined;
      const forecastRevenue = isFuture ? todayCumRev + revRunRate * (day - todayDay) : undefined;
      const forecastExpense = isFuture ? todayCumExp + expRunRate * (day - todayDay) : undefined;

      return {
        day,
        actualRevenue,
        actualExpense,
        profitBand,
        forecastRevenue,
        forecastExpense,
        actual: isPastOrToday ? (p[cumKey] as number) : undefined,
        forecast,
        target: targetVal,
        lastMonth: view === 'revenue' ? priorByDay.get(day) : undefined,
        daily: p[dailyKey],
        dailyPace: dailyPaceAdj,
      };
    });
  }, [data, view]);

  // Big gap-to-target headline. View-aware AND revenue-adjusted:
  //   revenue:  delta = projectedEom − target. Higher = good.
  //   expenses: delta = projectedExpense − expenseGoalAtProjectedRev.
  //             Goal scales WITH revenue (the operator 2026-04-30): if revenue
  //             is at 74%, the fair expense budget is also 74% of cap.
  //             Lower-than-goal = good.
  //   profit:   delta = projectedProfit − profitGoalAtProjectedRev.
  //             Same revenue-adjustment idea — profit goal scales with
  //             actual revenue using the budgeted profit margin.
  //   combined: gap shown is the PROFIT gap (vs revenue-adjusted profit
  //             goal), since combined view is really a P&L view.
  const gap = useMemo(() => {
    if (!data) return null;
    const cfg = VIEW_CONFIG[view];
    let projected: number;
    let goal: number;
    if (view === 'revenue') {
      projected = data.projectedEom;
      goal = data.target;
    } else if (view === 'expenses') {
      projected = data.projectedEomExpense;
      // Use revenue-adjusted expense goal, NOT fixed cap.
      goal = data.expenseGoalAtProjectedRev;
    } else {
      // profit OR combined — both compare projected profit to its
      // revenue-adjusted target (i.e. margin × actual projected revenue).
      projected = data.projectedEomProfit;
      goal = data.profitGoalAtProjectedRev;
    }
    if (goal <= 0) return { value: 0, label: 'No target set', positive: true, projected, goal };
    const delta = projected - goal;
    const isGood = cfg.goodWhen === 'higher' ? delta >= 0 : delta <= 0;
    const label = view === 'expenses'
      ? (delta >= 0 ? 'OVER BUDGET' : 'UNDER BUDGET')
      : (delta >= 0 ? 'AHEAD' : 'SHORT');
    return {
      value: Math.abs(delta),
      label,
      positive: isGood,
      projected,
      goal,
    };
  }, [data, view]);

  // Custom tooltip
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTooltip = (props: any) => {
    if (!props?.active || !props?.payload?.length) return null;
    const p = props.payload[0]?.payload;
    if (!p) return null;
    return (
      <div className="bg-[#1a1d23] border border-gray-700 rounded-lg px-3 py-2 shadow-lg space-y-0.5">
        <div className="text-[11px] text-gray-400 uppercase tracking-wider">{`Day ${p.day}`}</div>
        {p.actual !== undefined && (
          <div className="text-sm text-emerald-300 tabular-nums">
            <span className="text-gray-500 text-[11px] mr-2">Actual</span>{fmtUSD(p.actual)}
          </div>
        )}
        {p.forecast !== undefined && (
          <div className="text-sm text-amber-300 tabular-nums">
            <span className="text-gray-500 text-[11px] mr-2">Forecast</span>{fmtUSD(p.forecast)}
          </div>
        )}
        <div className="text-sm text-gray-400 tabular-nums">
          <span className="text-gray-500 text-[11px] mr-2">Pace</span>{fmtUSD(p.target)}
        </div>
        {p.lastMonth !== undefined && (
          <div className="text-sm text-gray-400 tabular-nums">
            <span className="text-gray-500 text-[11px] mr-2">Last mo</span>{fmtUSD(p.lastMonth)}
          </div>
        )}
        <div className="text-xs text-gray-500 pt-1 border-t border-gray-800 mt-1">
          <span className="mr-2">Day +{fmtUSD(p.daily)}</span>
          <span className={p.daily >= p.dailyPace ? 'text-emerald-400' : 'text-rose-400'}>
            {p.daily >= p.dailyPace ? 'above' : 'below'} pace
          </span>
        </div>
      </div>
    );
  };

  return (
    <CardShell
      title={`${VIEW_CONFIG[view].label} Trajectory`}
      subtitle={data ? `${data.monthLabel} · MTD cumulative ${view} vs ${VIEW_CONFIG[view].goalLabel.toLowerCase()}${view === 'revenue' ? ` · ${data.priorMonth.label} overlaid` : ''}` : 'MTD pace toward monthly target'}
      cardId="main:revenue-trajectory"
      headerExtra={
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle: Revenue / Expenses / Profit */}
          <div className="inline-flex items-center bg-black/30 border border-gray-700 rounded-md p-0.5">
            {(['revenue', 'expenses', 'profit'] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  view === v
                    ? v === 'revenue' ? 'bg-emerald-600/30 text-emerald-200'
                    : v === 'expenses' ? 'bg-rose-600/30 text-rose-200'
                    : 'bg-amber-600/30 text-amber-200'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {VIEW_CONFIG[v].label}
              </button>
            ))}
          </div>
          {/* Month picker */}
          <div className="inline-flex items-center bg-black/30 border border-gray-700 rounded-md">
            <button
              onClick={() => {
                const [y, m] = month.split('-').map(Number);
                const d = new Date(y, m - 2, 1);
                setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
              }}
              className="px-2 py-1 text-gray-400 hover:text-white text-xs"
            >‹</button>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value || currentMonth())}
              className="bg-transparent text-white text-xs font-medium px-2 py-1 outline-none w-[140px] text-center"
            />
            <button
              onClick={() => {
                const [y, m] = month.split('-').map(Number);
                const d = new Date(y, m, 1);
                setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
              }}
              className="px-2 py-1 text-gray-400 hover:text-white text-xs"
            >›</button>
          </div>
        </div>
      }
    >
      {loading && !data ? (
        <div className="h-[400px] flex items-center justify-center text-gray-500 text-sm">Loading…</div>
      ) : !data ? (
        <div className="h-[400px] flex items-center justify-center text-gray-500 text-sm">No data.</div>
      ) : (
        <div>
          {/* ── BIG headline (gap to goal) + supporting numbers ──────────── */}
          <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
            <div className="min-w-0">
              {gap && gap.goal > 0 ? (
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className={`text-4xl font-bold tracking-tight ${gap.positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {fmtUSD(gap.value)}
                  </span>
                  <span className={`text-xl font-bold tracking-tight ${gap.positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {gap.label}
                  </span>
                </div>
              ) : (
                <div className="text-3xl font-bold text-white tracking-tight">{fmtUSD(gap?.projected ?? 0)}</div>
              )}
              <div className="text-xs text-gray-400 mt-1">
                Projected {fmtUSD(gap?.projected ?? 0)} of {fmtUSD(gap?.goal ?? 0)} {VIEW_CONFIG[view].goalLabel.toLowerCase()} · {data.daysRemaining} days remaining
              </div>
              {/* Momentum + days-behind row */}
              <div className="inline-flex items-center gap-2 mt-2 flex-wrap">
                {data.streakDays > 0 && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                    data.streakDirection === 'above'
                      ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800/40'
                      : 'bg-rose-900/40 text-rose-300 border border-rose-800/40'
                  }`}>
                    {data.streakDirection === 'above' ? <Flame size={11} /> : <AlertTriangle size={11} />}
                    {data.streakDays} day{data.streakDays === 1 ? '' : 's'} {data.streakDirection} pace
                  </span>
                )}
                {Math.abs(data.daysBehind) >= 0.5 && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                    data.daysBehind > 0
                      ? 'bg-amber-900/40 text-amber-300 border border-amber-800/40'
                      : 'bg-emerald-900/40 text-emerald-300 border border-emerald-800/40'
                  }`}>
                    {data.daysBehind > 0
                      ? `${data.daysBehind.toFixed(1)} days behind pace`
                      : `${Math.abs(data.daysBehind).toFixed(1)} days ahead of pace`}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              {(() => {
                const mtd = view === 'revenue' ? data.mtdTotal
                  : view === 'expenses' ? data.mtdExpense
                  : data.mtdProfit;
                const goal = view === 'revenue' ? data.target
                  : view === 'expenses' ? data.expenseCap
                  : data.profitTarget;
                const pct = goal > 0 ? (mtd / goal) * 100 : 0;
                return (
                  <>
                    <div className="text-xl font-bold text-white tabular-nums">{fmtUSD(mtd)}</div>
                    <div className="text-xs text-gray-500">
                      MTD {view === 'revenue' ? 'collected' : view === 'expenses' ? 'spent' : 'profit'}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {goal > 0 ? `${Math.round(pct)}% of ${fmtUSD(goal)}` : `${VIEW_CONFIG[view].goalLabel} not set`}
                    </div>
                    {view === 'revenue' && data.priorMonth.total > 0 && (
                      <div className="text-[11px] text-gray-500 mt-1">
                        Last mo: <span className="tabular-nums">{fmtUSD(data.priorMonth.total)}</span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* ── Combined chart: lines on top + bars below ───────────────── */}
          <div className="h-[330px] -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 24, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={VIEW_CONFIG[view].primaryColor} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={VIEW_CONFIG[view].primaryColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1f2530" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  axisLine={{ stroke: '#374151' }}
                  tickLine={{ stroke: '#374151' }}
                  ticks={[1, 5, 10, 15, 20, 25, data.lastDay].filter((d) => d <= data.lastDay)}
                  tickFormatter={(d) => `${d}`}
                />
                <YAxis
                  yAxisId="cum"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  axisLine={{ stroke: '#374151' }}
                  tickLine={{ stroke: '#374151' }}
                  tickFormatter={fmtUSDk}
                  width={56}
                />
                {/* Hidden axis for daily contribution bars (different scale) */}
                <YAxis
                  yAxisId="daily"
                  orientation="right"
                  hide
                />
                <Tooltip content={renderTooltip} />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: '#9ca3af', paddingTop: 8 }}
                  iconType="line"
                />
                {/* Goal horizontal — color flips per view */}
                {gap && gap.goal > 0 && (
                  <ReferenceLine
                    yAxisId="cum"
                    y={gap.goal}
                    stroke={VIEW_CONFIG[view].primaryColor}
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    label={{
                      position: 'right',
                      value: `${VIEW_CONFIG[view].goalLabel} ${fmtUSDk(gap.goal)}`,
                      fill: VIEW_CONFIG[view].primaryColor,
                      fontSize: 10,
                    }}
                  />
                )}
                {/* "Today" vertical */}
                {data.todayDay > 0 && data.todayDay < data.lastDay && (
                  <ReferenceLine
                    yAxisId="cum"
                    x={data.todayDay}
                    stroke="#6b7280"
                    strokeDasharray="2 4"
                    strokeWidth={1}
                    label={{ position: 'top', value: 'Today', fill: '#9ca3af', fontSize: 10 }}
                  />
                )}
                {/* Daily contribution bars — only in single-metric modes
                    (combined view is already busy with 2 lines). For revenue
                    /profit: above pace = green. For expenses the semantic
                    flips: spending more than daily pace = red. */}
                {view !== 'combined' && (
                  <Bar
                    yAxisId="daily"
                    dataKey="daily"
                    name="Daily"
                    fill="#374151"
                    opacity={0.5}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    shape={(props: any) => {
                      const { x, y, width, height, payload } = props;
                      const goodWhen = VIEW_CONFIG[view].goodWhen;
                      const aboveOrEqual = payload.daily >= payload.dailyPace;
                      const isGood = goodWhen === 'higher' ? aboveOrEqual : !aboveOrEqual;
                      const fillColor = payload.daily === 0
                        ? '#1f2530'
                        : isGood
                        ? '#10b981'
                        : '#dc2626';
                      return <rect x={x} y={y} width={width} height={height} fill={fillColor} opacity={0.55} rx={1} />;
                    }}
                  />
                )}
                {/* Last month's cumulative — only on Revenue view */}
                {view === 'revenue' && (
                  <Line
                    yAxisId="cum"
                    type="monotone"
                    dataKey="lastMonth"
                    stroke="#6b7280"
                    strokeWidth={1.5}
                    strokeDasharray="2 3"
                    dot={false}
                    name="Last month"
                    connectNulls
                  />
                )}

                {/* Pace target line — straight gray dashed for revenue,
                    revenue-adjusted curve for expenses/profit. Combined
                    omits this since it shows two real lines instead. */}
                {view !== 'combined' && (
                  <Line
                    yAxisId="cum"
                    type={view === 'revenue' ? 'linear' : 'monotone'}
                    dataKey="target"
                    stroke="#374151"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    name={view === 'revenue' ? 'Pace' : 'Pace (rev-adjusted)'}
                  />
                )}

                {/* COMBINED view: render Revenue + Expense + Profit-band */}
                {view === 'combined' && (
                  <>
                    {/* Profit band: filled area from expense line up to revenue line.
                        Recharts hack — we render an Area for actualRevenue with a
                        gradient fill, and the negative-area for actualExpense
                        masks it down to the gap. Visual result: the gap between
                        the two lines is shaded with the profit color. */}
                    <Area
                      yAxisId="cum"
                      type="monotone"
                      dataKey="actualRevenue"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      fill="url(#actualFill)"
                      fillOpacity={0.35}
                      dot={false}
                      name="Revenue"
                      connectNulls={false}
                    />
                    <Area
                      yAxisId="cum"
                      type="monotone"
                      dataKey="actualExpense"
                      stroke="#f43f5e"
                      strokeWidth={2}
                      fill="#0a0c0f"
                      fillOpacity={1}
                      dot={false}
                      name="Expenses"
                      connectNulls={false}
                    />
                    {/* Forecast continuations */}
                    <Line yAxisId="cum" type="monotone" dataKey="forecastRevenue" stroke="#10b981" strokeWidth={2} strokeDasharray="6 4" dot={false} name="Revenue forecast" connectNulls={false} />
                    <Line yAxisId="cum" type="monotone" dataKey="forecastExpense" stroke="#f43f5e" strokeWidth={2} strokeDasharray="6 4" dot={false} name="Expense forecast" connectNulls={false} />
                  </>
                )}

                {/* Single-metric views: one cumulative line */}
                {view !== 'combined' && (
                  <Area
                    yAxisId="cum"
                    type="monotone"
                    dataKey="actual"
                    stroke={VIEW_CONFIG[view].primaryColor}
                    strokeWidth={2.5}
                    fill="url(#actualFill)"
                    dot={false}
                    name={`This month ${VIEW_CONFIG[view].label.toLowerCase()}`}
                    connectNulls={false}
                  />
                )}
                {view !== 'combined' && (
                  <Line
                    yAxisId="cum"
                    type="monotone"
                    dataKey="forecast"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                    name="Forecast"
                    connectNulls={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* ── Footer 4-stat row ───────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-3 border-t border-gray-800">
            <div>
              <div className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold" title="Average daily revenue we've collected so far this month (MTD total ÷ days elapsed). Historical, not a goal.">
                Run Rate
              </div>
              <div className="text-base text-white font-bold tabular-nums mt-0.5">
                {fmtUSD(data.dailyRunRate)}<span className="text-xs text-gray-500 font-normal ml-1">/day</span>
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">avg per day so far</div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold" title="How much we'd need to collect EVERY remaining day to still hit target.">
                Pace Needed
              </div>
              {(() => {
                const remainingGap = data.target - data.mtdTotal;
                const paceNeeded = data.daysRemaining > 0 ? remainingGap / data.daysRemaining : 0;
                const onPace = paceNeeded <= data.dailyRunRate;
                if (data.target <= 0) {
                  return <div className="text-base text-gray-500 font-bold tabular-nums mt-0.5">—<div className="text-[10px] text-gray-500 mt-0.5 font-normal">No target set</div></div>;
                }
                if (data.daysRemaining === 0) {
                  return (
                    <>
                      <div className={`text-base font-bold tabular-nums mt-0.5 ${remainingGap > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                        {remainingGap > 0 ? `${fmtUSD(remainingGap)} short` : `${fmtUSD(-remainingGap)} over`}
                      </div>
                      <div className="text-[10px] text-gray-500 mt-0.5">month ended</div>
                    </>
                  );
                }
                return (
                  <>
                    <div className={`text-base font-bold tabular-nums mt-0.5 ${onPace ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {fmtUSD(paceNeeded)}<span className="text-xs text-gray-500 font-normal ml-1">/day</span>
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">to hit ${Math.round(data.target / 1000)}k by EOM</div>
                  </>
                );
              })()}
            </div>
            <div>
              <div className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">Days Left</div>
              <div className="text-base text-white font-bold tabular-nums mt-0.5">{data.daysRemaining}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">of {data.lastDay} in {data.monthLabel.split(' ')[0].slice(0, 3)}</div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">EOM Forecast</div>
              <div className="text-base text-white font-bold tabular-nums mt-0.5 inline-flex items-center gap-1.5">
                {fmtUSD(data.projectedEom)}
                {data.target > 0 && data.projectedEom >= data.target && (
                  <Trophy size={13} className="text-amber-300" />
                )}
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">at current pace</div>
            </div>
          </div>
        </div>
      )}
    </CardShell>
  );
}
