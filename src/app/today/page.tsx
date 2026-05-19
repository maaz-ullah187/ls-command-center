'use client';

/**
 * /today — CEO Daily Review Checklist
 *
 * the operator 2026-04-30 spec: a structured top-to-bottom walkthrough of
 * yesterday's data so he can answer his standard CEO questions in one
 * page. Cards in his stated order:
 *
 *   1. Daily Review Queue — pending categorizations + anomalies
 *   2. Yesterday's Income — cash by payment_type bucket
 *   3. Yesterday's Expenses — list + flags
 *   4. Booking Capacity — yesterday's per-closer booked/shown vs the
 *      6-call rule of thumb
 *   5. Organic Leads — leads from organic platforms (vs target / 7-day)
 *   6. Sales Performance — 3-day + 7-day close + show rates, per-closer
 *      Cash/Call to spot underperformers
 *
 * Reuses ReviewQueueBanner from the main dashboard. All other cards
 * pull from /api/today/ceo-checklist (one fetch, no waterfalls).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, AlertTriangle, CheckCircle2, ArrowUpRight, Flame, AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Bar, ReferenceLine, XAxis, YAxis, Tooltip } from 'recharts';
import ReviewQueueBanner from '@/components/ReviewQueueBanner';
import CardShell from '@/components/main/CardShell';
import { useDashboardData } from '@/hooks/useDashboardData';

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(0)}%`;

interface Checklist {
  configured: boolean;
  yesterday: string;
  sevenAgo: string;
  threeAgo: string;
  yesterdayIncome: {
    newCash: number;
    ar: number;
    upsellRenewal: number;
    mastermind: number;
    uncategorized: number;
    refunds: number;
    grossIncome: number;
    netIncome: number;
    last14Days: Array<{ date: string; net: number }>;
    trailing7dAvg: number;
    dailyTarget: number;
    monthlyRevTarget: number;
    yesterdayVsTarget: number;
    yesterdayVs7d: number;
    paceStatus: 'above' | 'on' | 'below';
  };
  yesterdayExpenses: {
    total: number;
    rowCount: number;
    flaggedCount: number;
    flagged: Array<{ id: string; vendor: string; amount: number; type: string; flag: string }>;
    all: Array<{ id: string; vendor: string | null; amount: number; type: string | null; card: string | null }>;
    last14Days: Array<{ date: string; total: number }>;
    trailing7dAvg: number;
    dailyTarget: number;
    monthlyExpenseCap: number;
    yesterdayVsTarget: number;
    yesterdayVs7d: number;
    paceStatus: 'under' | 'on' | 'over';
  };
  bookingCapacity: {
    threshold: number;                  // 7 calls/day = 100% capacity
    emergencyThresholdPct: number;      // ≤ 70% triggers protocol
    windowDays: number;
    windowFrom: string;
    windowTo: string;
    closersBelowCapacity: number;
    totalBooked: number;
    totalShowed: number;
    teamAvgBookedPerDay: number;
    teamCapacityPct: number;
    closers: Array<{
      closer: string;
      booked: number;
      showed: number;
      closed: number;
      noShows: number;
      cancelled: number;
      cash: number;
      showRate: number;
      closeRate: number;
      cancelRate: number;
      avgBookedPerDay: number;
      capacityPct: number;
      daysReporting: number;
      belowCapacity: boolean;
    }>;
  };
  organicLeads: {
    yesterdayTotal: number;
    last7dTotal: number;
    byPlatform: Array<{ source: string; yesterday: number; last7d: number }>;
  };
  salesPerformance: {
    last3d: { showed: number; closed: number; cashCollected: number; showRate: number; closeRate: number; noShows: number; cancelled: number };
    last7d: { showed: number; closed: number; cashCollected: number; showRate: number; closeRate: number; noShows: number; cancelled: number };
    perCloserCashCall: Array<{ closer: string; showed: number; cash: number; cashPerCall: number }>;
  };
}

function formatLongDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function TodayPage() {
  // ReviewQueueBanner needs leads (it does its own fetches for the buckets
  // that don't come from leads, but it expects a Lead[] for revenue-flag
  // anomalies). Reuse the dashboard hook so the data is identical to /.
  const { leads } = useDashboardData();
  const [data, setData] = useState<Checklist | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setLoading(true);
      fetch(`/api/today/ceo-checklist?_t=${Date.now()}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled) setData(d); })
        .catch(() => { if (!cancelled) setData(null); })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    load();
    const onRefetch = () => load();
    window.addEventListener('billing:categorized', onRefetch);
    window.addEventListener('expense:categorized', onRefetch);
    return () => {
      cancelled = true;
      window.removeEventListener('billing:categorized', onRefetch);
      window.removeEventListener('expense:categorized', onRefetch);
    };
  }, []);

  const handleUpdateLead = () => { /* no-op — review queue handles its own writes */ };

  // Emergency-booking-protocol notification handlers. Both POST to a
  // dedicated endpoint that fires a Slack message to the right channel.
  const [notifyState, setNotifyState] = useState<{ which: 'content' | 'sales' | null; status: 'sending' | 'sent' | 'error'; msg?: string } | null>(null);
  const sendNotify = async (which: 'content' | 'sales') => {
    if (!data) return;
    setNotifyState({ which, status: 'sending' });
    try {
      const url = which === 'content'
        ? '/api/today/notify/content-manager'
        : '/api/today/notify/sales-manager';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamCapacityPct: data.bookingCapacity.teamCapacityPct,
          closersBelowCapacity: data.bookingCapacity.closersBelowCapacity,
          totalClosers: data.bookingCapacity.closers.length,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        setNotifyState({ which, status: 'error', msg: j?.error ?? `HTTP ${res.status}` });
        return;
      }
      setNotifyState({ which, status: 'sent' });
      setTimeout(() => setNotifyState(null), 4000);
    } catch (e) {
      setNotifyState({ which, status: 'error', msg: (e as Error).message });
    }
  };

  return (
    <div className="px-6 py-5 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-white font-bold text-2xl tracking-tight">Today&apos;s CEO Review</h1>
          <p className="text-sm text-gray-400 mt-1">
            {data ? `Yesterday: ${formatLongDate(data.yesterday)}` : 'Daily checklist'} · top-to-bottom walkthrough
          </p>
        </div>
        {/* the operator 2026-04-30: link out to the daily checklist Google
            Doc so the dashboard scan + the manual checklist live side
            by side. */}
        <a
          href="https://docs.google.com/document/d/1IjSRlT4-H2QZavZblU46X_my-88mv5skKzw6PZe55IU/edit?tab=t.pm5ijajoie46"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-900/20 hover:bg-blue-900/40 border border-blue-800/40 hover:border-blue-700 rounded-md text-xs text-blue-200 hover:text-white transition-colors"
        >
          <ArrowUpRight size={12} /> Daily Non-Negotiables Doc
        </a>
      </div>

      {/* 1. Review Queue */}
      <ReviewQueueBanner leads={leads} onUpdateLead={handleUpdateLead} />

      {loading && !data ? (
        <div className="text-gray-400 text-sm flex items-center gap-2 py-8">
          <Loader2 size={14} className="animate-spin" /> Pulling yesterday&apos;s data…
        </div>
      ) : !data || !data.configured ? (
        <div className="text-rose-400 text-sm py-8">Could not load checklist data.</div>
      ) : (
        <>
          {/* 2. Yesterday's Income — pace-aware with 14-day sparkline */}
          {(() => {
            const yi = data.yesterdayIncome;
            const paceColor = yi.paceStatus === 'above' ? 'text-emerald-300'
              : yi.paceStatus === 'below' ? 'text-rose-300'
              : 'text-amber-300';
            const paceBg = yi.paceStatus === 'above' ? 'bg-emerald-900/30 border-emerald-700/40'
              : yi.paceStatus === 'below' ? 'bg-rose-900/30 border-rose-700/40'
              : 'bg-amber-900/30 border-amber-700/40';
            const paceLabel = yi.paceStatus === 'above' ? 'Above pace'
              : yi.paceStatus === 'below' ? 'Below pace'
              : 'On pace';
            const PaceIcon = yi.paceStatus === 'above' ? TrendingUp
              : yi.paceStatus === 'below' ? TrendingDown
              : Minus;
            const chartData = yi.last14Days.map((p) => ({
              date: p.date,
              day: Number(p.date.slice(8, 10)),
              net: p.net,
              isYesterday: p.date === data.yesterday,
            }));
            return (
              <CardShell
                title="Yesterday's Income"
                subtitle="Same source as Revenue Composition donut — pace vs daily target + 14-day sparkline"
                cardId="today:income"
              >
                <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className="text-4xl font-bold text-white tracking-tight tabular-nums">{fmtUSD(yi.netIncome)}</span>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-semibold uppercase tracking-wider ${paceBg} ${paceColor}`}>
                        <PaceIcon size={12} /> {paceLabel}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {yi.dailyTarget > 0 ? (
                        <>
                          {yi.yesterdayVsTarget >= 0 ? (
                            <span className="text-emerald-400 font-medium">{fmtUSD(yi.yesterdayVsTarget)} above</span>
                          ) : (
                            <span className="text-rose-400 font-medium">{fmtUSD(Math.abs(yi.yesterdayVsTarget))} below</span>
                          )}
                          {' '}daily target of {fmtUSD(yi.dailyTarget)}
                        </>
                      ) : (
                        <span>No monthly target set</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-right">
                    <div>
                      <div className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">7-day avg</div>
                      <div className="text-lg font-bold text-white tabular-nums mt-0.5">{fmtUSD(yi.trailing7dAvg)}</div>
                      <div className="text-[10px] text-gray-500">
                        {yi.yesterdayVs7d >= 0 ? '↑ above avg' : '↓ below avg'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">Daily target</div>
                      <div className="text-lg font-bold text-white tabular-nums mt-0.5">{fmtUSD(yi.dailyTarget)}</div>
                      <div className="text-[10px] text-gray-500">
                        {yi.monthlyRevTarget > 0 ? `${fmtUSD(yi.monthlyRevTarget)}/mo ÷ ${yi.last14Days.length > 0 ? new Date(yi.last14Days[yi.last14Days.length - 1].date).getFullYear() : ''} mo days` : 'set monthly target'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 14-day sparkline */}
                <div className="h-[140px] -mx-2 mb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <XAxis
                        dataKey="day"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        axisLine={{ stroke: '#374151' }}
                        tickLine={false}
                      />
                      <YAxis hide />
                      <Tooltip
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        content={(p: any) => {
                          if (!p?.active || !p?.payload?.length) return null;
                          const d = p.payload[0]?.payload;
                          if (!d) return null;
                          return (
                            <div className="bg-[#1a1d23] border border-gray-700 rounded-lg px-2.5 py-1.5 shadow-lg">
                              <div className="text-[10px] text-gray-400 uppercase tracking-wider">{d.date}</div>
                              <div className={`text-sm font-bold tabular-nums mt-0.5 ${d.net >= yi.dailyTarget ? 'text-emerald-300' : 'text-rose-300'}`}>{fmtUSD(d.net)}</div>
                              <div className="text-[10px] text-gray-500">{d.net >= yi.dailyTarget ? '↑ above' : '↓ below'} daily target</div>
                            </div>
                          );
                        }}
                      />
                      {yi.dailyTarget > 0 && (
                        <ReferenceLine
                          y={yi.dailyTarget}
                          stroke="#10b981"
                          strokeDasharray="3 3"
                          strokeWidth={1.5}
                          label={{ position: 'right', value: 'target', fill: '#10b981', fontSize: 9 }}
                        />
                      )}
                      <Bar
                        dataKey="net"
                        radius={[2, 2, 0, 0]}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        shape={(props: any) => {
                          const { x, y, width, height, payload } = props;
                          const aboveTarget = payload.net >= yi.dailyTarget;
                          const isYesterday = payload.isYesterday;
                          const fillColor = payload.net === 0 ? '#1f2530'
                            : aboveTarget ? '#10b981'
                            : '#dc2626';
                          const opacity = isYesterday ? 1 : 0.5;
                          return (
                            <rect
                              x={x}
                              y={y}
                              width={width}
                              height={height}
                              fill={fillColor}
                              opacity={opacity}
                              rx={2}
                              stroke={isYesterday ? '#fff' : 'none'}
                              strokeWidth={isYesterday ? 1 : 0}
                            />
                          );
                        }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Bucket breakdown — single line summary */}
                <div className="pt-3 border-t border-gray-800 grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                  {[
                    { label: 'New', value: yi.newCash, color: 'text-emerald-300' },
                    { label: 'AR', value: yi.ar, color: 'text-blue-300' },
                    { label: 'Upsell/Ren', value: yi.upsellRenewal, color: 'text-purple-300' },
                    { label: 'Mastermind', value: yi.mastermind, color: 'text-amber-300' },
                    { label: 'Uncategorized', value: yi.uncategorized, color: 'text-gray-400' },
                    { label: 'Refunds', value: -yi.refunds, color: 'text-rose-300' },
                  ].map((b) => (
                    <div key={b.label}>
                      <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">{b.label}</div>
                      <div className={`tabular-nums font-semibold ${b.color}`}>{fmtUSD(b.value)}</div>
                    </div>
                  ))}
                </div>
              </CardShell>
            );
          })()}

          {/* 3. Yesterday's Expenses — pace-aware with 14-day sparkline */}
          {(() => {
            const ye = data.yesterdayExpenses;
            // For expenses, LOW is good — colors invert vs income.
            const paceColor = ye.paceStatus === 'under' ? 'text-emerald-300'
              : ye.paceStatus === 'over' ? 'text-rose-300'
              : 'text-amber-300';
            const paceBg = ye.paceStatus === 'under' ? 'bg-emerald-900/30 border-emerald-700/40'
              : ye.paceStatus === 'over' ? 'bg-rose-900/30 border-rose-700/40'
              : 'bg-amber-900/30 border-amber-700/40';
            const paceLabel = ye.paceStatus === 'under' ? 'Under pace'
              : ye.paceStatus === 'over' ? 'Over pace'
              : 'On pace';
            const PaceIcon = ye.paceStatus === 'under' ? TrendingDown
              : ye.paceStatus === 'over' ? TrendingUp
              : Minus;
            const expChartData = ye.last14Days.map((p) => ({
              date: p.date,
              day: Number(p.date.slice(8, 10)),
              total: p.total,
              isYesterday: p.date === data.yesterday,
            }));
            return (
              <CardShell
                title="Yesterday's Expenses"
                subtitle={`${ye.rowCount} transactions yesterday · ${ye.flaggedCount} flagged · 14-day pace context below`}
                cardId="today:expenses"
              >
                <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className="text-4xl font-bold text-white tracking-tight tabular-nums">{fmtUSD(ye.total)}</span>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-semibold uppercase tracking-wider ${paceBg} ${paceColor}`}>
                        <PaceIcon size={12} /> {paceLabel}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {ye.dailyTarget > 0 ? (
                        <>
                          {ye.yesterdayVsTarget <= 0 ? (
                            <span className="text-emerald-400 font-medium">{fmtUSD(Math.abs(ye.yesterdayVsTarget))} under</span>
                          ) : (
                            <span className="text-rose-400 font-medium">{fmtUSD(ye.yesterdayVsTarget)} over</span>
                          )}
                          {' '}daily expense pace of {fmtUSD(ye.dailyTarget)}
                        </>
                      ) : (
                        <span>No monthly expense cap set</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-right">
                    <div>
                      <div className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">7-day avg</div>
                      <div className="text-lg font-bold text-white tabular-nums mt-0.5">{fmtUSD(ye.trailing7dAvg)}</div>
                      <div className="text-[10px] text-gray-500">
                        {ye.yesterdayVs7d <= 0 ? '↓ below avg' : '↑ above avg'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">Daily pace</div>
                      <div className="text-lg font-bold text-white tabular-nums mt-0.5">{fmtUSD(ye.dailyTarget)}</div>
                      <div className="text-[10px] text-gray-500">
                        {ye.monthlyExpenseCap > 0 ? `${fmtUSD(ye.monthlyExpenseCap)}/mo cap` : 'set monthly cap'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 14-day expense sparkline */}
                <div className="h-[140px] -mx-2 mb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={expChartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <XAxis
                        dataKey="day"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        axisLine={{ stroke: '#374151' }}
                        tickLine={false}
                      />
                      <YAxis hide />
                      <Tooltip
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        content={(p: any) => {
                          if (!p?.active || !p?.payload?.length) return null;
                          const d = p.payload[0]?.payload;
                          if (!d) return null;
                          const overOrUnder = d.total > ye.dailyTarget;
                          return (
                            <div className="bg-[#1a1d23] border border-gray-700 rounded-lg px-2.5 py-1.5 shadow-lg">
                              <div className="text-[10px] text-gray-400 uppercase tracking-wider">{d.date}</div>
                              <div className={`text-sm font-bold tabular-nums mt-0.5 ${overOrUnder ? 'text-rose-300' : 'text-emerald-300'}`}>{fmtUSD(d.total)}</div>
                              <div className="text-[10px] text-gray-500">{overOrUnder ? '↑ over' : '↓ under'} daily pace</div>
                            </div>
                          );
                        }}
                      />
                      {ye.dailyTarget > 0 && (
                        <ReferenceLine
                          y={ye.dailyTarget}
                          stroke="#f43f5e"
                          strokeDasharray="3 3"
                          strokeWidth={1.5}
                          label={{ position: 'right', value: 'pace', fill: '#f43f5e', fontSize: 9 }}
                        />
                      )}
                      <Bar
                        dataKey="total"
                        radius={[2, 2, 0, 0]}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        shape={(props: any) => {
                          const { x, y, width, height, payload } = props;
                          const overPace = payload.total > ye.dailyTarget;
                          const isYesterday = payload.isYesterday;
                          // INVERTED logic vs income — for expenses, low = good
                          const fillColor = payload.total === 0 ? '#1f2530'
                            : overPace ? '#dc2626'
                            : '#10b981';
                          const opacity = isYesterday ? 1 : 0.5;
                          return (
                            <rect
                              x={x}
                              y={y}
                              width={width}
                              height={height}
                              fill={fillColor}
                              opacity={opacity}
                              rx={2}
                              stroke={isYesterday ? '#fff' : 'none'}
                              strokeWidth={isYesterday ? 1 : 0}
                            />
                          );
                        }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Flagged + transactions list (unchanged below) */}
                {ye.rowCount === 0 ? (
                  <div className="text-emerald-400 text-sm flex items-center gap-2 pt-3 border-t border-gray-800"><CheckCircle2 size={14} /> No expenses yesterday — clean slate.</div>
                ) : (
                  <div className="space-y-3 pt-3 border-t border-gray-800">
                {data.yesterdayExpenses.flaggedCount > 0 && (
                  <div>
                    <div className="text-xs text-amber-300 uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5">
                      <AlertTriangle size={12} /> Flagged · {data.yesterdayExpenses.flaggedCount}
                    </div>
                    <div className="space-y-1.5">
                      {data.yesterdayExpenses.flagged.map((f) => (
                        <div key={f.id} className="flex items-center justify-between text-sm bg-amber-900/10 border border-amber-800/40 rounded-md px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-white font-medium truncate">{f.vendor}</div>
                            <div className="text-[11px] text-amber-300 mt-0.5">{f.flag} · {f.type || 'no category'}</div>
                          </div>
                          <div className="text-amber-300 font-bold tabular-nums">{fmtUSD(f.amount)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <details className="group">
                  <summary className="text-[11px] text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-300 select-none">
                    All {data.yesterdayExpenses.rowCount} transactions ▾
                  </summary>
                  <div className="mt-2 space-y-1">
                    {data.yesterdayExpenses.all.map((r) => (
                      <div key={r.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-800/50">
                        <div className="min-w-0 flex-1">
                          <div className="text-gray-200 truncate">{r.vendor || '?'}</div>
                          <div className="text-[10px] text-gray-500">{r.type ?? 'unknown'} · {r.card ?? '—'}</div>
                        </div>
                        <div className="text-gray-300 tabular-nums">{fmtUSD(r.amount)}</div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </CardShell>
            );
          })()}

          {/* 4. Booking Capacity — the operator 2026-04-30: rolling 4-day window
             so we catch sustained capacity drops, not single-day blips.
             Belowcapacity = avg bookings/day across window < 6. */}
          <CardShell
            title={`Booking Capacity · ${data.bookingCapacity.totalBooked} booked, ${data.bookingCapacity.totalShowed} shown · last ${data.bookingCapacity.windowDays}d`}
            subtitle={`100% = ${data.bookingCapacity.threshold} calls/day per closer. Emergency protocol fires when any closer ≤ ${data.bookingCapacity.emergencyThresholdPct}%. Team running at ${Math.round(data.bookingCapacity.teamCapacityPct)}%.`}
            cardId="today:booking-capacity"
          >
            {data.bookingCapacity.closers.length === 0 ? (
              <div className="text-gray-400 text-sm">No closer EODs posted in the last {data.bookingCapacity.windowDays} days.</div>
            ) : (
              <div>
                {data.bookingCapacity.closersBelowCapacity > 0 && (
                  <div className="bg-rose-900/20 border border-rose-800/40 rounded-md px-3 py-3 mb-3 space-y-2">
                    <div className="flex items-start gap-2 text-sm">
                      <AlertCircle size={14} className="text-rose-300 flex-shrink-0 mt-0.5" />
                      <span className="text-rose-200">
                        <span className="font-bold uppercase tracking-wider text-[11px] text-rose-300">Emergency booking protocol:</span>{' '}
                        {data.bookingCapacity.closersBelowCapacity} of {data.bookingCapacity.closers.length} closer{data.bookingCapacity.closers.length === 1 ? '' : 's'} at or below {data.bookingCapacity.emergencyThresholdPct}% capacity across the last {data.bookingCapacity.windowDays} days.
                        Team running at <span className="font-bold tabular-nums">{Math.round(data.bookingCapacity.teamCapacityPct)}%</span>.
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      <button
                        onClick={() => sendNotify('content')}
                        disabled={notifyState?.which === 'content' && notifyState?.status === 'sending'}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md text-xs font-semibold transition-colors"
                      >
                        {notifyState?.which === 'content' && notifyState?.status === 'sending'
                          ? <Loader2 size={12} className="animate-spin" />
                          : <ArrowUpRight size={12} />}
                        Notify content manager — IG story CTA
                      </button>
                      <button
                        onClick={() => sendNotify('sales')}
                        disabled={notifyState?.which === 'sales' && notifyState?.status === 'sending'}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-md text-xs font-semibold transition-colors"
                      >
                        {notifyState?.which === 'sales' && notifyState?.status === 'sending'
                          ? <Loader2 size={12} className="animate-spin" />
                          : <ArrowUpRight size={12} />}
                        Notify sales manager — run reactivation
                      </button>
                      {notifyState?.status === 'sent' && (
                        <span className="text-emerald-300 text-xs inline-flex items-center gap-1">
                          <CheckCircle2 size={12} /> Sent to {notifyState.which === 'content' ? '#content-manager' : '#sales-manager'}
                        </span>
                      )}
                      {notifyState?.status === 'error' && (
                        <span className="text-rose-300 text-xs">Error: {notifyState.msg}</span>
                      )}
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold border-b border-gray-800">
                        <th className="text-left py-2">Closer</th>
                        <th className="text-right py-2 px-3">Booked</th>
                        <th className="text-right py-2 px-3" title="Avg calls booked per day across the window">Avg/Day</th>
                        <th className="text-right py-2 px-3" title="100% = 7 calls/day. ≤ 70% triggers emergency protocol.">Capacity%</th>
                        <th className="text-right py-2 px-3">Shown</th>
                        <th className="text-right py-2 px-3">No Shows</th>
                        <th className="text-right py-2 px-3">Cancels</th>
                        <th className="text-right py-2 px-3" title="Show% = shown ÷ (booked − cancelled)">Show%</th>
                        <th className="text-right py-2 px-3" title="Close% = closed ÷ shown">Close%</th>
                        <th className="text-right py-2 px-3" title="Cancel% = cancels ÷ booked">Cancel%</th>
                        <th className="text-right py-2 px-3">Closed</th>
                        <th className="text-right py-2 px-3">Cash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bookingCapacity.closers.map((c) => {
                        // Capacity color tiers: ≤70% red, 70-99% amber, ≥100% green.
                        const capColor = c.capacityPct <= data.bookingCapacity.emergencyThresholdPct
                          ? 'text-rose-300 font-bold'
                          : c.capacityPct < 100
                            ? 'text-amber-300 font-semibold'
                            : 'text-emerald-300 font-semibold';
                        return (
                          <tr key={c.closer} className={`border-b border-gray-800/50 ${c.belowCapacity ? 'bg-rose-900/10' : ''}`}>
                            <td className="py-2 text-white font-medium">
                              {c.closer}
                              {c.belowCapacity && <Flame size={11} className="inline ml-2 text-rose-300" />}
                            </td>
                            <td className={`py-2 px-3 text-right tabular-nums ${c.belowCapacity ? 'text-rose-300 font-semibold' : 'text-gray-300'}`}>{c.booked}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-gray-300">{c.avgBookedPerDay.toFixed(1)}</td>
                            <td className={`py-2 px-3 text-right tabular-nums ${capColor}`}>{Math.round(c.capacityPct)}%</td>
                            <td className="py-2 px-3 text-right tabular-nums text-gray-300">{c.showed}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-rose-300">{c.noShows}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-amber-300">{c.cancelled}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-gray-300">{fmtPct(c.showRate)}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-gray-300">{fmtPct(c.closeRate)}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-amber-200">{fmtPct(c.cancelRate)}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-gray-300">{c.closed}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-emerald-300">{fmtUSD(c.cash)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardShell>

          {/* 5. Organic Leads */}
          <CardShell
            title={`Organic Leads · ${data.organicLeads.yesterdayTotal} yesterday, ${data.organicLeads.last7dTotal} last 7d`}
            subtitle="Leads by canonical organic source — YouTube / Instagram / X / LinkedIn / Webinar / Referral / Organic"
            cardId="today:organic-leads"
          >
            {data.organicLeads.byPlatform.length === 0 ? (
              <div className="text-gray-400 text-sm">No organic leads in the last 7 days.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold border-b border-gray-800">
                    <th className="text-left py-2">Platform</th>
                    <th className="text-right py-2 px-3">Yesterday</th>
                    <th className="text-right py-2 px-3">Last 7 Days</th>
                    <th className="text-right py-2 px-3">Avg/Day</th>
                  </tr>
                </thead>
                <tbody>
                  {data.organicLeads.byPlatform.map((p) => (
                    <tr key={p.source} className="border-b border-gray-800/50">
                      <td className="py-2 text-white font-medium">{p.source}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-gray-200">{p.yesterday}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-emerald-300">{p.last7d}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-gray-400">{(p.last7d / 7).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardShell>

          {/* 6. Sales Performance */}
          <CardShell
            title="Sales Performance"
            subtitle="3-day + 7-day rolling close + show rates · per-closer Cash/Call to spot underperformers"
            cardId="today:sales-perf"
          >
            <div className="grid grid-cols-2 gap-4 mb-4">
              {[
                { label: 'Last 3 Days', data: data.salesPerformance.last3d },
                { label: 'Last 7 Days', data: data.salesPerformance.last7d },
              ].map((bucket) => (
                <div key={bucket.label} className="bg-black/20 rounded-lg p-4">
                  <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">{bucket.label}</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] text-gray-500">Show Rate</div>
                      <div className="text-xl font-bold text-white tabular-nums">{fmtPct(bucket.data.showRate)}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">{bucket.data.showed} of {bucket.data.showed + bucket.data.noShows + bucket.data.cancelled}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-500">Close Rate</div>
                      <div className="text-xl font-bold text-white tabular-nums">{fmtPct(bucket.data.closeRate)}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">{bucket.data.closed} of {bucket.data.showed} shown</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-500">Closed</div>
                      <div className="text-xl font-bold text-emerald-300 tabular-nums">{bucket.data.closed}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-500">Cash</div>
                      <div className="text-xl font-bold text-emerald-300 tabular-nums">{fmtUSD(bucket.data.cashCollected)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold mb-2">
              Cash / Call · 7-day (sorted high → low — bottom = underperformer to dig into)
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold border-b border-gray-800">
                  <th className="text-left py-2">Closer</th>
                  <th className="text-right py-2 px-3">Showed</th>
                  <th className="text-right py-2 px-3">Cash</th>
                  <th className="text-right py-2 px-3">Cash/Call</th>
                </tr>
              </thead>
              <tbody>
                {data.salesPerformance.perCloserCashCall.map((c, i) => {
                  const isBottom = i === data.salesPerformance.perCloserCashCall.length - 1 && data.salesPerformance.perCloserCashCall.length > 1;
                  return (
                    <tr key={c.closer} className={`border-b border-gray-800/50 ${isBottom ? 'bg-rose-900/10' : ''}`}>
                      <td className="py-2 text-white font-medium">
                        {c.closer}
                        {isBottom && <span className="ml-2 text-[10px] text-rose-300 uppercase tracking-wider">↓ lowest</span>}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-gray-300">{c.showed}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-gray-300">{fmtUSD(c.cash)}</td>
                      <td className={`py-2 px-3 text-right tabular-nums font-semibold ${i === 0 ? 'text-cyan-300' : 'text-gray-200'}`}>{fmtUSD(c.cashPerCall)}/call</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardShell>

          {/* Footer */}
          <div className="pt-2 text-xs text-gray-500 flex items-center gap-4">
            <Link href="/" className="hover:text-gray-300 inline-flex items-center gap-1">
              Main Dashboard <ArrowUpRight size={11} />
            </Link>
            <span>·</span>
            <span>Daily review complete when every section above checks out</span>
          </div>
        </>
      )}
    </div>
  );
}
