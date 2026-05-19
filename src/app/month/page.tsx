'use client';

/**
 * /month — Monthly CEO Review
 *
 * Built per the operator's 2026-05-02 PDF spec. Step-by-step like /today and
 * /week — each section answers a specific question from his monthly retro.
 *
 * Section order (top → bottom):
 *   0. Year So Far          — 12-month trajectory + YTD pace + best/worst month
 *   1. Backlogging Status   — admin checklist (sheets / payouts / projections)
 *   2. Revenue Quality      — cash + AR vs targets, AR aging, CSM upsells
 *   3. Constraint Diagnosis — auto-flags worst pillar (acq/sales/fulfil/team)
 *   4. Expense Efficiency   — total + per-category vs target + top vendors
 *   5. Double Down / Kill   — top funnel, best closer, best setter
 *   6. CEO-Level Reflection — 7 prose prompts (decision avoided / 3-keep / etc.)
 *   7. Next Month Plan      — forward checklist
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, ArrowUpRight, TrendingUp, TrendingDown, Minus,
  AlertCircle, CheckCircle2, AlertTriangle, Crown, Flame, Trophy,
} from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import CardShell from '@/components/main/CardShell';

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(0)}%`;
const fmtPct1 = (n: number) => `${n.toFixed(1)}%`;
const monthLabel = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' });
};
const monthLabelLong = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
};
const pad = (n: number) => n.toString().padStart(2, '0');
function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${pad(m - 1)}`;
}
function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${pad(m + 1)}`;
}
function lastCompletedMonthLocal(): string {
  const d = new Date();
  return prevMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
}

// ── Response types ─────────────────────────────────────────────────────
interface MonthlyPoint { month: string; netCash: number; expenses: number; profit: number; }
interface YearPoint {
  month: string;
  monthLabel: string;
  monthlyRevenue: number;
  monthlyExpenses: number;
  monthlyProfit: number;
  cumRevenue: number | null;
  cumExpenses: number | null;
  cumProfit: number | null;
  targetRevenue: number;
  targetExpenses: number;
  targetProfit: number;
  projectedRevenue: number | null;
  projectedExpenses: number | null;
  projectedProfit: number | null;
  isFuture: boolean;
  isOverride: boolean;
}
interface MonthChecklist {
  configured: boolean;
  month: string;
  window: { from: string; to: string };
  yearSoFar: {
    yearSeries: YearPoint[];
    monthlySeries: MonthlyPoint[];
    ytd: { netCash: number; expenses: number; profit: number; marginPct: number };
    annualTargetCash: number;
    annualExpenseCap: number;
    annualProfitGoal: number;
    annualPacePct: number | null;
    monthsElapsedPct: number;
    onPace: boolean | null;
    bestMonth: MonthlyPoint;
    worstMonth: MonthlyPoint | null;
    momGrowthPct: number | null;
    runRate: { revenue: number; expenses: number; profit: number };
    paceNeeded: number;
    projectedEoy: { revenue: number; expenses: number; profit: number };
    gapToTarget: number;
    paceGap: { revenue: number; expenses: number; profit: number };
    monthsRemaining: number;
    monthsCompleted: number;
    yearKey: string;
  };
  revenueQuality: {
    cashTarget: number; cashActual: number; cashGap: number; cashHit: boolean | null;
    arTarget: number; arActual: number; arGap: number; arHit: boolean | null;
    netRevenue: number; refunds: number; refundRatePct: number;
    profitabilityTarget: number; profitabilityActual: number;
    arAging: { current: number; d30: number; d60: number; d90Plus: number };
    csmUpsells: Array<{ name: string; upsells: number; cash: number; hitTarget: boolean }>;
    csmTarget: number;
    channelBreakdown: Array<{ source: string; cash: number }>;
  };
  constraint: {
    pillar: string | null;
    score: number;
    hint: string;
    pillars: Array<{ name: string; score: number; hint: string }>;
  };
  expenseEfficiency: {
    actual: number; target: number; overBy: number; momDelta: number;
    categories: Array<{ category: string; actual: number; target: number; overBy: number; overBudget: boolean; pctOfTarget: number | null }>;
    biggestOverspend: { category: string; overBy: number } | null;
    topVendors: Array<{ vendor: string; total: number }>;
  };
  doubleDownKill: {
    topFunnel: { source: string; cash: number } | null;
    bestCloser: { name: string; closeRate: number; cashPerCall: number; cash: number; shown: number } | null;
    bestSetter: { name: string; booked: number; shown: number } | null;
    closerRanking: Array<{ name: string; closeRate: number; cashPerCall: number; cash: number; shown: number }>;
    setterRanking: Array<{ name: string; booked: number; shown: number }>;
    channelBreakdown: Array<{ source: string; cash: number }>;
  };
}

// ── Persistence helpers (localStorage) ────────────────────────────────
const STORE_KEY = 'ls-cmd:month-state';
interface MonthState {
  checks: Record<string, boolean>;
  prose: Record<string, string>;
}
function loadState(): MonthState {
  if (typeof window === 'undefined') return { checks: {}, prose: {} };
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{"checks":{},"prose":{}}'); }
  catch { return { checks: {}, prose: {} }; }
}
function saveState(s: MonthState) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
}

// 2026-05-02: removed BACKLOGGING_TASKS, CEO_PROMPTS, NEXT_MONTH_TASKS
// constants — those sections live in the operator's Google Docs now,
// /month stays focused on data the dashboard can answer.

// ── Component ─────────────────────────────────────────────────────────

type TrajView = 'revenue' | 'expenses' | 'profit';

export default function MonthPage() {
  const [data, setData] = useState<MonthChecklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState<string>(lastCompletedMonthLocal);
  const [state, setStateLocal] = useState<MonthState>({ checks: {}, prose: {} });
  const [trajView, setTrajView] = useState<TrajView>('revenue');

  useEffect(() => { setStateLocal(loadState()); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/month/checklist?month=${month}&_t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month]);

  const toggle = (id: string) => {
    const k = `${month}|${id}`;
    const next = { ...state, checks: { ...state.checks, [k]: !state.checks[k] } };
    setStateLocal(next); saveState(next);
  };
  const isChecked = (id: string) => !!state.checks[`${month}|${id}`];
  const setProse = (id: string, value: string) => {
    const k = `${month}|${id}`;
    const next = { ...state, prose: { ...state.prose, [k]: value } };
    setStateLocal(next); saveState(next);
  };
  const proseValue = (id: string) => state.prose[`${month}|${id}`] ?? '';

  return (
    <div className="px-6 py-5 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-white font-bold text-2xl tracking-tight">Monthly CEO Review</h1>
          <p className="text-sm text-gray-400 mt-1">
            {data ? monthLabelLong(data.month) : 'Loading…'} · top-to-bottom retro
          </p>
        </div>
        <div className="inline-flex bg-[#1a1d23] border border-gray-800 rounded-md overflow-hidden text-xs">
          <button
            onClick={() => setMonth(prevMonth(month))}
            className="px-3 py-1.5 text-gray-400 hover:text-white hover:bg-gray-800/50 transition-colors"
            title="Previous month"
          >‹</button>
          <span className="px-3 py-1.5 text-white font-medium border-l border-r border-gray-800">{monthLabelLong(month)}</span>
          <button
            onClick={() => setMonth(nextMonth(month))}
            disabled={month >= lastCompletedMonthLocal()}
            className="px-3 py-1.5 text-gray-400 hover:text-white hover:bg-gray-800/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Next month"
          >›</button>
        </div>
      </div>

      {loading && !data ? (
        <div className="text-gray-400 text-sm flex items-center gap-2 py-8">
          <Loader2 size={14} className="animate-spin" /> Pulling monthly data…
        </div>
      ) : !data || !data.configured ? (
        <div className="text-rose-400 text-sm py-8">Could not load monthly data.</div>
      ) : (
        <>
          {/* 0. YEAR SO FAR — Revenue/Expenses/Profit toggleable yearly
             view. Headline: PACE GAP (where you SHOULD be today vs
             where you ARE) — much more meaningful than the EOY
             projected gap which felt confusing in May. */}
          {(() => {
            const ys = data.yearSoFar;
            // Per-view selectors
            const VIEW_CFG: Record<TrajView, { label: string; goal: number; runRate: number; projected: number; paceGap: number; cumKey: 'cumRevenue' | 'cumExpenses' | 'cumProfit'; targetKey: 'targetRevenue' | 'targetExpenses' | 'targetProfit'; projKey: 'projectedRevenue' | 'projectedExpenses' | 'projectedProfit'; monthlyKey: 'monthlyRevenue' | 'monthlyExpenses' | 'monthlyProfit'; areaColor: string; targetColor: string; projColor: string; goalLabel: string; lowerIsBetter: boolean }> = {
              revenue: {
                label: 'Revenue', goal: ys.annualTargetCash, runRate: ys.runRate.revenue, projected: ys.projectedEoy.revenue, paceGap: ys.paceGap.revenue,
                cumKey: 'cumRevenue', targetKey: 'targetRevenue', projKey: 'projectedRevenue', monthlyKey: 'monthlyRevenue',
                areaColor: '#10b981', targetColor: '#6b7280', projColor: '#f59e0b',
                goalLabel: 'annual revenue goal', lowerIsBetter: false,
              },
              expenses: {
                label: 'Expenses', goal: ys.annualExpenseCap, runRate: ys.runRate.expenses, projected: ys.projectedEoy.expenses, paceGap: ys.paceGap.expenses,
                cumKey: 'cumExpenses', targetKey: 'targetExpenses', projKey: 'projectedExpenses', monthlyKey: 'monthlyExpenses',
                areaColor: '#f43f5e', targetColor: '#6b7280', projColor: '#f59e0b',
                goalLabel: 'annual expense cap', lowerIsBetter: true,
              },
              profit: {
                label: 'Profit', goal: ys.annualProfitGoal, runRate: ys.runRate.profit, projected: ys.projectedEoy.profit, paceGap: ys.paceGap.profit,
                cumKey: 'cumProfit', targetKey: 'targetProfit', projKey: 'projectedProfit', monthlyKey: 'monthlyProfit',
                areaColor: '#a855f7', targetColor: '#6b7280', projColor: '#f59e0b',
                goalLabel: 'annual profit goal', lowerIsBetter: false,
              },
            };
            const v = VIEW_CFG[trajView];
            // Pace gap: ahead = cumulative > linear target by today.
            // For expenses: lower is better, so flip the colour.
            const paceAhead = v.lowerIsBetter ? v.paceGap < 0 : v.paceGap >= 0;
            const PaceIcon = ys.momGrowthPct === null ? Minus
              : ys.momGrowthPct >= 0 ? TrendingUp : TrendingDown;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const chart: Array<any> = ys.yearSeries.map((p) => ({
              month: p.monthLabel,
              ymKey: p.month,
              isCurrent: p.month === data.month,
              isOverride: p.isOverride,
              cumulative:        p[v.cumKey],
              target:            p[v.targetKey],
              projected:         p[v.projKey],
              monthly:           p[v.monthlyKey],
            }));
            const lastActualIdx = chart.findIndex((c) => c.ymKey === data.month);
            if (lastActualIdx >= 0 && chart[lastActualIdx].cumulative !== null) {
              chart[lastActualIdx].projected = chart[lastActualIdx].cumulative;
            }
            const ytdValue = trajView === 'revenue' ? ys.ytd.netCash
              : trajView === 'expenses' ? ys.ytd.expenses
              : ys.ytd.profit;
            return (
              <CardShell
                title={`${ys.yearKey} Trajectory`}
                subtitle={`YTD ${v.label.toLowerCase()} vs ${fmtUSD(v.goal)} ${v.goalLabel} · projected EOY at current run rate`}
                cardId="month:year-so-far"
                headerExtra={
                  // the operator 2026-05-02: same Revenue / Expenses / Profit
                  // toggle as the main dashboard's Combined Trajectory.
                  <div className="inline-flex items-center bg-black/30 border border-gray-700 rounded-md p-0.5">
                    {(['revenue', 'expenses', 'profit'] as TrajView[]).map((view) => (
                      <button
                        key={view}
                        onClick={() => setTrajView(view)}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                          trajView === view
                            ? view === 'revenue' ? 'bg-emerald-600/30 text-emerald-200'
                            : view === 'expenses' ? 'bg-rose-600/30 text-rose-200'
                            : 'bg-purple-600/30 text-purple-200'
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        {VIEW_CFG[view].label}
                      </button>
                    ))}
                  </div>
                }
              >
                {/* Headline: PACE GAP (today vs where you should be) +
                    EOY forecast as the secondary line. */}
                <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={`text-4xl font-bold tracking-tight ${paceAhead ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {v.paceGap >= 0 ? '+' : ''}{fmtUSD(v.paceGap)}
                      </span>
                      <span className={`text-xl font-bold tracking-tight ${paceAhead ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {paceAhead ? (v.lowerIsBetter ? 'UNDER PACE' : 'AHEAD OF PACE') : (v.lowerIsBetter ? 'OVER PACE' : 'BEHIND PACE')}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      You {v.paceGap >= 0 ? 'have' : 'should have'} {fmtUSD(Math.abs(v.paceGap))} {paceAhead ? 'extra' : 'more'} {trajView === 'expenses' ? 'spent' : 'collected'} by end of {monthLabelLong(data.month)} to track linearly to {fmtUSD(v.goal)}
                    </div>
                    <div className="inline-flex items-center gap-2 mt-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                        ys.onPace === true
                          ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800/40'
                          : ys.onPace === false
                            ? 'bg-rose-900/40 text-rose-300 border border-rose-800/40'
                            : 'bg-gray-800/40 text-gray-300 border border-gray-700/40'
                      }`}>
                        {ys.onPace === true ? <Flame size={11} /> : ys.onPace === false ? <AlertTriangle size={11} /> : <Minus size={11} />}
                        {ys.annualPacePct !== null ? `${ys.annualPacePct.toFixed(0)}% of revenue collected` : 'No annual target'}
                        {' · '}{ys.monthsElapsedPct.toFixed(0)}% of year elapsed
                      </span>
                      {ys.momGrowthPct !== null && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                          ys.momGrowthPct >= 0
                            ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800/40'
                            : 'bg-rose-900/40 text-rose-300 border border-rose-800/40'
                        }`}>
                          <PaceIcon size={11} />
                          {ys.momGrowthPct >= 0 ? '+' : ''}{ys.momGrowthPct.toFixed(0)}% MoM
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-white tabular-nums">{fmtUSD(ytdValue)}</div>
                    <div className="text-xs text-gray-500">YTD {trajView === 'expenses' ? 'spent' : trajView === 'profit' ? 'profit' : 'collected'}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {v.goal > 0 ? `${fmtPct((ytdValue / v.goal) * 100)} of ${fmtUSD(v.goal)}` : '—'}
                    </div>
                    <div className="text-[11px] text-amber-300 mt-1 tabular-nums">
                      EOY proj: {fmtUSD(v.projected)}
                    </div>
                  </div>
                </div>

                {/* Trajectory chart — colours swap with the view toggle */}
                <div className="h-[280px] -mx-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chart} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id={`cumFill-${trajView}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"  stopColor={v.areaColor} stopOpacity={0.55} />
                          <stop offset="100%" stopColor={v.areaColor} stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={{ stroke: '#374151' }} tickLine={false} />
                      <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={{ stroke: '#374151' }} tickLine={false} tickFormatter={(n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`} width={50} />
                      <Tooltip
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        content={(p: any) => {
                          if (!p?.active || !p?.payload?.length) return null;
                          const d = p.payload[0]?.payload;
                          if (!d) return null;
                          return (
                            <div className="bg-[#1a1d23] border border-gray-700 rounded-lg px-3 py-2 shadow-lg space-y-0.5">
                              <div className="text-[10px] text-gray-400 uppercase tracking-wider">{monthLabelLong(d.ymKey)} {d.isOverride ? '(backlog)' : ''}</div>
                              {d.cumulative !== null && (
                                <div className="text-sm tabular-nums" style={{ color: v.areaColor }}>
                                  <span className="text-gray-500 text-[10px]">Cumulative</span> {fmtUSD(d.cumulative)}
                                </div>
                              )}
                              {d.projected !== null && d.cumulative === null && (
                                <div className="text-sm text-amber-300 tabular-nums">
                                  <span className="text-gray-500 text-[10px]">Projected</span> {fmtUSD(d.projected)}
                                </div>
                              )}
                              <div className="text-xs text-gray-400 tabular-nums">
                                <span className="text-gray-500 text-[10px]">Target</span> {fmtUSD(d.target)}
                              </div>
                              {d.monthly > 0 && (
                                <div className="text-[10px] text-gray-500 tabular-nums pt-0.5">
                                  This month alone: {fmtUSD(d.monthly)}
                                </div>
                              )}
                            </div>
                          );
                        }}
                      />
                      <Line type="linear" dataKey="target" stroke={v.targetColor} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                      <Area type="monotone" dataKey="cumulative" stroke={v.areaColor} strokeWidth={2} fill={`url(#cumFill-${trajView})`} connectNulls={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="projected" stroke={v.projColor} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
                      <ReferenceLine y={v.goal} stroke={v.areaColor} strokeDasharray="2 6" strokeWidth={1} label={{ position: 'right', value: `${fmtUSD(v.goal)} goal`, fill: v.areaColor, fontSize: 10 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Footer metrics row */}
                <div className="mt-3 pt-3 border-t border-gray-800 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Run Rate</div>
                    <div className="text-base font-bold text-white tabular-nums mt-0.5">{fmtUSD(v.runRate)}<span className="text-[10px] text-gray-500"> /mo</span></div>
                    <div className="text-[10px] text-gray-500">{v.label.toLowerCase()}</div>
                  </div>
                  {trajView === 'revenue' && (
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Pace Needed</div>
                      <div className={`text-base font-bold tabular-nums mt-0.5 ${ys.paceNeeded > v.runRate ? 'text-rose-300' : 'text-emerald-300'}`}>
                        {fmtUSD(ys.paceNeeded)}<span className="text-[10px] text-gray-500"> /mo</span>
                      </div>
                      <div className="text-[10px] text-gray-500">to hit goal</div>
                    </div>
                  )}
                  {trajView !== 'revenue' && (
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">EOY Forecast</div>
                      <div className={`text-base font-bold tabular-nums mt-0.5 ${paceAhead ? 'text-emerald-300' : 'text-rose-300'}`}>{fmtUSD(v.projected)}</div>
                      <div className="text-[10px] text-gray-500">vs goal {fmtUSD(v.goal)}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">EOY Forecast</div>
                    <div className={`text-base font-bold tabular-nums mt-0.5 ${paceAhead ? 'text-emerald-300' : 'text-rose-300'}`}>{fmtUSD(v.projected)}</div>
                    <div className="text-[10px] text-gray-500">at current pace</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Best / Worst</div>
                    {ys.bestMonth && (
                      <div className="inline-flex items-center gap-1 text-emerald-300 text-xs mt-0.5">
                        <Crown size={11} /> {monthLabel(ys.bestMonth.month)} · {fmtUSD(ys.bestMonth.netCash)}
                      </div>
                    )}
                    {ys.worstMonth && (
                      <div className="inline-flex items-center gap-1 text-rose-300 text-xs">
                        <Flame size={11} /> {monthLabel(ys.worstMonth.month)} · {fmtUSD(ys.worstMonth.netCash)}
                      </div>
                    )}
                  </div>
                </div>
              </CardShell>
            );
          })()}

          {/* 1. REVENUE QUALITY (Backlogging Status removed 2026-05-02
             — the operator does the admin checklist in Google Docs.) */}
          {(() => {
            const rq = data.revenueQuality;
            return (
              <CardShell
                title="2. Revenue Quality"
                subtitle="Did we hit cash + AR targets? AR aging? CSM upsells?"
                cardId="month:revenue-quality"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                  <div className={`bg-black/20 border rounded-lg p-3 ${rq.cashHit ? 'border-emerald-800/40' : rq.cashHit === false ? 'border-rose-800/40' : 'border-gray-800'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">New Cash</span>
                      {rq.cashHit === true && <CheckCircle2 size={14} className="text-emerald-300" />}
                      {rq.cashHit === false && <AlertCircle size={14} className="text-rose-300" />}
                    </div>
                    <div className="text-2xl font-bold text-white tabular-nums mt-1">{fmtUSD(rq.cashActual)}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      target {fmtUSD(rq.cashTarget)} ·
                      <span className={rq.cashGap >= 0 ? ' text-emerald-400' : ' text-rose-400'}> {rq.cashGap >= 0 ? '+' : ''}{fmtUSD(rq.cashGap)}</span>
                    </div>
                  </div>
                  <div className={`bg-black/20 border rounded-lg p-3 ${rq.arHit ? 'border-emerald-800/40' : rq.arHit === false ? 'border-rose-800/40' : 'border-gray-800'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">AR Collected</span>
                      {rq.arHit === true && <CheckCircle2 size={14} className="text-emerald-300" />}
                      {rq.arHit === false && <AlertCircle size={14} className="text-rose-300" />}
                    </div>
                    <div className="text-2xl font-bold text-white tabular-nums mt-1">{fmtUSD(rq.arActual)}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      target {fmtUSD(rq.arTarget)} ·
                      <span className={rq.arGap >= 0 ? ' text-emerald-400' : ' text-rose-400'}> {rq.arGap >= 0 ? '+' : ''}{fmtUSD(rq.arGap)}</span>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold mb-2">AR Outstanding · aging</div>
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {[
                    { label: 'Current (≤30d)', value: rq.arAging.current, color: 'text-emerald-300' },
                    { label: '30–60d',         value: rq.arAging.d30,     color: 'text-amber-300' },
                    { label: '60–90d',         value: rq.arAging.d60,     color: 'text-orange-300' },
                    { label: '90+d',           value: rq.arAging.d90Plus, color: 'text-rose-300' },
                  ].map((b) => (
                    <div key={b.label} className="bg-black/20 border border-gray-800 rounded-md p-2">
                      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{b.label}</div>
                      <div className={`text-sm font-bold tabular-nums mt-0.5 ${b.color}`}>{fmtUSD(b.value)}</div>
                    </div>
                  ))}
                </div>

                <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold mb-2">
                  CSM Upsells · target ≥{rq.csmTarget} each
                </div>
                {rq.csmUpsells.length === 0 ? (
                  <div className="text-gray-500 text-sm italic">No CSM activity recorded for this month.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {rq.csmUpsells.map((c) => (
                      <div key={c.name} className={`bg-black/20 border rounded-md px-3 py-2 ${c.hitTarget ? 'border-emerald-800/40' : 'border-rose-800/40'}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-white text-sm font-medium">{c.name}</span>
                          {c.hitTarget
                            ? <CheckCircle2 size={14} className="text-emerald-300" />
                            : <AlertCircle size={14} className="text-rose-300" />}
                        </div>
                        <div className={`text-xl font-bold tabular-nums mt-0.5 ${c.hitTarget ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {c.upsells} <span className="text-[10px] text-gray-500 font-normal">upsells · {fmtUSD(c.cash)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardShell>
            );
          })()}

          {/* 3. CONSTRAINT */}
          {(() => {
            const c = data.constraint;
            return (
              <CardShell
                title="3. Constraint Diagnosis"
                subtitle="Where's the biggest gap — acquisition, sales, fulfillment, or team?"
                cardId="month:constraint"
              >
                <div className="bg-rose-900/15 border border-rose-800/40 rounded-md px-4 py-3 mb-4 flex items-center gap-3">
                  <AlertTriangle size={18} className="text-rose-300 flex-shrink-0" />
                  <div>
                    <div className="text-[11px] text-rose-300 uppercase tracking-wider font-bold">Your constraint right now</div>
                    <div className="text-white font-bold text-lg mt-0.5">{c.pillar ?? '—'}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">{c.hint}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {c.pillars.map((p, i) => (
                    <div key={p.name} className={`rounded-md p-3 border ${i === 0 ? 'bg-rose-900/15 border-rose-800/40' : 'bg-black/20 border-gray-800'}`}>
                      <div className="text-[11px] text-gray-400 uppercase tracking-wider">{p.name}</div>
                      <div className={`text-2xl font-bold tabular-nums ${p.score >= 70 ? 'text-emerald-300' : p.score >= 40 ? 'text-amber-300' : 'text-rose-300'}`}>{Math.round(p.score)}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">{p.hint}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-[10px] text-gray-500 italic">
                  Score = blended health metric per pillar (target-relative). Lower score = bigger drag on the business.
                </div>
              </CardShell>
            );
          })()}

          {/* 4. EXPENSE EFFICIENCY */}
          {(() => {
            const ee = data.expenseEfficiency;
            const overTarget = ee.target > 0 && ee.actual > ee.target;
            return (
              <CardShell
                title="4. Expense Efficiency"
                subtitle="Total spend vs target · per-category overspend · top vendors to renegotiate or cut"
                cardId="month:expense-efficiency"
              >
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className={`bg-black/20 border rounded-lg p-3 ${overTarget ? 'border-rose-800/40' : 'border-emerald-800/40'}`}>
                    <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">Total Spent</div>
                    <div className={`text-2xl font-bold tabular-nums mt-1 ${overTarget ? 'text-rose-300' : 'text-emerald-300'}`}>{fmtUSD(ee.actual)}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {ee.target > 0 ? <>target {fmtUSD(ee.target)}</> : 'no target set'}
                    </div>
                  </div>
                  <div className="bg-black/20 border border-gray-800 rounded-lg p-3">
                    <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">Over / Under</div>
                    <div className={`text-2xl font-bold tabular-nums mt-1 ${ee.overBy > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                      {ee.overBy > 0 ? '+' : ''}{fmtUSD(ee.overBy)}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">vs target</div>
                  </div>
                  <div className="bg-black/20 border border-gray-800 rounded-lg p-3">
                    <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">vs Last Month</div>
                    <div className={`text-2xl font-bold tabular-nums mt-1 ${ee.momDelta > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                      {ee.momDelta >= 0 ? '+' : ''}{fmtUSD(ee.momDelta)}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">MoM change</div>
                  </div>
                </div>

                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold border-b border-gray-800">
                        <th className="text-left py-2">Category</th>
                        <th className="text-right py-2 px-3">Actual</th>
                        <th className="text-right py-2 px-3">Target</th>
                        <th className="text-right py-2 px-3">Vs Target</th>
                        <th className="text-right py-2 px-3">% of Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ee.categories.map((c) => (
                        <tr key={c.category} className="border-b border-gray-800/50">
                          <td className="py-2 text-white font-medium capitalize">{c.category}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-gray-200">{fmtUSD(c.actual)}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-gray-400">{c.target > 0 ? fmtUSD(c.target) : '—'}</td>
                          <td className={`py-2 px-3 text-right tabular-nums ${c.overBudget ? 'text-rose-300' : 'text-emerald-300'}`}>
                            {c.target > 0 ? (c.overBy > 0 ? `+${fmtUSD(c.overBy)}` : fmtUSD(c.overBy)) : '—'}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-gray-400">
                            {c.pctOfTarget !== null ? fmtPct(c.pctOfTarget) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold mb-2">
                  Top 10 Vendors · candidates for &quot;negotiate or cut&quot;
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {ee.topVendors.map((v, i) => (
                    <div key={i} className="flex items-center justify-between bg-black/20 border border-gray-800 rounded px-3 py-1.5 text-sm">
                      <span className="text-white truncate" title={v.vendor}>{i + 1}. {v.vendor}</span>
                      <span className="text-gray-300 tabular-nums font-medium">{fmtUSD(v.total)}</span>
                    </div>
                  ))}
                </div>
              </CardShell>
            );
          })()}

          {/* 5. DOUBLE DOWN / KILL */}
          {(() => {
            const dd = data.doubleDownKill;
            const max = Math.max(...dd.channelBreakdown.map((c) => c.cash), 1);
            return (
              <CardShell
                title="5. Double Down / Kill"
                subtitle="What's working better than everything else? Top funnel · best closer · best setter."
                cardId="month:double-down"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                  <div className="bg-emerald-900/10 border border-emerald-800/40 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Trophy size={14} className="text-cyan-300" />
                      <span className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">Top Funnel</span>
                    </div>
                    {dd.topFunnel ? (
                      <>
                        <div className="text-xl font-bold text-white">{dd.topFunnel.source}</div>
                        <div className="text-emerald-300 tabular-nums font-semibold mt-0.5">{fmtUSD(dd.topFunnel.cash)}</div>
                        <div className="text-[10px] text-gray-500">cash this month</div>
                      </>
                    ) : <div className="text-gray-500 text-sm italic">No deals this month</div>}
                  </div>
                  <div className="bg-emerald-900/10 border border-emerald-800/40 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Crown size={14} className="text-amber-300" />
                      <span className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">Best Closer</span>
                    </div>
                    {dd.bestCloser ? (
                      <>
                        <div className="text-xl font-bold text-white">{dd.bestCloser.name}</div>
                        <div className="text-amber-300 tabular-nums font-semibold mt-0.5">{fmtPct(dd.bestCloser.closeRate)} close rate</div>
                        <div className="text-[10px] text-gray-500">{fmtUSD(dd.bestCloser.cashPerCall)}/call · {dd.bestCloser.shown} shown</div>
                      </>
                    ) : <div className="text-gray-500 text-sm italic">Not enough closer activity (≥5 shown)</div>}
                  </div>
                  <div className="bg-emerald-900/10 border border-emerald-800/40 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Crown size={14} className="text-violet-300" />
                      <span className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">Best Setter</span>
                    </div>
                    {dd.bestSetter ? (
                      <>
                        <div className="text-xl font-bold text-white">{dd.bestSetter.name}</div>
                        <div className="text-violet-300 tabular-nums font-semibold mt-0.5">{dd.bestSetter.booked} booked</div>
                        <div className="text-[10px] text-gray-500">{dd.bestSetter.shown} shown</div>
                      </>
                    ) : <div className="text-gray-500 text-sm italic">No setter activity recorded</div>}
                  </div>
                </div>

                <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold mb-2">Channel cash · full ladder</div>
                <div className="space-y-1">
                  {dd.channelBreakdown.length === 0 ? (
                    <div className="text-gray-500 text-sm italic">No deals this month</div>
                  ) : (
                    dd.channelBreakdown.map((c) => (
                      <div key={c.source}>
                        <div className="flex items-center justify-between text-xs mb-0.5">
                          <span className="text-white font-medium">{c.source}</span>
                          <span className="text-gray-300 tabular-nums">{fmtUSD(c.cash)}</span>
                        </div>
                        <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${(c.cash / max) * 100}%` }} />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardShell>
            );
          })()}

          {/* CEO Reflection + Next Month Plan removed 2026-05-02 —
             the operator does the prose + forward checklist in Google Docs,
             so /month stays focused on data only. */}

          {/* Footer */}
          <div className="pt-2 text-xs text-gray-500 flex items-center gap-4 flex-wrap">
            <Link href="/" className="hover:text-gray-300 inline-flex items-center gap-1">Main Dashboard <ArrowUpRight size={11} /></Link>
            <span>·</span>
            <Link href="/today" className="hover:text-gray-300 inline-flex items-center gap-1">Daily <ArrowUpRight size={11} /></Link>
            <span>·</span>
            <Link href="/week" className="hover:text-gray-300 inline-flex items-center gap-1">Weekly <ArrowUpRight size={11} /></Link>
          </div>
        </>
      )}
    </div>
  );
}
