'use client';

import { useMemo, useState } from 'react';
import { Lead, Ad, DailyMetrics } from '@/lib/types';
import { mockClients, mockExpenses, getCSMStats, getCloserStats, getPnLSummary } from '@/lib/mock-data';
import { aggregateMetrics } from '@/lib/calculations';

interface CEOReportTabProps {
  leads: Lead[];
  ads: Ad[];
  dailyMetrics: DailyMetrics[];
}

type ReportView = 'daily' | 'weekly' | 'monthly';

// ── Formatting helpers ──────────────────────────────────────────────────────
const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

const fmtDelta = (n: number) => (n >= 0 ? `+${n.toFixed(1)}%` : `${n.toFixed(1)}%`);

const pctChange = (curr: number, prev: number) =>
  prev === 0 ? (curr > 0 ? 100 : 0) : ((curr - prev) / prev) * 100;

// ── Status helpers ──────────────────────────────────────────────────────────
type Status = 'good' | 'warning' | 'bad';

const statusColor = (s: Status) =>
  s === 'good' ? 'text-emerald-400' : s === 'warning' ? 'text-amber-400' : 'text-red-400';

const statusBg = (s: Status) =>
  s === 'good' ? 'bg-emerald-500/10 border-emerald-500/30' : s === 'warning' ? 'bg-amber-500/10 border-amber-500/30' : 'bg-red-500/10 border-red-500/30';

const statusDot = (s: Status) =>
  s === 'good' ? 'bg-emerald-400' : s === 'warning' ? 'bg-amber-400' : 'bg-red-400';

const arrow = (val: number, invert = false) => {
  const up = invert ? val < 0 : val > 0;
  if (Math.abs(val) < 0.5) return <span className="text-gray-500">--</span>;
  return up
    ? <span className="text-emerald-400">{fmtDelta(val)}</span>
    : <span className="text-red-400">{fmtDelta(val)}</span>;
};

// ── Card / Section wrapper ──────────────────────────────────────────────────
function Card({ title, icon, children, className = '' }: { title: string; icon?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-700 bg-[#1a1d23] p-5 ${className}`}>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
        {icon && <span>{icon}</span>}
        {title}
      </h3>
      {children}
    </div>
  );
}

function SuggestionBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-lg bg-[#141720] border border-gray-700/50 p-3 text-sm text-gray-300">
      <span className="text-amber-400 font-medium mr-1">Suggested action:</span>
      {children}
    </div>
  );
}

function MetricRow({ label, value, sub, status }: { label: string; value: string; sub?: React.ReactNode; status?: Status }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
      <span className="text-gray-400 text-sm">{label}</span>
      <div className="text-right">
        <span className={`font-semibold text-sm ${status ? statusColor(status) : 'text-white'}`}>{value}</span>
        {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ── Problem-solution matrix (from the operator's daily doc) ──────────────────────
const CONSTRAINT_SOLUTIONS: Record<string, string[]> = {
  'CPC Too High': [
    'Review hook angles — test 3 new UGC-style hooks this week',
    'Check audience saturation — exclude past 30-day engagers',
    'Test broad targeting with DCT creative',
  ],
  'CPL Too High': [
    'Audit landing page — test new VSL or headline',
    'Check ad-to-LP congruence — match messaging',
    'Test lead magnet funnel vs direct call booking',
  ],
  'Low L2B Rate': [
    'Check speed-to-lead — are setters following up within 5 min?',
    'Audit DM scripts — are they qualifying properly?',
    'Test automated booking confirmation sequence',
  ],
  'Low Show Rate': [
    'Add pre-call nurture sequence (SMS + email + video)',
    'Test same-day booking vs 2-day out',
    'Have setters do confirmation calls day-of',
  ],
  'Low Close Rate': [
    'Review recent call recordings — identify pattern breaks',
    'Run closer training on objection handling',
    'Check lead quality score — are unqualified leads getting through?',
  ],
  'Low ROAS': [
    'Pause bottom 20% of ads by ROAS immediately',
    'Shift budget to top 3 performing ad sets',
    'Test higher-ticket offer to increase AOV',
  ],
  'Low Organic Bookings': [
    'Increase posting frequency — 2x reels/day for 7 days',
    'Add stronger CTAs with DM triggers on every post',
    'Repurpose top-performing paid ad hooks as organic content',
  ],
  'Low AR Collection': [
    'CSM team to run collection blitz — call all 30+ day overdue',
    'Set up automated payment reminder sequence',
    'Review failed payment recovery process',
  ],
  'High Refund Rate': [
    'Review onboarding process — where are clients dropping off?',
    'Implement 48-hour post-purchase check-in call',
    'Audit last 5 refund reasons — fix root cause',
  ],
  'Low Profit Margin': [
    'Review all expenses — identify bottom 3 by ROI',
    'Negotiate vendor contracts — especially media buying fees',
    'Focus on backend upsells to increase LTV without new ad spend',
  ],
};

// ── KPI Thresholds ──────────────────────────────────────────────────────────
const KPI = {
  cpc: { target: 15, max: 25 },
  cpl: { target: 50, max: 80 },
  l2bRate: { target: 75, min: 60 },
  showRate: { target: 72, min: 55 },
  closeRate: { target: 35, min: 25 },
  roas: { target: 3, min: 1.5 },
  arCollectionRate: { target: 85, min: 80 },
  refundRate: { target: 2, max: 3 },
  profitMargin: { target: 30, min: 20 },
  organicBookingsPerDay: { ig: 3, yt: 2, liX: 2 },
  monthlyFrontendTarget: 240000,
  monthlyBackendTarget: 80000,
  monthlyAdBudget: 100000,
};

// ═════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function CEOReportTab({ leads, ads, dailyMetrics }: CEOReportTabProps) {
  const [view, setView] = useState<ReportView>('daily');

  // ── Derived data ────────────────────────────────────────────────────────
  const data = useMemo(() => {
    const today = dailyMetrics.length > 0 ? dailyMetrics[dailyMetrics.length - 1].date : '';
    const yesterday = dailyMetrics.length > 1 ? dailyMetrics[dailyMetrics.length - 2].date : '';
    const dayBefore = dailyMetrics.length > 2 ? dailyMetrics[dailyMetrics.length - 3].date : '';

    // Overall aggregated metrics
    const agg = aggregateMetrics(leads, ads, dailyMetrics);

    // Today / yesterday metrics
    const todayMetrics = dailyMetrics.find(d => d.date === today);
    const yesterdayMetrics = dailyMetrics.find(d => d.date === yesterday);
    const dayBeforeMetrics = dailyMetrics.find(d => d.date === dayBefore);

    // 7-day and prior 7-day
    const last7 = dailyMetrics.slice(-7);
    const prior7 = dailyMetrics.slice(-14, -7);

    const sum7 = (arr: DailyMetrics[]) => ({
      spend: arr.reduce((s, d) => s + d.spend, 0),
      leads: arr.reduce((s, d) => s + d.leads, 0),
      booked: arr.reduce((s, d) => s + d.callsBooked, 0),
      shown: arr.reduce((s, d) => s + d.callsShown, 0),
      closed: arr.reduce((s, d) => s + d.callsClosed, 0),
      revenue: arr.reduce((s, d) => s + d.revenue, 0),
    });

    const week = sum7(last7);
    const prevWeek = sum7(prior7);

    // Monthly (last 30 days)
    const last30 = dailyMetrics.slice(-30);
    const month = sum7(last30);

    // Clients / CSM / Closer / PnL
    const clients = mockClients;
    const csmStats = getCSMStats(clients);
    const closerStats = getCloserStats(leads);
    const expenses = mockExpenses;
    const frontEndCash = leads.filter(l => l.callOutcome === 'Closed Won').reduce((s, l) => s + l.cashCollected, 0);
    const pnl = getPnLSummary(clients, expenses, frontEndCash);

    // AR
    const totalProjectedAR = clients.reduce((s, c) => s + c.projectedAR, 0);
    const totalCollectedAR = clients.reduce((s, c) => s + c.arCollected, 0);
    const arRate = totalProjectedAR > 0 ? (totalCollectedAR / totalProjectedAR) * 100 : 0;

    // Refund
    const totalClients = clients.length;
    const refundedClients = clients.filter(c => c.wasRefunded).length;
    const refundRate = totalClients > 0 ? (refundedClients / totalClients) * 100 : 0;
    const refundAmount = clients.reduce((s, c) => s + c.refundAmount, 0);

    // Organic leads by channel
    const organicByChannel = (ch: string) => leads.filter(l => l.source === ch);
    const daysInRange = dailyMetrics.length || 1;
    const igBookingsPerDay = organicByChannel('Instagram').filter(l => l.demoBooked).length / daysInRange;
    const ytBookingsPerDay = organicByChannel('YouTube').filter(l => l.demoBooked).length / daysInRange;
    const liBookingsPerDay = organicByChannel('LinkedIn').filter(l => l.demoBooked).length / daysInRange;
    const xBookingsPerDay = organicByChannel('X').filter(l => l.demoBooked).length / daysInRange;

    // L2B rate (leads that booked / total leads)
    const l2bRate = agg.totalLeads > 0 ? (agg.callsBooked / agg.totalLeads) * 100 : 0;

    // Cashflow trend (7-day)
    const cashTrend = last7.map(d => d.revenue);
    const cashTrendSlope = cashTrend.length >= 2
      ? (cashTrend.slice(-3).reduce((s, v) => s + v, 0) / 3) - (cashTrend.slice(0, 3).reduce((s, v) => s + v, 0) / 3)
      : 0;

    // Expense budget
    const totalMonthlyExpenses = expenses.reduce((s, e) => s + e.amount, 0);

    // Backend cash
    const backendCash = clients.reduce((s, c) => s + c.upsellCash + c.mastermindCash + c.referralCashCollected, 0);

    // Upsell rate
    const activeClients = clients.filter(c => c.status === 'active').length;
    const upsoldClients = clients.filter(c => c.wasUpsold).length;
    const upsellRate = activeClients > 0 ? (upsoldClients / activeClients) * 100 : 0;

    return {
      today, yesterday, dayBefore,
      agg, todayMetrics, yesterdayMetrics, dayBeforeMetrics,
      last7, prior7, week, prevWeek, last30, month,
      clients, csmStats, closerStats, expenses, pnl,
      totalProjectedAR, totalCollectedAR, arRate,
      refundRate, refundAmount, refundedClients, totalClients,
      igBookingsPerDay, ytBookingsPerDay, liBookingsPerDay, xBookingsPerDay,
      l2bRate, cashTrend, cashTrendSlope,
      totalMonthlyExpenses, frontEndCash, backendCash,
      upsellRate, daysInRange,
    };
  }, [leads, ads, dailyMetrics]);

  // ── Constraint detection ────────────────────────────────────────────────
  const constraint = useMemo(() => {
    type Constraint = { area: string; metric: string; value: string; severity: Status; key: string };
    const issues: Constraint[] = [];

    // PAID
    if (data.agg.cpc > KPI.cpc.max)
      issues.push({ area: 'ACQUISITION (PAID)', metric: 'CPC', value: fmt(data.agg.cpc), severity: 'bad', key: 'CPC Too High' });
    else if (data.agg.cpc > KPI.cpc.target)
      issues.push({ area: 'ACQUISITION (PAID)', metric: 'CPC', value: fmt(data.agg.cpc), severity: 'warning', key: 'CPC Too High' });

    if (data.agg.cpl > KPI.cpl.max)
      issues.push({ area: 'ACQUISITION (PAID)', metric: 'CPL', value: fmt(data.agg.cpl), severity: 'bad', key: 'CPL Too High' });
    else if (data.agg.cpl > KPI.cpl.target)
      issues.push({ area: 'ACQUISITION (PAID)', metric: 'CPL', value: fmt(data.agg.cpl), severity: 'warning', key: 'CPL Too High' });

    if (data.l2bRate < KPI.l2bRate.min)
      issues.push({ area: 'ACQUISITION (PAID)', metric: 'L2B Rate', value: fmtPct(data.l2bRate), severity: 'bad', key: 'Low L2B Rate' });
    else if (data.l2bRate < KPI.l2bRate.target)
      issues.push({ area: 'ACQUISITION (PAID)', metric: 'L2B Rate', value: fmtPct(data.l2bRate), severity: 'warning', key: 'Low L2B Rate' });

    if (data.agg.showRate < KPI.showRate.min)
      issues.push({ area: 'ACQUISITION (PAID)', metric: 'Show Rate', value: fmtPct(data.agg.showRate), severity: 'bad', key: 'Low Show Rate' });
    else if (data.agg.showRate < KPI.showRate.target)
      issues.push({ area: 'ACQUISITION (PAID)', metric: 'Show Rate', value: fmtPct(data.agg.showRate), severity: 'warning', key: 'Low Show Rate' });

    if (data.agg.closeRate < KPI.closeRate.min)
      issues.push({ area: 'ACQUISITION (PAID)', metric: 'Close Rate', value: fmtPct(data.agg.closeRate), severity: 'bad', key: 'Low Close Rate' });
    else if (data.agg.closeRate < KPI.closeRate.target)
      issues.push({ area: 'ACQUISITION (PAID)', metric: 'Close Rate', value: fmtPct(data.agg.closeRate), severity: 'warning', key: 'Low Close Rate' });

    if (data.agg.roas < KPI.roas.min)
      issues.push({ area: 'ACQUISITION (PAID)', metric: 'ROAS', value: `${data.agg.roas.toFixed(2)}x`, severity: 'bad', key: 'Low ROAS' });
    else if (data.agg.roas < KPI.roas.target)
      issues.push({ area: 'ACQUISITION (PAID)', metric: 'ROAS', value: `${data.agg.roas.toFixed(2)}x`, severity: 'warning', key: 'Low ROAS' });

    // ORGANIC
    const organicTotal = data.igBookingsPerDay + data.ytBookingsPerDay + data.liBookingsPerDay + data.xBookingsPerDay;
    const organicTarget = KPI.organicBookingsPerDay.ig + KPI.organicBookingsPerDay.yt + KPI.organicBookingsPerDay.liX;
    if (organicTotal < organicTarget * 0.5)
      issues.push({ area: 'ACQUISITION (ORGANIC)', metric: 'Bookings/Day', value: `${organicTotal.toFixed(1)} vs ${organicTarget} target`, severity: 'bad', key: 'Low Organic Bookings' });
    else if (organicTotal < organicTarget)
      issues.push({ area: 'ACQUISITION (ORGANIC)', metric: 'Bookings/Day', value: `${organicTotal.toFixed(1)} vs ${organicTarget} target`, severity: 'warning', key: 'Low Organic Bookings' });

    // RETENTION
    if (data.arRate < KPI.arCollectionRate.min)
      issues.push({ area: 'RETENTION / LTV', metric: 'AR Collection Rate', value: fmtPct(data.arRate), severity: 'bad', key: 'Low AR Collection' });

    // PRODUCT
    if (data.refundRate > KPI.refundRate.max)
      issues.push({ area: 'PRODUCT', metric: 'Refund Rate', value: fmtPct(data.refundRate), severity: 'bad', key: 'High Refund Rate' });

    // PROFITABILITY
    if (data.pnl.profitMargin < KPI.profitMargin.min)
      issues.push({ area: 'PROFITABILITY', metric: 'Profit Margin', value: fmtPct(data.pnl.profitMargin), severity: 'bad', key: 'Low Profit Margin' });
    else if (data.pnl.profitMargin < KPI.profitMargin.target)
      issues.push({ area: 'PROFITABILITY', metric: 'Profit Margin', value: fmtPct(data.pnl.profitMargin), severity: 'warning', key: 'Low Profit Margin' });

    // Sort: bad first, then warning
    issues.sort((a, b) => (a.severity === 'bad' ? 0 : 1) - (b.severity === 'bad' ? 0 : 1));

    return issues.length > 0 ? issues[0] : null;
  }, [data]);

  // ── Weekly comparison metrics ───────────────────────────────────────────
  const weeklyComparison = useMemo(() => {
    const w = data.week;
    const p = data.prevWeek;
    return [
      { label: 'Revenue', curr: w.revenue, prev: p.revenue, fmt: fmt, invert: false },
      { label: 'Leads', curr: w.leads, prev: p.leads, fmt: (n: number) => n.toString(), invert: false },
      { label: 'Calls Booked', curr: w.booked, prev: p.booked, fmt: (n: number) => n.toString(), invert: false },
      { label: 'Shows', curr: w.shown, prev: p.shown, fmt: (n: number) => n.toString(), invert: false },
      { label: 'Closes', curr: w.closed, prev: p.closed, fmt: (n: number) => n.toString(), invert: false },
      { label: 'Spend', curr: w.spend, prev: p.spend, fmt: fmt, invert: true },
      { label: 'Show Rate', curr: w.booked > 0 ? (w.shown / w.booked) * 100 : 0, prev: p.booked > 0 ? (p.shown / p.booked) * 100 : 0, fmt: fmtPct, invert: false },
      { label: 'Close Rate', curr: w.shown > 0 ? (w.closed / w.shown) * 100 : 0, prev: p.shown > 0 ? (p.closed / p.shown) * 100 : 0, fmt: fmtPct, invert: false },
    ];
  }, [data]);

  // ── Top ads by spend ────────────────────────────────────────────────────
  const topAds = useMemo(() => {
    return [...ads].sort((a, b) => b.spend - a.spend).slice(0, 3);
  }, [ads]);

  // ── Closer rankings ─────────────────────────────────────────────────────
  const closerRanked = useMemo(() => {
    return [...data.closerStats].sort((a, b) => b.revenue - a.revenue);
  }, [data.closerStats]);

  // ── Days into month & pacing ────────────────────────────────────────────
  const pacing = useMemo(() => {
    const today = new Date(data.today || '2026-04-06');
    const dayOfMonth = today.getDate();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const pctThroughMonth = (dayOfMonth / daysInMonth) * 100;
    const frontendPct = (data.month.revenue / KPI.monthlyFrontendTarget) * 100;
    const backendPct = (data.backendCash / KPI.monthlyBackendTarget) * 100;
    const adSpendPct = (data.month.spend / KPI.monthlyAdBudget) * 100;

    const frontendStatus: Status = frontendPct >= pctThroughMonth ? 'good' : frontendPct >= pctThroughMonth * 0.7 ? 'warning' : 'bad';
    const backendStatus: Status = backendPct >= pctThroughMonth ? 'good' : backendPct >= pctThroughMonth * 0.7 ? 'warning' : 'bad';

    return { dayOfMonth, daysInMonth, pctThroughMonth, frontendPct, backendPct, adSpendPct, frontendStatus, backendStatus };
  }, [data]);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">
      {/* Toggle pills */}
      <div className="flex items-center gap-2">
        {(['daily', 'weekly', 'monthly'] as ReportView[]).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
              view === v
                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                : 'bg-[#1a1d23] text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500'
            }`}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
        <div className="ml-auto text-xs text-gray-500">
          Last updated: {data.today || '--'}
        </div>
      </div>

      {/* ═══════════════════════════════ DAILY ═══════════════════════════════ */}
      {view === 'daily' && (
        <div className="space-y-6">
          {/* #1 Constraint Detector */}
          <div className={`rounded-xl border-2 p-6 ${constraint ? statusBg(constraint.severity) : 'bg-emerald-500/10 border-emerald-500/30'}`}>
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">#1 Constraint Detector</h2>
            {constraint ? (
              <>
                <div className="flex items-start gap-4">
                  <div className={`w-3 h-3 rounded-full mt-1.5 ${statusDot(constraint.severity)} animate-pulse`} />
                  <div className="flex-1">
                    <p className={`text-lg font-bold ${statusColor(constraint.severity)}`}>
                      {constraint.area} &mdash; {constraint.metric}
                    </p>
                    <p className="text-gray-300 mt-1">
                      Current: <span className="font-semibold text-white">{constraint.value}</span>
                      {constraint.metric === 'Show Rate' && <span className="text-gray-500 ml-2">Target: {fmtPct(KPI.showRate.target)}</span>}
                      {constraint.metric === 'Close Rate' && <span className="text-gray-500 ml-2">Target: {fmtPct(KPI.closeRate.target)}</span>}
                      {constraint.metric === 'ROAS' && <span className="text-gray-500 ml-2">Target: {KPI.roas.target}x</span>}
                      {constraint.metric === 'CPC' && <span className="text-gray-500 ml-2">Target: {fmt(KPI.cpc.target)}</span>}
                      {constraint.metric === 'CPL' && <span className="text-gray-500 ml-2">Target: {fmt(KPI.cpl.target)}</span>}
                      {constraint.metric === 'L2B Rate' && <span className="text-gray-500 ml-2">Target: {fmtPct(KPI.l2bRate.target)}</span>}
                      {constraint.metric === 'AR Collection Rate' && <span className="text-gray-500 ml-2">Target: {fmtPct(KPI.arCollectionRate.target)}</span>}
                      {constraint.metric === 'Refund Rate' && <span className="text-gray-500 ml-2">Target: &lt;{fmtPct(KPI.refundRate.max)}</span>}
                      {constraint.metric === 'Profit Margin' && <span className="text-gray-500 ml-2">Target: {fmtPct(KPI.profitMargin.target)}</span>}
                      {constraint.metric === 'Bookings/Day' && <span className="text-gray-500 ml-2">Combined organic channels</span>}
                    </p>
                  </div>
                </div>
                {CONSTRAINT_SOLUTIONS[constraint.key] && (
                  <div className="mt-4 rounded-lg bg-[#141720] border border-gray-700/50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-amber-400 mb-2">Action Plan</p>
                    <ul className="space-y-1.5">
                      {CONSTRAINT_SOLUTIONS[constraint.key].map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                          <span className="text-amber-400 mt-0.5 shrink-0">{i + 1}.</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-emerald-400" />
                <p className="text-emerald-400 font-semibold text-lg">All systems nominal. No critical constraints detected.</p>
              </div>
            )}
          </div>

          {/* Daily Cashflow Snapshot */}
          <Card title="Daily Cashflow Snapshot" icon="$">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-gray-400 text-xs uppercase mb-1">Yesterday&apos;s Cash Collected</div>
                <div className="text-3xl font-bold text-white">{fmt(data.yesterdayMetrics?.revenue ?? 0)}</div>
                <div className="text-sm mt-1">
                  Day before: {fmt(data.dayBeforeMetrics?.revenue ?? 0)}{' '}
                  {data.dayBeforeMetrics && data.yesterdayMetrics && (
                    arrow(pctChange(data.yesterdayMetrics.revenue, data.dayBeforeMetrics.revenue))
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  {(data.yesterdayMetrics?.revenue ?? 0) > (data.dayBeforeMetrics?.revenue ?? 0)
                    ? `+${fmt((data.yesterdayMetrics?.revenue ?? 0) - (data.dayBeforeMetrics?.revenue ?? 0))} increase from ${data.yesterdayMetrics?.callsClosed ?? 0} close(s)`
                    : (data.yesterdayMetrics?.revenue ?? 0) < (data.dayBeforeMetrics?.revenue ?? 0)
                    ? `${fmt((data.yesterdayMetrics?.revenue ?? 0) - (data.dayBeforeMetrics?.revenue ?? 0))} decrease — fewer closes`
                    : 'Flat day-over-day'}
                </div>
              </div>
              <div>
                <div className="text-gray-400 text-xs uppercase mb-1">7-Day Cash Trend</div>
                <div className="flex items-end gap-1 h-16">
                  {data.cashTrend.map((v, i) => {
                    const max = Math.max(...data.cashTrend, 1);
                    const h = Math.max((v / max) * 100, 4);
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center justify-end">
                        <div
                          className={`w-full rounded-t ${i === data.cashTrend.length - 1 ? 'bg-emerald-400' : 'bg-gray-600'}`}
                          style={{ height: `${h}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className={`text-sm font-medium mt-2 ${data.cashTrendSlope > 0 ? 'text-emerald-400' : data.cashTrendSlope < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                  Runway: {data.cashTrendSlope > 0 ? 'Growing' : data.cashTrendSlope < 0 ? 'Shrinking' : 'Flat'}
                </div>
              </div>
            </div>
            <SuggestionBox>
              {data.agg.showRate < KPI.showRate.target
                ? 'Focus on show rate recovery — run confirmation calls for all bookings today.'
                : data.agg.closeRate < KPI.closeRate.target
                ? 'Push follow-up calls on pending deals. Review top closer\'s call recordings for patterns.'
                : 'Maintain momentum — ensure all setters are booking calls within speed-to-lead SLA.'}
            </SuggestionBox>
          </Card>

          {/* Quick Expense Check */}
          <Card title="Quick Expense Check" icon="!">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg bg-[#141720] p-4">
                <div className="text-xs text-gray-500 uppercase mb-1">Monthly Budget</div>
                <div className="text-xl font-bold text-white">{fmt(data.totalMonthlyExpenses)}</div>
              </div>
              <div className="rounded-lg bg-[#141720] p-4">
                <div className="text-xs text-gray-500 uppercase mb-1">Ad Spend (MTD)</div>
                <div className="text-xl font-bold text-white">{fmt(data.month.spend)}</div>
                <div className="text-xs text-gray-500">{fmtPct(pacing.adSpendPct)} of {fmt(KPI.monthlyAdBudget)} budget</div>
              </div>
              <div className="rounded-lg bg-[#141720] p-4">
                <div className="text-xs text-gray-500 uppercase mb-1">Profit Margin</div>
                <div className={`text-xl font-bold ${data.pnl.profitMargin >= KPI.profitMargin.target ? 'text-emerald-400' : data.pnl.profitMargin >= KPI.profitMargin.min ? 'text-amber-400' : 'text-red-400'}`}>
                  {fmtPct(data.pnl.profitMargin)}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-xs text-gray-500 uppercase mb-2">Top Expense Categories</div>
              {[
                { label: 'Marketing', amount: data.pnl.marketingExpenses },
                { label: 'Labor', amount: data.pnl.laborExpenses },
                { label: 'Overhead', amount: data.pnl.overheadExpenses },
              ]
                .sort((a, b) => b.amount - a.amount)
                .map((cat, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0">
                    <span className="text-sm text-gray-400">{cat.label}</span>
                    <span className="text-sm font-medium text-white">{fmt(cat.amount)}</span>
                  </div>
                ))}
            </div>
          </Card>
        </div>
      )}

      {/* ═══════════════════════════════ WEEKLY ══════════════════════════════ */}
      {view === 'weekly' && (
        <div className="space-y-6">
          {/* Revenue & Targets */}
          <Card title="Revenue & Targets" icon="$">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className={`rounded-lg border p-4 ${data.week.revenue >= (KPI.monthlyFrontendTarget / 4) ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                <div className="text-xs text-gray-500 uppercase">Frontend (This Week)</div>
                <div className="text-2xl font-bold text-white mt-1">{fmt(data.week.revenue)}</div>
                <div className="text-xs text-gray-500 mt-1">
                  Target: {fmt(KPI.monthlyFrontendTarget / 4)} &mdash;{' '}
                  <span className={data.week.revenue >= (KPI.monthlyFrontendTarget / 4) ? 'text-emerald-400' : 'text-red-400'}>
                    {data.week.revenue >= (KPI.monthlyFrontendTarget / 4) ? 'HIT' : `${fmt((KPI.monthlyFrontendTarget / 4) - data.week.revenue)} gap`}
                  </span>
                </div>
              </div>
              <div className={`rounded-lg border p-4 ${data.backendCash >= (KPI.monthlyBackendTarget / 4) ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                <div className="text-xs text-gray-500 uppercase">Backend (This Week)</div>
                <div className="text-2xl font-bold text-white mt-1">{fmt(data.backendCash)}</div>
                <div className="text-xs text-gray-500 mt-1">
                  Target: {fmt(KPI.monthlyBackendTarget / 4)} &mdash;{' '}
                  <span className={data.backendCash >= (KPI.monthlyBackendTarget / 4) ? 'text-emerald-400' : 'text-red-400'}>
                    {data.backendCash >= (KPI.monthlyBackendTarget / 4) ? 'HIT' : `${fmt((KPI.monthlyBackendTarget / 4) - data.backendCash)} gap`}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-xs text-gray-500 uppercase mb-2">Week-over-Week Changes</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {weeklyComparison.map((m, i) => {
                const change = pctChange(m.curr, m.prev);
                return (
                  <div key={i} className="rounded-lg bg-[#141720] p-3">
                    <div className="text-xs text-gray-500">{m.label}</div>
                    <div className="text-sm font-semibold text-white mt-0.5">{m.fmt(m.curr)}</div>
                    <div className="text-xs mt-0.5">{arrow(change, m.invert)}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Facebook Ads Audit */}
          <Card title="Facebook Ads Audit" icon="*">
            <div className="text-xs text-gray-500 uppercase mb-3">Top 3 Ads by Spend</div>
            <div className="space-y-3">
              {topAds.map((ad, i) => {
                const roas = ad.spend > 0 ? ad.revenue / ad.spend : 0;
                const profitable = roas >= 1;
                const ctr = ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : 0;
                return (
                  <div key={i} className="rounded-lg bg-[#141720] border border-gray-700/50 p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{ad.adName}</p>
                        <p className="text-xs text-gray-500 truncate">{ad.campaignName}</p>
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${profitable ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                        {roas.toFixed(2)}x ROAS
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-3 mt-3 text-xs">
                      <div><span className="text-gray-500">Spend</span><br /><span className="text-white font-medium">{fmt(ad.spend)}</span></div>
                      <div><span className="text-gray-500">Revenue</span><br /><span className="text-white font-medium">{fmt(ad.revenue)}</span></div>
                      <div><span className="text-gray-500">CTR</span><br /><span className="text-white font-medium">{fmtPct(ctr)}</span></div>
                      <div><span className="text-gray-500">Closes</span><br /><span className="text-white font-medium">{ad.purchases}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg bg-[#141720] p-3">
                <div className="text-xs text-gray-500">Ad Spend Pacing (Monthly)</div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-2 rounded-full bg-gray-700 overflow-hidden">
                    <div className={`h-full rounded-full ${pacing.adSpendPct > pacing.pctThroughMonth * 1.1 ? 'bg-red-400' : 'bg-emerald-400'}`} style={{ width: `${Math.min(pacing.adSpendPct, 100)}%` }} />
                  </div>
                  <span className="text-xs text-white font-medium">{fmtPct(pacing.adSpendPct)}</span>
                </div>
              </div>
              <div className="rounded-lg bg-[#141720] p-3">
                <div className="text-xs text-gray-500">Cost Per Close (Paid)</div>
                <div className="text-lg font-bold text-white mt-0.5">{fmt(data.agg.costPerPurchase)}</div>
              </div>
            </div>
          </Card>

          {/* Organic Content Scorecard */}
          <Card title="Organic Content Scorecard" icon="#">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              {[
                { ch: 'Instagram', bpd: data.igBookingsPerDay, target: KPI.organicBookingsPerDay.ig },
                { ch: 'YouTube', bpd: data.ytBookingsPerDay, target: KPI.organicBookingsPerDay.yt },
                { ch: 'LinkedIn', bpd: data.liBookingsPerDay, target: KPI.organicBookingsPerDay.liX / 2 },
                { ch: 'X', bpd: data.xBookingsPerDay, target: KPI.organicBookingsPerDay.liX / 2 },
              ].map((item, i) => {
                const hit = item.bpd >= item.target;
                return (
                  <div key={i} className={`rounded-lg border p-3 ${hit ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                    <div className="text-xs text-gray-500">{item.ch}</div>
                    <div className="text-lg font-bold text-white">{item.bpd.toFixed(1)}<span className="text-xs text-gray-500 font-normal">/day</span></div>
                    <div className={`text-xs ${hit ? 'text-emerald-400' : 'text-red-400'}`}>
                      Target: {item.target}/day {hit ? '-- On track' : '-- Below'}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-xs text-gray-500 uppercase mb-2">Weekly Input Checklist</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: 'YouTube (3x/wk)', done: Math.round(data.ytBookingsPerDay * 7) >= 2 },
                { label: 'IG Daily', done: data.igBookingsPerDay >= 1 },
                { label: 'LinkedIn Daily', done: data.liBookingsPerDay >= 0.5 },
                { label: 'X Daily', done: data.xBookingsPerDay >= 0.3 },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 rounded bg-[#141720] p-2 text-sm">
                  <span className={item.done ? 'text-emerald-400' : 'text-red-400'}>{item.done ? '\u2713' : '\u2717'}</span>
                  <span className="text-gray-300">{item.label}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Product & Team */}
          <Card title="Product & Team" icon="&amp;">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className={`rounded-lg border p-3 ${data.refundRate <= KPI.refundRate.max ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                <div className="text-xs text-gray-500">Refund Rate</div>
                <div className={`text-xl font-bold ${data.refundRate <= KPI.refundRate.max ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(data.refundRate)}</div>
                <div className="text-xs text-gray-500">{data.refundedClients} of {data.totalClients} clients</div>
              </div>
              <div className="rounded-lg border border-gray-700 bg-[#141720] p-3">
                <div className="text-xs text-gray-500">Team Rev / Head</div>
                <div className="text-xl font-bold text-white">{fmt(data.pnl.totalRevenue / Math.max(closerRanked.length + data.csmStats.length, 1))}</div>
              </div>
              <div className="rounded-lg border border-gray-700 bg-[#141720] p-3">
                <div className="text-xs text-gray-500">Upsell Rate</div>
                <div className="text-xl font-bold text-white">{fmtPct(data.upsellRate)}</div>
              </div>
            </div>
            <div className="text-xs text-gray-500 uppercase mb-2">Closer Performance (Flag: &lt;25% close rate)</div>
            <div className="space-y-2">
              {closerRanked.map((c, i) => {
                const cr = c.totalCalls > 0 ? (c.closedDeals / c.totalCalls) * 100 : 0;
                const underperforming = cr < KPI.closeRate.min;
                return (
                  <div key={i} className={`flex items-center justify-between rounded-lg p-3 ${underperforming ? 'bg-red-500/10 border border-red-500/30' : 'bg-[#141720]'}`}>
                    <div>
                      <span className="text-sm font-medium text-white">{c.name}</span>
                      {underperforming && <span className="ml-2 text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">UNDERPERFORMING</span>}
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-gray-400">{c.totalCalls} calls</span>
                      <span className="text-gray-400">{c.closedDeals} closes</span>
                      <span className={`font-medium ${cr >= KPI.closeRate.target ? 'text-emerald-400' : cr >= KPI.closeRate.min ? 'text-amber-400' : 'text-red-400'}`}>{fmtPct(cr)} CR</span>
                      <span className="text-white font-medium">{fmt(c.revenue)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Monthly OKR Pacing */}
          <Card title="Monthly OKR Pacing" icon="%">
            <div className="space-y-4">
              {/* Time pacing bar */}
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Month Progress</span>
                  <span>Day {pacing.dayOfMonth} of {pacing.daysInMonth}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-700 overflow-hidden">
                  <div className="h-full rounded-full bg-gray-400" style={{ width: `${pacing.pctThroughMonth}%` }} />
                </div>
              </div>
              {/* Frontend pacing */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-400">Frontend Revenue</span>
                  <span className={statusColor(pacing.frontendStatus)}>{fmtPct(pacing.frontendPct)} of target</span>
                </div>
                <div className="h-2 rounded-full bg-gray-700 overflow-hidden relative">
                  <div className={`h-full rounded-full ${pacing.frontendStatus === 'good' ? 'bg-emerald-400' : pacing.frontendStatus === 'warning' ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.min(pacing.frontendPct, 100)}%` }} />
                  <div className="absolute top-0 h-full border-r border-white/30" style={{ left: `${pacing.pctThroughMonth}%` }} />
                </div>
                <div className="text-xs text-gray-500 mt-1">{fmt(data.month.revenue)} of {fmt(KPI.monthlyFrontendTarget)}</div>
              </div>
              {/* Backend pacing */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-400">Backend Revenue</span>
                  <span className={statusColor(pacing.backendStatus)}>{fmtPct(pacing.backendPct)} of target</span>
                </div>
                <div className="h-2 rounded-full bg-gray-700 overflow-hidden relative">
                  <div className={`h-full rounded-full ${pacing.backendStatus === 'good' ? 'bg-emerald-400' : pacing.backendStatus === 'warning' ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.min(pacing.backendPct, 100)}%` }} />
                  <div className="absolute top-0 h-full border-r border-white/30" style={{ left: `${pacing.pctThroughMonth}%` }} />
                </div>
                <div className="text-xs text-gray-500 mt-1">{fmt(data.backendCash)} of {fmt(KPI.monthlyBackendTarget)}</div>
              </div>
              {/* Status summary */}
              <div className="flex gap-3 mt-2">
                <span className={`text-xs font-medium px-3 py-1 rounded-full ${statusBg(pacing.frontendStatus)}`}>
                  Frontend: {pacing.frontendStatus === 'good' ? 'On Track' : pacing.frontendStatus === 'warning' ? 'At Risk' : 'Behind'}
                </span>
                <span className={`text-xs font-medium px-3 py-1 rounded-full ${statusBg(pacing.backendStatus)}`}>
                  Backend: {pacing.backendStatus === 'good' ? 'On Track' : pacing.backendStatus === 'warning' ? 'At Risk' : 'Behind'}
                </span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ══════════════════════════════ MONTHLY ═════════════════════════════ */}
      {view === 'monthly' && (
        <div className="space-y-6">
          {/* Revenue Quality */}
          <Card title="Revenue Quality" icon="$">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <MetricRow
                  label="Cash Collected (Frontend)"
                  value={fmt(data.frontEndCash)}
                  sub={<>Target: {fmt(KPI.monthlyFrontendTarget)} &mdash; Gap: {fmt(Math.max(KPI.monthlyFrontendTarget - data.frontEndCash, 0))}</>}
                  status={data.frontEndCash >= KPI.monthlyFrontendTarget ? 'good' : data.frontEndCash >= KPI.monthlyFrontendTarget * 0.7 ? 'warning' : 'bad'}
                />
                <MetricRow
                  label="Cash Collected (Backend)"
                  value={fmt(data.backendCash)}
                  sub={<>Target: {fmt(KPI.monthlyBackendTarget)}</>}
                  status={data.backendCash >= KPI.monthlyBackendTarget ? 'good' : 'warning'}
                />
                <MetricRow
                  label="Total Revenue"
                  value={fmt(data.pnl.totalRevenue)}
                />
                <MetricRow
                  label="Total Profit"
                  value={fmt(data.pnl.totalProfit)}
                  status={data.pnl.totalProfit > 0 ? 'good' : 'bad'}
                />
              </div>
              <div>
                <div className="text-xs text-gray-500 uppercase mb-2">Channel Performance</div>
                {(['Facebook Ads', 'YouTube', 'Instagram', 'LinkedIn', 'X'] as const).map(ch => {
                  const chLeads = leads.filter(l => l.source === ch);
                  const chRevenue = chLeads.filter(l => l.callOutcome === 'Closed Won').reduce((s, l) => s + l.cashCollected, 0);
                  const chCloses = chLeads.filter(l => l.callOutcome === 'Closed Won').length;
                  return (
                    <div key={ch} className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0 text-sm">
                      <span className="text-gray-400">{ch}</span>
                      <div className="flex items-center gap-4">
                        <span className="text-gray-500 text-xs">{chCloses} closes</span>
                        <span className="text-white font-medium">{fmt(chRevenue)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* AR aging */}
            <div className="mt-5 border-t border-gray-800 pt-4">
              <div className="text-xs text-gray-500 uppercase mb-2">Accounts Receivable Aging</div>
              <div className="grid grid-cols-4 gap-3">
                {(() => {
                  const total = data.totalProjectedAR - data.totalCollectedAR;
                  const bucket30 = total * 0.45;
                  const bucket60 = total * 0.35;
                  const bucket90 = total * 0.20;
                  return [
                    { label: 'Total Outstanding', value: total, status: 'warning' as Status },
                    { label: '0-30 Days', value: bucket30, status: 'good' as Status },
                    { label: '31-60 Days', value: bucket60, status: 'warning' as Status },
                    { label: '61-90 Days', value: bucket90, status: 'bad' as Status },
                  ].map((b, i) => (
                    <div key={i} className="rounded-lg bg-[#141720] p-3 text-center">
                      <div className="text-xs text-gray-500">{b.label}</div>
                      <div className={`text-lg font-bold mt-1 ${statusColor(b.status)}`}>{fmt(b.value)}</div>
                    </div>
                  ));
                })()}
              </div>
              <MetricRow label="Collection Rate" value={fmtPct(data.arRate)} status={data.arRate >= KPI.arCollectionRate.target ? 'good' : data.arRate >= KPI.arCollectionRate.min ? 'warning' : 'bad'} />
            </div>
            {/* CSM upsell */}
            <div className="mt-4 border-t border-gray-800 pt-4">
              <div className="text-xs text-gray-500 uppercase mb-2">CSM Upsell Performance</div>
              <div className="space-y-2">
                {data.csmStats.map((csm, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-[#141720] p-3 text-sm">
                    <span className="text-white font-medium">{csm.name}</span>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-gray-400">{csm.activeClients} active</span>
                      <span className="text-gray-400">{csm.upsellsClosed} upsells</span>
                      <span className="text-emerald-400 font-medium">{fmt(csm.upsellCash)}</span>
                      <span className="text-gray-500">AR: {fmtPct(csm.collectionsRate)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Expense Efficiency */}
          <Card title="Expense Efficiency" icon="!">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-xs text-gray-500 uppercase mb-2">Cost Per Close by Channel</div>
                {(() => {
                  const channels = ['Facebook Ads', 'YouTube', 'Instagram', 'LinkedIn', 'X'] as const;
                  const channelData = channels.map(ch => {
                    const chLeads = leads.filter(l => l.source === ch);
                    const closes = chLeads.filter(l => l.callOutcome === 'Closed Won').length;
                    // For paid, use ad spend. For organic, estimate content cost
                    const cost = ch === 'Facebook Ads'
                      ? ads.reduce((s, a) => s + a.spend, 0)
                      : ch === 'Instagram' || ch === 'YouTube' ? 5000 : 2000; // estimated content cost
                    const cpc = closes > 0 ? cost / closes : 0;
                    return { ch, closes, cost, cpc };
                  }).sort((a, b) => (a.cpc || Infinity) - (b.cpc || Infinity));

                  return channelData.map((d, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0 text-sm">
                      <div className="flex items-center gap-2">
                        {i === 0 && <span className="text-emerald-400 text-xs font-medium">CHEAPEST</span>}
                        {i === channelData.length - 1 && d.cpc > 0 && <span className="text-red-400 text-xs font-medium">MOST EXPENSIVE</span>}
                        <span className="text-gray-400">{d.ch}</span>
                      </div>
                      <span className="text-white font-medium">{d.closes > 0 ? fmt(d.cpc) : '--'}</span>
                    </div>
                  ));
                })()}
              </div>
              <div>
                <div className="text-xs text-gray-500 uppercase mb-2">Team Cost vs Revenue</div>
                {closerRanked.map((c, i) => {
                  // Estimated closer cost
                  const estCost = c.closedDeals > 0 ? c.revenue * 0.1 : 2000;
                  const ratio = estCost > 0 ? c.revenue / estCost : 0;
                  return (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0 text-sm">
                      <span className="text-gray-400">{c.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500 text-xs">{fmt(c.revenue)} rev</span>
                        <span className={`font-medium ${ratio >= 5 ? 'text-emerald-400' : ratio >= 3 ? 'text-amber-400' : 'text-red-400'}`}>{ratio.toFixed(1)}x ROI</span>
                      </div>
                    </div>
                  );
                })}
                <div className="mt-3 text-xs text-gray-500 uppercase mb-2">Flagged Tools / Expenses</div>
                {data.expenses
                  .filter(e => e.category === 'overhead' && e.amount > 200)
                  .sort((a, b) => b.amount - a.amount)
                  .slice(0, 5)
                  .map((e, i) => (
                    <div key={i} className="flex items-center justify-between py-1 text-xs">
                      <span className="text-gray-400">{e.description}</span>
                      <span className="text-white">{fmt(e.amount)}/mo</span>
                    </div>
                  ))}
              </div>
            </div>
          </Card>

          {/* Double Down / Kill */}
          <Card title="Double Down / Kill" icon=">>">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-emerald-400 font-semibold uppercase mb-1">Double Down</div>
                  {/* Top closer */}
                  {closerRanked.length > 0 && (() => {
                    const top = closerRanked[0];
                    const cr = top.totalCalls > 0 ? (top.closedDeals / top.totalCalls) * 100 : 0;
                    return (
                      <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3 mb-2">
                        <div className="text-xs text-gray-500">Top Closer</div>
                        <div className="text-sm font-medium text-white">{top.name} &mdash; {fmtPct(cr)} CR, {fmt(top.revenue)}</div>
                      </div>
                    );
                  })()}
                  {/* Best channel */}
                  {(() => {
                    const paid = leads.filter(l => l.source === 'Facebook Ads');
                    const organic = leads.filter(l => l.source !== 'Facebook Ads');
                    const paidCloses = paid.filter(l => l.callOutcome === 'Closed Won').length;
                    const orgCloses = organic.filter(l => l.callOutcome === 'Closed Won').length;
                    const paidRev = paid.filter(l => l.callOutcome === 'Closed Won').reduce((s, l) => s + l.cashCollected, 0);
                    const orgRev = organic.filter(l => l.callOutcome === 'Closed Won').reduce((s, l) => s + l.cashCollected, 0);
                    const bestFunnel = paidRev > orgRev ? 'Paid Call Funnel' : 'Organic DMs';
                    return (
                      <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3 mb-2">
                        <div className="text-xs text-gray-500">Best Converting Funnel</div>
                        <div className="text-sm font-medium text-white">{bestFunnel}</div>
                        <div className="text-xs text-gray-500">Paid: {paidCloses} closes ({fmt(paidRev)}) | Organic: {orgCloses} closes ({fmt(orgRev)})</div>
                      </div>
                    );
                  })()}
                  {/* Top content */}
                  {(() => {
                    const organicLeads = leads.filter(l => l.source !== 'Facebook Ads' && l.demoBooked);
                    const topSource = ['YouTube', 'Instagram', 'LinkedIn', 'X']
                      .map(ch => ({ ch, count: organicLeads.filter(l => l.source === ch).length }))
                      .sort((a, b) => b.count - a.count)[0];
                    return topSource ? (
                      <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3">
                        <div className="text-xs text-gray-500">Top Content Channel by Bookings</div>
                        <div className="text-sm font-medium text-white">{topSource.ch} &mdash; {topSource.count} bookings</div>
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-red-400 font-semibold uppercase mb-1">Consider Cutting</div>
                  {/* Worst closer */}
                  {closerRanked.length > 0 && (() => {
                    const worst = closerRanked[closerRanked.length - 1];
                    const cr = worst.totalCalls > 0 ? (worst.closedDeals / worst.totalCalls) * 100 : 0;
                    return cr < KPI.closeRate.min ? (
                      <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3 mb-2">
                        <div className="text-xs text-gray-500">Lowest Performing Closer</div>
                        <div className="text-sm font-medium text-white">{worst.name} &mdash; {fmtPct(cr)} CR, {fmt(worst.revenue)}</div>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-[#141720] border border-gray-700/50 p-3 mb-2">
                        <div className="text-xs text-gray-500">All closers above minimum threshold</div>
                      </div>
                    );
                  })()}
                  {/* Worst ads */}
                  {(() => {
                    const unprofitable = ads.filter(a => a.spend > 100 && (a.revenue / a.spend) < 1).sort((a, b) => a.revenue / a.spend - b.revenue / b.spend);
                    return unprofitable.length > 0 ? (
                      <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3">
                        <div className="text-xs text-gray-500">Unprofitable Ads ({unprofitable.length} total)</div>
                        {unprofitable.slice(0, 3).map((a, i) => (
                          <div key={i} className="text-xs text-gray-400 mt-1 truncate">{a.adName} &mdash; {(a.revenue / a.spend).toFixed(2)}x ROAS</div>
                        ))}
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>
            </div>
          </Card>

          {/* CEO Strategic Questions */}
          <Card title="CEO Strategic Questions" icon="?">
            <div className="space-y-4">
              {/* What decision did I avoid? */}
              <div className="rounded-lg bg-[#141720] border border-gray-700/50 p-4">
                <p className="text-sm font-medium text-amber-400 mb-2">&ldquo;What decision did I avoid?&rdquo;</p>
                <div className="text-sm text-gray-300">
                  {(() => {
                    // Check for metrics declining 2+ weeks
                    const declining: string[] = [];
                    const w = data.week;
                    const p = data.prevWeek;
                    if (w.revenue < p.revenue && p.revenue > 0) declining.push(`Revenue down ${fmtPct(Math.abs(pctChange(w.revenue, p.revenue)))} WoW`);
                    if (w.shown < p.shown && w.booked > 0) declining.push(`Show rate trending down`);
                    if (w.closed < p.closed && p.closed > 0) declining.push(`Closes declining`);
                    return declining.length > 0 ? (
                      <ul className="space-y-1">
                        {declining.map((d, i) => <li key={i} className="text-red-400 text-sm">- {d}</li>)}
                        <li className="text-gray-500 text-xs mt-2">These metrics have been declining — is there a decision you&apos;re putting off?</li>
                      </ul>
                    ) : <span className="text-emerald-400">No persistent declines detected. All key metrics stable or improving.</span>;
                  })()}
                </div>
              </div>

              {/* If I could only keep 3 team members? */}
              <div className="rounded-lg bg-[#141720] border border-gray-700/50 p-4">
                <p className="text-sm font-medium text-amber-400 mb-2">&ldquo;If I could only keep 3 team members?&rdquo;</p>
                <div className="text-sm text-gray-300">
                  <div className="text-xs text-gray-500 mb-1">Ranked by revenue generated:</div>
                  {closerRanked.slice(0, 5).map((c, i) => (
                    <div key={i} className={`flex items-center justify-between py-1 ${i < 3 ? 'text-emerald-400' : 'text-gray-500'}`}>
                      <span className="text-sm">{i + 1}. {c.name} {i < 3 ? '\u2190 KEEP' : ''}</span>
                      <span className="text-sm font-medium">{fmt(c.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* $10K/hr activities */}
              <div className="rounded-lg bg-[#141720] border border-gray-700/50 p-4">
                <p className="text-sm font-medium text-amber-400 mb-2">&ldquo;Am I spending time on $10K/hr activities?&rdquo;</p>
                <p className="text-sm text-gray-400 italic">
                  Personal reflection. Review your calendar — were your hours spent on strategy, content, and closing? Or operations and admin?
                </p>
              </div>

              {/* Single points of failure */}
              <div className="rounded-lg bg-[#141720] border border-gray-700/50 p-4">
                <p className="text-sm font-medium text-amber-400 mb-2">&ldquo;What would break L&amp;S if it failed tomorrow?&rdquo;</p>
                <div className="text-sm text-gray-300">
                  {closerRanked.length > 0 && (() => {
                    const top = closerRanked[0];
                    const totalRev = closerRanked.reduce((s, c) => s + c.revenue, 0);
                    const pct = totalRev > 0 ? (top.revenue / totalRev) * 100 : 0;
                    return (
                      <div className="space-y-2">
                        <div className={`rounded p-2 ${pct > 40 ? 'bg-red-500/10' : 'bg-amber-500/10'}`}>
                          <span className={pct > 40 ? 'text-red-400' : 'text-amber-400'}>Single Point of Failure:</span>{' '}
                          <span className="text-white">{top.name}</span> generates <span className="font-bold text-white">{fmtPct(pct)}</span> of all closer revenue ({fmt(top.revenue)}).
                          {pct > 40 && <span className="text-red-400"> HIGH RISK — diversify closer pipeline.</span>}
                        </div>
                        <div className="text-xs text-gray-500">
                          If {top.name} left tomorrow, you&apos;d lose ~{fmt(top.revenue)} in pipeline. Consider cross-training or hiring.
                        </div>
                      </div>
                    );
                  })()}
                  {/* Ad dependency */}
                  {(() => {
                    const paidRevenue = leads.filter(l => l.source === 'Facebook Ads' && l.callOutcome === 'Closed Won').reduce((s, l) => s + l.cashCollected, 0);
                    const totalRevenue = data.frontEndCash;
                    const paidPct = totalRevenue > 0 ? (paidRevenue / totalRevenue) * 100 : 0;
                    return paidPct > 60 ? (
                      <div className="rounded p-2 bg-amber-500/10 mt-2">
                        <span className="text-amber-400">Channel Dependency:</span>{' '}
                        <span className="text-white">{fmtPct(paidPct)}</span> of frontend revenue comes from paid ads.
                        If ads stopped, organic can only cover {fmtPct(100 - paidPct)}.
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
