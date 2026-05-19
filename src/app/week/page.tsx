'use client';

/**
 * /week — Weekly CEO Review
 *
 * Built per the operator's 2026-04-30 finalized checklist ("Program B —
 * Weekly Data Brain"). Section order mirrors his exact checklist:
 *
 *   1. Income          — cash + AR vs targets, constraint identification
 *   2. Expenses        — total + per-category vs targets, biggest overspend
 *   3. Last Week Comp  — direction of red-flag metrics WoW
 *   4. Paid Ads        — SKIPPED (different platform per the spec)
 *   5. Organic         — bookings + $ per platform (YT / IG / LI / X / etc)
 *   6. Sales Team      — show% / close% targets, lowest cash/call closer,
 *                        CSM upsell ≥2 each
 *   7. Qualitative     — LLM-bucketed buy reasons / pain points / desires /
 *                        objections / AI use cases pulled from
 *                        t06.why_they_bought (cached weekly)
 *   8. Strategic       — the operator's 4 specific reflection prompts
 *      Reflection
 *   9. Constraint      — what / why / fix / what am I doing this week
 *
 * Reflection answers persist client-side in localStorage keyed by
 * week-start. Last week's answers shown above each box for accountability.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, ArrowUpRight, TrendingUp, TrendingDown, Minus,
  AlertCircle, CheckCircle2, Trophy, AlertTriangle, RefreshCcw, Quote,
} from 'lucide-react';
import CardShell from '@/components/main/CardShell';

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(0)}%`;
const fmtPct1 = (n: number) => `${n.toFixed(1)}%`;
const fmtNum = (n: number) => n.toLocaleString('en-US');

// ── Response types ────────────────────────────────────────────────────
interface IncomeBuckets {
  newCash: number; ar: number; upsellRenewal: number; mastermind: number;
  refunds: number; uncategorized: number; uncategorizedCount: number;
  gross: number; net: number;
}

interface TeamRow {
  name: string; role: 'closer' | 'csm' | 'setter';
  booked: number; showed: number; closed: number;
  noShows: number; cancelled: number;
  cash: number; contracted: number; upsells: number;
  showRate: number; closeRate: number; cashPerCall: number;
}

interface IncomeCheck {
  cash: number; cashTarget: number; cashVsTarget: number; cashHit: boolean | null;
  ar: number; arTarget: number; arVsTarget: number; arHit: boolean | null;
  constraint: 'cash' | 'ar' | null;
  bothOnTarget: boolean;
}

interface ExpenseCategory {
  category: string; actual: number; weeklyTarget: number;
  overBy: number; overBudget: boolean; pctOfTarget: number | null;
}

interface ExpenseTransaction {
  id: string; date: string;
  vendor: string; amount: number;
  type: string | null;
  card: string | null;
  notes: string | null;
  flag: 'big-ticket' | 'uncategorized' | 'personal' | null;
  flagLabel: string | null;
}

interface ExpenseCheck {
  actual: number; weeklyTarget: number; overBy: number; onTarget: boolean | null;
  biggestOverspendCategory: ExpenseCategory | null;
  categories: ExpenseCategory[];
  transactions: ExpenseTransaction[];
  flaggedCount: number;
  bigTicketThreshold: number;
}

interface ComparisonMetric {
  metric: string;
  hint: 'higherIsBetter' | 'lowerIsBetter';
  current: number; prior: number;
  direction: 'better' | 'worse' | 'same';
  format: 'currency' | 'percent' | 'count';
}

interface OrganicByPlatformRow {
  platform: string;
  bookings: number; bookingsTarget: number; bookingsOnTarget: boolean;
  cash: number; cashPrior: number; cashWoWDelta: number;
  deals: number;
}

interface CSMRow {
  name: string; upsells: number; cash: number; hitTarget: boolean;
}

interface WeekChecklist {
  configured: boolean;
  window: { from: string; to: string };
  priorWindow: { from: string; to: string };
  revenueCheck: {
    target: number;
    thisWeek: IncomeBuckets;
    priorWeek: IncomeBuckets;
    delta: number; netVsTarget: number;
    expenseThis: number; expensePrior: number; weeklyExpenseTarget: number;
    profitThis: number; profitPrior: number; weeklyProfitTarget: number;
    profitDelta: number; profitVsTarget: number;
    refundRatePct: number;
  };
  salesTeam: {
    combinedShowRate: number; combinedCloseRate: number;
    showRateTarget: number; closeRateTarget: number;
    showRateOk: boolean; closeRateOk: boolean;
    rows: TeamRow[];
  };
  incomeCheck: IncomeCheck;
  expenseCheck: ExpenseCheck;
  lastWeekComparison: {
    summary: { better: number; worse: number; same: number };
    metrics: ComparisonMetric[];
  };
  organicByPlatform: OrganicByPlatformRow[];
  csmUpsellCheck: { target: number; rows: CSMRow[]; allHit: boolean };
}

interface ThemeBucket { theme: string; description: string; frequency: number; quotes: string[]; }
interface QualResp {
  configured: boolean;
  window: { from: string; to: string };
  summary: {
    buyReasons: ThemeBucket[];
    painPoints: ThemeBucket[];
    desires: ThemeBucket[];
    objections: ThemeBucket[];
    aiUseCases: ThemeBucket[];
    closedDealsAnalyzed: number;
    totalCallsAnalyzed: number;
    nonClosedCallsAnalyzed: number;
    model: string; generatedAt: string;
  } | null;
  cached?: boolean;
  generatedAt?: string;
  closedDealsAnalyzed?: number;
  totalCallsAnalyzed?: number;
  nonClosedCallsAnalyzed?: number;
  reason?: string;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatRange(from: string, to: string): string {
  const f = new Date(from + 'T12:00:00');
  const t = new Date(to + 'T12:00:00');
  const sameMonth = f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear();
  const fStr = f.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const tStr = sameMonth
    ? t.toLocaleDateString('en-US', { day: 'numeric' })
    : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fStr} – ${tStr}`;
}

function isoNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function fmtMetric(n: number, format: 'currency' | 'percent' | 'count'): string {
  if (format === 'currency') return fmtUSD(n);
  if (format === 'percent') return fmtPct1(n);
  return fmtNum(Math.round(n));
}

// Reflection prompts removed 2026-04-30 — the operator does these in a Google
// Doc, not the dashboard. The localStorage cache is intentionally not
// migrated since prior answers belonged to the old layout.

// ── Component ─────────────────────────────────────────────────────────

export default function WeekPage() {
  const [data, setData] = useState<WeekChecklist | null>(null);
  const [qualData, setQualData] = useState<QualResp | null>(null);
  const [qualLoading, setQualLoading] = useState(false);
  const [qualError, setQualError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowChoice, setWindowChoice] = useState<'this' | 'prior'>('this');

  const query = useMemo(() => {
    if (windowChoice === 'this') return '';
    const to = isoNDaysAgo(8);
    const from = isoNDaysAgo(14);
    return `?from=${from}&to=${to}`;
  }, [windowChoice]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/week/checklist${query}${query ? '&' : '?'}_t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query]);

  // Load qualitative on initial mount + window switch — uses cached
  // result from t91 if available; force-regen via the refresh button.
  useEffect(() => {
    let cancelled = false;
    setQualLoading(true);
    setQualError(null);
    fetch(`/api/week/qualitative${query}${query ? '&' : '?'}_t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: QualResp) => {
        if (cancelled) return;
        if (d.error) setQualError(d.error);
        setQualData(d);
      })
      .catch((e) => { if (!cancelled) setQualError((e as Error).message); })
      .finally(() => { if (!cancelled) setQualLoading(false); });
    return () => { cancelled = true; };
  }, [query]);

  const refreshQualitative = async () => {
    setQualLoading(true);
    setQualError(null);
    try {
      const res = await fetch(`/api/week/qualitative${query}${query ? '&' : '?'}refresh=1&_t=${Date.now()}`, { cache: 'no-store' });
      const d: QualResp = await res.json();
      if (d.error) setQualError(d.error);
      setQualData(d);
    } catch (e) {
      setQualError((e as Error).message);
    } finally {
      setQualLoading(false);
    }
  };

  // the operator 2026-04-30: send the qualitative report to the CMO in
  // #media-buying. Reads the cached summary on the server side.
  const [marketingNotifyState, setMarketingNotifyState] = useState<{ status: 'sending' | 'sent' | 'error'; msg?: string; hint?: string } | null>(null);
  const sendToMarketingManager = async () => {
    if (!data) return;
    setMarketingNotifyState({ status: 'sending' });
    try {
      const res = await fetch('/api/week/notify/marketing-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: data.window.from, to: data.window.to }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        setMarketingNotifyState({ status: 'error', msg: j?.error ?? `HTTP ${res.status}`, hint: j?.hint ?? undefined });
        return;
      }
      setMarketingNotifyState({ status: 'sent' });
      setTimeout(() => setMarketingNotifyState(null), 4000);
    } catch (e) {
      setMarketingNotifyState({ status: 'error', msg: (e as Error).message });
    }
  };

  return (
    <div className="px-6 py-5 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-white font-bold text-2xl tracking-tight">Weekly CEO Review</h1>
          <p className="text-sm text-gray-400 mt-1">
            {data ? `${formatRange(data.window.from, data.window.to)} · ${windowChoice === 'this' ? 'this week' : 'last week'}` : 'Weekly checklist'}
            {' · Weekly Data Brain'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* the operator 2026-04-30: hyperlink to the weekly checklist Google
              Doc — the strategic-reflection prose lives there, not here. */}
          <a
            href="https://docs.google.com/document/d/1wXRasjhAVHFcCHGc8LpE4wD6iZcYKVLVS_ktGIoKD-c/edit?tab=t.zeev3ux2ubqs"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-900/20 hover:bg-blue-900/40 border border-blue-800/40 hover:border-blue-700 rounded-md text-xs text-blue-200 hover:text-white transition-colors"
          >
            <ArrowUpRight size={12} /> Weekly Non-Negotiables Doc
          </a>
          <div className="inline-flex bg-[#1a1d23] border border-gray-800 rounded-md overflow-hidden text-xs">
            {([
              { k: 'this', label: 'This Week' },
              { k: 'prior', label: 'Last Week' },
            ] as const).map((opt) => (
              <button
                key={opt.k}
                onClick={() => setWindowChoice(opt.k)}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  windowChoice === opt.k
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && !data ? (
        <div className="text-gray-400 text-sm flex items-center gap-2 py-8">
          <Loader2 size={14} className="animate-spin" /> Pulling weekly data…
        </div>
      ) : !data || !data.configured ? (
        <div className="text-rose-400 text-sm py-8">Could not load weekly checklist data.</div>
      ) : (
        <>
          {/* ──────────────────────────────────────────────────────────
             1. INCOME — cash + AR vs targets + constraint identification
             ────────────────────────────────────────────────────────── */}
          {(() => {
            const ic = data.incomeCheck;
            const both = ic.bothOnTarget;
            const hasTargets = ic.cashTarget > 0 || ic.arTarget > 0;
            const PaceIcon = both ? CheckCircle2 : AlertCircle;
            return (
              <CardShell
                title="1. Income"
                subtitle="Did we hit our weekly cash + AR targets? If not, which is the constraint?"
                cardId="week:income"
              >
                {!hasTargets ? (
                  <div className="text-gray-400 text-sm">No monthly targets set in t21. Add cash_collected and receivables targets to see weekly pace.</div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 mb-3">
                      <PaceIcon size={18} className={both ? 'text-emerald-300' : 'text-rose-300'} />
                      <span className={`text-sm font-semibold ${both ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {both ? 'Both targets hit' : ic.cashHit === false && ic.arHit === false ? 'Both targets missed' : 'One target missed'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-3">
                      {/* Cash */}
                      <div className={`bg-black/20 border rounded-lg p-3 ${ic.cashHit ? 'border-emerald-800/40' : 'border-rose-800/40'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">New Cash</span>
                          {ic.cashHit
                            ? <CheckCircle2 size={14} className="text-emerald-300" />
                            : <AlertCircle size={14} className="text-rose-300" />}
                        </div>
                        <div className="text-2xl font-bold text-white tabular-nums">{fmtUSD(ic.cash)}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          target {fmtUSD(ic.cashTarget)} · {ic.cashVsTarget >= 0
                            ? <span className="text-emerald-400">{fmtUSD(ic.cashVsTarget)} above</span>
                            : <span className="text-rose-400">{fmtUSD(Math.abs(ic.cashVsTarget))} below</span>}
                        </div>
                      </div>
                      {/* AR */}
                      <div className={`bg-black/20 border rounded-lg p-3 ${ic.arHit ? 'border-emerald-800/40' : 'border-rose-800/40'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">AR Collected</span>
                          {ic.arHit
                            ? <CheckCircle2 size={14} className="text-emerald-300" />
                            : <AlertCircle size={14} className="text-rose-300" />}
                        </div>
                        <div className="text-2xl font-bold text-white tabular-nums">{fmtUSD(ic.ar)}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          target {fmtUSD(ic.arTarget)} · {ic.arVsTarget >= 0
                            ? <span className="text-emerald-400">{fmtUSD(ic.arVsTarget)} above</span>
                            : <span className="text-rose-400">{fmtUSD(Math.abs(ic.arVsTarget))} below</span>}
                        </div>
                      </div>
                    </div>

                    {/* Constraint identification */}
                    {ic.constraint && (
                      <div className="bg-rose-900/20 border border-rose-800/40 rounded-md px-3 py-2 text-sm text-rose-200">
                        <span className="font-bold uppercase tracking-wider text-[11px] text-rose-300">Constraint:</span>{' '}
                        {ic.constraint === 'cash'
                          ? <>Cash is the bottleneck this week — {fmtUSD(Math.abs(ic.cashVsTarget))} below target. Where do we drive new $ in next 7 days? <span className="italic text-rose-300">(big revenue play / ICE test)</span></>
                          : <>AR is the bottleneck this week — {fmtUSD(Math.abs(ic.arVsTarget))} below target. Who has unpaid balances we should be collecting on?</>}
                      </div>
                    )}
                    {both && (
                      <div className="bg-emerald-900/20 border border-emerald-800/40 rounded-md px-3 py-2 text-sm text-emerald-200">
                        <span className="font-bold uppercase tracking-wider text-[11px] text-emerald-300">Big play:</span>{' '}
                        Both targets hit. What revenue play that worked this week should we DOUBLE DOWN on? What new ICE test drives even more $ in next week?
                      </div>
                    )}
                  </>
                )}
              </CardShell>
            );
          })()}

          {/* ──────────────────────────────────────────────────────────
             2. EXPENSES — total + per-category vs target
             ────────────────────────────────────────────────────────── */}
          {(() => {
            const ec = data.expenseCheck;
            const hasTarget = ec.weeklyTarget > 0;
            return (
              <CardShell
                title="2. Expenses"
                subtitle="Did we maintain our profit margin target? If not, where did we overspend?"
                cardId="week:expenses"
              >
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className={`bg-black/20 border rounded-lg p-3 ${ec.onTarget === false ? 'border-rose-800/40' : 'border-emerald-800/40'}`}>
                    <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">Total Expenses</div>
                    <div className={`text-2xl font-bold tabular-nums mt-1 ${ec.onTarget === false ? 'text-rose-300' : 'text-emerald-300'}`}>{fmtUSD(ec.actual)}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {hasTarget ? `target ${fmtUSD(ec.weeklyTarget)}` : 'no target set'}
                    </div>
                  </div>
                  <div className="bg-black/20 border border-gray-800 rounded-lg p-3">
                    <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">Over / Under</div>
                    <div className={`text-2xl font-bold tabular-nums mt-1 ${ec.overBy > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                      {ec.overBy > 0 ? '+' : ''}{fmtUSD(ec.overBy)}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">vs weekly target</div>
                  </div>
                  <div className="bg-black/20 border border-gray-800 rounded-lg p-3">
                    <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">Biggest overspend</div>
                    <div className="text-lg font-bold text-white capitalize mt-1">
                      {ec.biggestOverspendCategory?.category ?? '—'}
                    </div>
                    {ec.biggestOverspendCategory && (
                      <div className="text-[10px] text-rose-400 tabular-nums mt-0.5">
                        +{fmtUSD(ec.biggestOverspendCategory.overBy)} over
                      </div>
                    )}
                  </div>
                </div>

                {/* Per-category breakdown */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold border-b border-gray-800">
                        <th className="text-left py-2">Category</th>
                        <th className="text-right py-2 px-3">Actual</th>
                        <th className="text-right py-2 px-3">Weekly Target</th>
                        <th className="text-right py-2 px-3">Vs Target</th>
                        <th className="text-right py-2 px-3">% of Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ec.categories.map((c) => (
                        <tr key={c.category} className="border-b border-gray-800/50">
                          <td className="py-2 text-white font-medium capitalize">{c.category}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-gray-200">{fmtUSD(c.actual)}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-gray-400">{c.weeklyTarget > 0 ? fmtUSD(c.weeklyTarget) : '—'}</td>
                          <td className={`py-2 px-3 text-right tabular-nums ${c.overBudget ? 'text-rose-300' : 'text-emerald-300'}`}>
                            {c.weeklyTarget > 0 ? (c.overBy > 0 ? `+${fmtUSD(c.overBy)}` : fmtUSD(c.overBy)) : '—'}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-gray-400">
                            {c.pctOfTarget !== null ? fmtPct(c.pctOfTarget) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {ec.biggestOverspendCategory && (
                  <div className="mt-3 bg-amber-900/10 border border-amber-800/40 rounded-md px-3 py-2 text-sm text-amber-200">
                    <span className="font-bold uppercase tracking-wider text-[11px] text-amber-300">Cut ASAP:</span>{' '}
                    <span className="capitalize">{ec.biggestOverspendCategory.category}</span> is {fmtUSD(ec.biggestOverspendCategory.overBy)} over weekly target.
                    What can we cut here, and is there room to negotiate price on any vendor?
                  </div>
                )}

                {/* Flagged transactions drop-down — the operator 2026-04-30:
                    only show the ones worth eyeballing (big-ticket /
                    uncategorized / personal). The full 326-row list
                    was too noisy. */}
                {ec.flaggedCount > 0 && (
                  <details className="mt-4 group">
                    <summary className="cursor-pointer select-none text-[11px] text-gray-400 uppercase tracking-wider font-semibold hover:text-gray-200 inline-flex items-center gap-1.5">
                      <span className="inline-block w-3 transition-transform group-open:rotate-90">▸</span>
                      <span className="px-1.5 py-0.5 rounded bg-rose-900/30 border border-rose-800/40 text-rose-300 text-[10px]">
                        {ec.flaggedCount} flagged transaction{ec.flaggedCount === 1 ? '' : 's'}
                      </span>
                      <span className="text-gray-500 normal-case tracking-normal text-[11px] font-normal">— click to expand</span>
                    </summary>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold border-b border-gray-800">
                            <th className="text-left py-2 w-[80px]">Date</th>
                            <th className="text-left py-2">Vendor</th>
                            <th className="text-left py-2 px-3">Category</th>
                            <th className="text-left py-2 px-3">Card</th>
                            <th className="text-right py-2 px-3 w-[110px]">Amount</th>
                            <th className="text-left py-2 px-3 w-[180px]">Flag</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ec.transactions.filter((t) => t.flag !== null).map((t) => {
                            const rowBg = t.flag === 'personal' ? 'bg-rose-900/15'
                              : t.flag === 'uncategorized' ? 'bg-amber-900/10'
                              : t.flag === 'big-ticket' ? 'bg-rose-900/10'
                              : '';
                            const flagPill = t.flag === 'personal' ? 'bg-rose-900/30 border-rose-800/40 text-rose-300'
                              : t.flag === 'uncategorized' ? 'bg-amber-900/30 border-amber-800/40 text-amber-300'
                              : t.flag === 'big-ticket' ? 'bg-rose-900/30 border-rose-800/40 text-rose-300'
                              : '';
                            const dateLabel = new Date(t.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            return (
                              <tr key={t.id} className={`border-b border-gray-800/50 ${rowBg}`}>
                                <td className="py-2 text-gray-400 text-xs tabular-nums">{dateLabel}</td>
                                <td className="py-2 text-white truncate max-w-[260px]" title={t.vendor}>{t.vendor}</td>
                                <td className="py-2 px-3 text-gray-300 capitalize text-xs">{t.type ?? <span className="text-amber-400 italic">unknown</span>}</td>
                                <td className="py-2 px-3 text-gray-500 text-xs">{t.card ?? '—'}</td>
                                <td className={`py-2 px-3 text-right tabular-nums font-semibold ${t.flag === 'big-ticket' || t.flag === 'personal' ? 'text-rose-300' : 'text-gray-200'}`}>
                                  {fmtUSD(t.amount)}
                                </td>
                                <td className="py-2 px-3 text-xs">
                                  {t.flag ? (
                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${flagPill}`}>
                                      <AlertTriangle size={10} /> {t.flagLabel}
                                    </span>
                                  ) : (
                                    <span className="text-gray-600">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-2 text-[10px] text-gray-500 italic">
                      Flag rules: big-ticket = single charge ≥ {fmtUSD(ec.bigTicketThreshold)} · uncategorized = no expense_type · personal = marked &quot;personal&quot; on a business card.
                    </div>
                  </details>
                )}
              </CardShell>
            );
          })()}

          {/* ──────────────────────────────────────────────────────────
             3. LAST WEEK COMPARISON — direction of red-flag metrics
             ────────────────────────────────────────────────────────── */}
          {(() => {
            const c = data.lastWeekComparison;
            return (
              <CardShell
                title="3. Last Week Comparison"
                subtitle={`${c.summary.better} better · ${c.summary.worse} worse · ${c.summary.same} unchanged. Did we do better or worse, and why?`}
                cardId="week:last-week"
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold border-b border-gray-800">
                        <th className="text-left py-2">Metric</th>
                        <th className="text-right py-2 px-3">Last Week</th>
                        <th className="text-right py-2 px-3">This Week</th>
                        <th className="text-right py-2 px-3">Direction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.metrics.map((m) => {
                        const Icon = m.direction === 'better' ? TrendingUp : m.direction === 'worse' ? TrendingDown : Minus;
                        const color = m.direction === 'better' ? 'text-emerald-300' : m.direction === 'worse' ? 'text-rose-300' : 'text-gray-400';
                        return (
                          <tr key={m.metric} className="border-b border-gray-800/50">
                            <td className="py-2 text-white font-medium">{m.metric}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-gray-400">{fmtMetric(m.prior, m.format)}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-gray-200">{fmtMetric(m.current, m.format)}</td>
                            <td className={`py-2 px-3 text-right ${color}`}>
                              <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider">
                                <Icon size={11} /> {m.direction}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardShell>
            );
          })()}

          {/* ──────────────────────────────────────────────────────────
             5. ORGANIC — bookings + $ per platform (Paid Ads is skipped)
             ────────────────────────────────────────────────────────── */}
          <CardShell
            title="4. Organic Channels"
            subtitle="Bookings + $ generated per platform. Goal: 2 bookings/day per channel + ROI positive."
            cardId="week:organic"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold border-b border-gray-800">
                    <th className="text-left py-2">Platform</th>
                    <th className="text-right py-2 px-3">Bookings</th>
                    <th className="text-right py-2 px-3">vs 14/wk goal</th>
                    <th className="text-right py-2 px-3">Cash Made</th>
                    <th className="text-right py-2 px-3">vs Last Wk</th>
                    <th className="text-right py-2 px-3">Deals</th>
                  </tr>
                </thead>
                <tbody>
                  {data.organicByPlatform.map((p) => {
                    const wowUp = p.cashWoWDelta >= 0;
                    return (
                      <tr key={p.platform} className="border-b border-gray-800/50">
                        <td className="py-2 text-white font-medium">{p.platform}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-gray-200">{p.bookings}</td>
                        <td className={`py-2 px-3 text-right tabular-nums text-xs ${p.bookingsOnTarget ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {p.bookingsOnTarget ? '✓ on target' : `${p.bookingsTarget - p.bookings} short`}
                        </td>
                        <td className={`py-2 px-3 text-right tabular-nums font-semibold ${p.cash > 0 ? 'text-emerald-300' : 'text-gray-500'}`}>
                          {fmtUSD(p.cash)}
                        </td>
                        <td className={`py-2 px-3 text-right tabular-nums text-xs ${wowUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {p.cashPrior === 0 && p.cash === 0 ? '—' : (wowUp ? `↑ ${fmtUSD(Math.abs(p.cashWoWDelta))}` : `↓ ${fmtUSD(Math.abs(p.cashWoWDelta))}`)}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums text-gray-400">{p.deals}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 text-[11px] text-gray-500 italic">
              Skipped: paid ads — that lives on a separate platform per the operator's call.
            </div>
          </CardShell>

          {/* ──────────────────────────────────────────────────────────
             6. SALES TEAM — show% / close% + lowest cash/call + CSM upsells
             ────────────────────────────────────────────────────────── */}
          {(() => {
            const s = data.salesTeam;
            const ShowIcon = s.showRateOk ? CheckCircle2 : AlertCircle;
            const CloseIcon = s.closeRateOk ? CheckCircle2 : AlertCircle;
            const closers = s.rows.filter((r) => r.role === 'closer').sort((a, b) => a.cashPerCall - b.cashPerCall);
            const lowest = closers[0];
            const csm = data.csmUpsellCheck;
            return (
              <CardShell
                title="5. Sales Team"
                subtitle={`Show% target ${fmtPct(s.showRateTarget)} · Close% target ${fmtPct(s.closeRateTarget)} · CSMs ≥${csm.target} upsells each`}
                cardId="week:sales-team"
              >
                {/* Combined rate pills */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className={`bg-black/20 border rounded-lg p-3 ${s.showRateOk ? 'border-emerald-800/40' : 'border-rose-800/40'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <ShowIcon size={14} className={s.showRateOk ? 'text-emerald-300' : 'text-rose-300'} />
                      <span className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">Combined Show Rate</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-2xl font-bold tabular-nums ${s.showRateOk ? 'text-emerald-300' : 'text-rose-300'}`}>{fmtPct(s.combinedShowRate)}</span>
                      <span className="text-[10px] text-gray-500">target {fmtPct(s.showRateTarget)}</span>
                    </div>
                  </div>
                  <div className={`bg-black/20 border rounded-lg p-3 ${s.closeRateOk ? 'border-emerald-800/40' : 'border-rose-800/40'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <CloseIcon size={14} className={s.closeRateOk ? 'text-emerald-300' : 'text-rose-300'} />
                      <span className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">Combined Close Rate</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-2xl font-bold tabular-nums ${s.closeRateOk ? 'text-emerald-300' : 'text-rose-300'}`}>{fmtPct(s.combinedCloseRate)}</span>
                      <span className="text-[10px] text-gray-500">target {fmtPct(s.closeRateTarget)}</span>
                    </div>
                  </div>
                </div>

                {/* Lowest cash/call closer callout */}
                {lowest && (
                  <div className="bg-rose-900/10 border border-rose-800/40 rounded-md px-3 py-2 mb-4 text-sm">
                    <span className="font-bold uppercase tracking-wider text-[11px] text-rose-300">Dropping the ball:</span>{' '}
                    <span className="text-white font-semibold">{lowest.name}</span> — lowest cash/call this week at{' '}
                    <span className="text-rose-300 tabular-nums font-semibold">{fmtUSD(lowest.cashPerCall)}/call</span>
                    {' '}({fmtUSD(lowest.cash)} on {lowest.showed} shown). Decide: 1:1 conversation, training, or one-week miss?
                  </div>
                )}

                {/* Closer leaderboard */}
                <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold mb-2">Closers · sorted by Cash/Call</div>
                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold border-b border-gray-800">
                        <th className="text-left py-2">Closer</th>
                        <th className="text-right py-2 px-3">Booked</th>
                        <th className="text-right py-2 px-3">Showed</th>
                        <th className="text-right py-2 px-3">Closed</th>
                        <th className="text-right py-2 px-3">Show%</th>
                        <th className="text-right py-2 px-3">Close%</th>
                        <th className="text-right py-2 px-3">Cash</th>
                        <th className="text-right py-2 px-3">Cash/Call</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...closers].reverse().map((c, i) => (
                        <tr key={c.name} className={`border-b border-gray-800/50 ${c.name === lowest?.name ? 'bg-rose-900/10' : ''}`}>
                          <td className="py-2 text-white font-medium">
                            {c.name}
                            {i === 0 && closers.length > 1 && <Trophy size={11} className="inline ml-2 text-cyan-300" />}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-gray-300">{c.booked}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-gray-300">{c.showed}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-gray-300">{c.closed}</td>
                          <td className={`py-2 px-3 text-right tabular-nums ${c.showRate >= s.showRateTarget ? 'text-emerald-300' : 'text-gray-300'}`}>{fmtPct(c.showRate)}</td>
                          <td className={`py-2 px-3 text-right tabular-nums ${c.closeRate >= s.closeRateTarget ? 'text-emerald-300' : 'text-gray-300'}`}>{fmtPct(c.closeRate)}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-emerald-300">{fmtUSD(c.cash)}</td>
                          <td className={`py-2 px-3 text-right tabular-nums font-semibold ${i === 0 ? 'text-cyan-300' : c.name === lowest?.name ? 'text-rose-300' : 'text-gray-200'}`}>{fmtUSD(c.cashPerCall)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* CSM upsell check */}
                <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold mb-2">
                  CSM Upsells · target ≥{csm.target} each
                </div>
                {csm.rows.length === 0 ? (
                  <div className="text-gray-400 text-sm">No CSM activity recorded this week.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {csm.rows.map((c) => (
                      <div key={c.name} className={`bg-black/20 border rounded-md px-3 py-2 ${c.hitTarget ? 'border-emerald-800/40' : 'border-rose-800/40'}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-white font-medium text-sm">{c.name}</span>
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

          {/* ──────────────────────────────────────────────────────────
             7. QUALITATIVE DATA — LLM-bucketed buy reasons / pain / etc.
             ────────────────────────────────────────────────────────── */}
          <CardShell
            title="6. Qualitative Data"
            subtitle="LLM analysis of why_they_bought across closed deals: buy reasons, pain points, desires, objections, AI use cases."
            cardId="week:qualitative"
            headerExtra={
              <div className="flex items-center gap-2 flex-wrap">
                {/* the operator 2026-04-30: send the qualitative digest to
                    the CMO in #media-buying so they can build content
                    around the top themes. */}
                <button
                  onClick={sendToMarketingManager}
                  disabled={marketingNotifyState?.status === 'sending' || !qualData?.summary}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded text-[11px] font-semibold transition-colors"
                  title="Posts the bucketed buy-reasons / pain-points / desires / objections / AI-use-cases to the media-buying Slack channel"
                >
                  {marketingNotifyState?.status === 'sending'
                    ? <Loader2 size={11} className="animate-spin" />
                    : <ArrowUpRight size={11} />}
                  Send to marketing manager
                </button>
                {marketingNotifyState?.status === 'sent' && (
                  <span className="text-emerald-300 text-[11px] inline-flex items-center gap-1"><CheckCircle2 size={11} /> Sent</span>
                )}
                {marketingNotifyState?.status === 'error' && (
                  marketingNotifyState.hint ? (
                    <span
                      className="text-rose-300 text-[11px] max-w-[420px] inline-flex items-center gap-1"
                      title={marketingNotifyState.msg}
                    >
                      <span className="font-semibold">Error:</span> {marketingNotifyState.hint}
                    </span>
                  ) : (
                    <span className="text-rose-300 text-[11px]" title={marketingNotifyState.msg}>
                      Error: {marketingNotifyState.msg}
                    </span>
                  )
                )}
                <button
                  onClick={refreshQualitative}
                  disabled={qualLoading}
                  className="text-[11px] text-gray-400 hover:text-white inline-flex items-center gap-1 px-2 py-1 border border-gray-700 rounded hover:bg-gray-800/50 disabled:opacity-50"
                  title="Force regenerate (calls Claude — slow)"
                >
                  <RefreshCcw size={11} className={qualLoading ? 'animate-spin' : ''} /> Regenerate
                </button>
              </div>
            }
          >
            {qualLoading && !qualData ? (
              <div className="text-gray-400 text-sm flex items-center gap-2 py-4">
                <Loader2 size={14} className="animate-spin" /> Bucketing call data…
              </div>
            ) : qualError ? (
              <div className="text-rose-300 text-sm">Could not generate summary: {qualError}</div>
            ) : !qualData?.summary ? (
              <div className="text-gray-400 text-sm">
                {qualData?.reason === 'no_qualitative_data'
                  ? 'No qualitative data populated this week (no closed deals + no analyzed call recordings).'
                  : 'No qualitative data available.'}
              </div>
            ) : (() => {
              const sum = qualData.summary;
              const sections: Array<{ key: keyof typeof sum; label: string; helpText: string; sourceLabel: string }> = [
                { key: 'buyReasons', label: 'What made them buy', helpText: 'Use these themes in content + ad creative.', sourceLabel: `${sum.closedDealsAnalyzed} closed deals` },
                { key: 'painPoints', label: 'Pain points',          helpText: 'Send to CMO for content/ad creative.',         sourceLabel: `${sum.totalCallsAnalyzed} calls (closed + non-closed)` },
                { key: 'desires',    label: 'Desires',                helpText: 'The future they\'re aiming for — paint that picture.', sourceLabel: `${sum.totalCallsAnalyzed} calls (closed + non-closed)` },
                { key: 'objections', label: 'Objections (didn\'t buy)', helpText: 'What stopped people from closing — address in pitch + content.', sourceLabel: `${sum.nonClosedCallsAnalyzed} non-closed calls only` },
                { key: 'aiUseCases', label: 'AI use cases',           helpText: 'Demos to build for Program C pitches.', sourceLabel: `${sum.totalCallsAnalyzed} calls (closed + non-closed)` },
              ];
              return (
                <>
                  <div className="text-[11px] text-gray-500 mb-3">
                    {sum.closedDealsAnalyzed} closed deals · {sum.totalCallsAnalyzed} call recordings ({sum.nonClosedCallsAnalyzed} non-closed) · model {sum.model}
                    {qualData.cached && qualData.generatedAt && (
                      <span> · cached {new Date(qualData.generatedAt).toLocaleString()}</span>
                    )}
                  </div>
                  <div className="space-y-4">
                    {sections.map(({ key, label, helpText, sourceLabel }) => {
                      const buckets = (sum[key] ?? []) as ThemeBucket[];
                      if (!buckets || buckets.length === 0) {
                        return (
                          <div key={key as string}>
                            <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold mb-1">{label}</div>
                            <div className="text-[10px] text-gray-600 mb-1">{helpText} · source: {sourceLabel}</div>
                            <div className="text-gray-500 text-sm italic">No themes surfaced this week.</div>
                          </div>
                        );
                      }
                      return (
                        <div key={key as string}>
                          <div className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold mb-1">{label}</div>
                          <div className="text-[10px] text-gray-600 mb-2">{helpText} · <span className="text-gray-500">source: {sourceLabel}</span></div>
                          <div className="space-y-2">
                            {buckets.map((b, i) => (
                              <div key={i} className="bg-black/20 border border-gray-800 rounded-md p-3">
                                <div className="flex items-baseline justify-between gap-2 mb-1">
                                  <div className="text-white font-semibold text-sm">{b.theme}</div>
                                  {/* Frequency badge — the operator 2026-04-30: surface
                                      the count prominently so we can see how often
                                      a theme arose. */}
                                  <div className="flex-shrink-0 px-1.5 py-0.5 rounded bg-blue-900/30 border border-blue-800/40 text-blue-300 text-[10px] font-semibold tabular-nums">
                                    {b.frequency}× {key === 'buyReasons' ? 'deal' : 'call'}{b.frequency === 1 ? '' : 's'}
                                  </div>
                                </div>
                                <div className="text-[11px] text-gray-400 mb-2">{b.description}</div>
                                <div className="space-y-1.5">
                                  {b.quotes.map((q, qi) => (
                                    <div key={qi} className="flex items-start gap-1.5 text-xs text-gray-300 italic leading-relaxed">
                                      <Quote size={10} className="text-gray-600 flex-shrink-0 mt-1" />
                                      <span>{q.replace(/^["']|["']$/g, '')}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </CardShell>

          {/* Strategic Reflection + Constraint sections removed
             2026-04-30 — the operator does these in a Google Doc instead. */}

          {/* Footer */}
          <div className="pt-2 text-xs text-gray-500 flex items-center gap-4 flex-wrap">
            <Link href="/" className="hover:text-gray-300 inline-flex items-center gap-1">
              Main Dashboard <ArrowUpRight size={11} />
            </Link>
            <span>·</span>
            <Link href="/today" className="hover:text-gray-300 inline-flex items-center gap-1">
              Daily Review <ArrowUpRight size={11} />
            </Link>
            <span>·</span>
            <span>Weekly review complete when every section above checks out</span>
          </div>
        </>
      )}
    </div>
  );
}
