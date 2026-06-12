'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  DollarSign,
  Repeat,
  Undo2,
  TrendingUp,
  Receipt,
  Wallet,
  Percent,
  Users,
  Pencil,
  Check,
  X as XIcon,
  type LucideIcon,
} from 'lucide-react';
import { useTimeframe } from '@/lib/useTimeframe';
import { useDashboardData } from '@/hooks/useDashboardData';
import { priorPeriodFor, priorMonthYM_ET } from '@/lib/timeframe';
import CardFeedbackMenu from './CardFeedbackMenu';

/**
 * Headline KPIs — direct migration of Metabase board 133's top strip.
 * Visual parity with Metabase: per-card icon, big bold value, period subtitle,
 * trend pill (green/red arrow + % + prior value), hover state (blue border +
 * tooltip with exact value), and a footer pace legend.
 *
 * Architecture B (the operator 2026-04-29): all revenue cards source from
 * t07_income_processors via /api/main/revenue-buckets so they reconcile
 * with Revenue Composition + Cash by Source/Offer. The sheet is only kept
 * for activeClientCount (sheet has client status info t07 doesn't).
 *
 * 8 cards in a 4×2 grid:
 *   1. New Cash MTD       (revBuckets.newCash)
 *   2. Backend Revenue MTD(revBuckets.ar + upsellRenewal + mastermind + uncategorized)
 *   3. Refunds MTD        (revBuckets.refunds, displayed negative)
 *   4. Net Revenue MTD    (revBuckets.netRevenue)
 *   5. Expenses MTD       (sum of t08 expenses[].amount)
 *   6. Net Profit MTD     (netRevenue - expenses)
 *   7. Margin % MTD       (netProfit / netRevenue)
 *   8. Active Clients     (sheetRevenue.activeClientCount, kept on sheet)
 */

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtUSDShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${n < 0 ? '-' : ''}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${n < 0 ? '-' : ''}$${Math.round(a / 1000)}k`;
  return fmtUSD(n);
};
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtCount = (n: number) => n.toLocaleString('en-US');

interface PriorRevenue {
  newCash: number;
  refunds: number;
  ar: number;
  renewals: number;
  upgrades: number;
  mastermind: number;
  clientCount: number;
  totalRevenue: number;
}

interface RevBuckets {
  newCash: number;
  ar: number;
  upsellRenewal: number;
  mastermind: number;
  uncategorized: number;
  refunds: number;
  /** Slice of newCash where offer ILIKE '%deposit%'. Reported separately. */
  depositRevenue: number;
  grossInflow: number;
  netRevenue: number;
}

function formatLongDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

interface KPICardEdit {
  /** Whether the inline editor is open. */
  editing: boolean;
  /** Current draft value (string so the input can hold partials). */
  draft: string;
  setDraft: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  saving: boolean;
  /** True when the displayed value is the operator override (changes affordance copy). */
  isOverridden: boolean;
  /** Optional prefix shown inside the input (e.g. '$' for currency). Defaults to '$'. */
  inputPrefix?: string;
}

interface KPICardProps {
  label: string;
  Icon: LucideIcon;
  value: string;
  exact: string;
  current: number;
  prior: number | null;
  /** When true, decreasing value = good (e.g. refunds, expenses). */
  inverse?: boolean;
  priorValueFmt?: (n: number) => string;
  periodLabel: string;
  priorLabel: string | null;
  loading: boolean;
  /** Stable id for the per-card "Send to Claude" feedback popover. */
  cardId: string;
  /** Optional inline-edit affordance. When present, the value can be overridden. */
  edit?: KPICardEdit;
}

function KPICard({
  label,
  Icon,
  value,
  exact,
  current,
  prior,
  inverse = false,
  priorValueFmt = fmtUSDShort,
  periodLabel,
  priorLabel,
  loading,
  cardId,
  edit,
}: KPICardProps) {
  let trend: 'up' | 'down' | 'flat' = 'flat';
  let pctDelta = 0;
  if (prior !== null && prior !== 0) {
    pctDelta = ((current - prior) / Math.abs(prior)) * 100;
    if (pctDelta > 0.5) trend = 'up';
    else if (pctDelta < -0.5) trend = 'down';
  }
  const isGood = inverse ? trend === 'down' : trend === 'up';
  const trendColor = trend === 'flat' ? 'text-gray-500' : isGood ? 'text-emerald-400' : 'text-red-400';
  const ArrowIcon = trend === 'up' ? ArrowUp : trend === 'down' ? ArrowDown : ArrowUp;

  return (
    <div
      className="group relative bg-[#1a1d23] border border-gray-800 rounded-xl px-5 py-4 flex flex-col items-center text-center transition-all duration-150 hover:bg-[#1f242c] hover:border-blue-500/60 hover:shadow-[0_0_0_1px_rgba(59,130,246,0.25)] cursor-default overflow-visible"
    >
      {/* Top row: icon + label, kebab on the right */}
      <div className="w-full flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon size={14} className="text-blue-400 shrink-0" />
          <div className="text-[11px] uppercase tracking-wider text-gray-300 font-semibold truncate">{label}</div>
          {edit?.isOverridden && !edit.editing && (
            <span
              title="Operator override active"
              className="text-[9px] uppercase tracking-wider text-amber-400 font-semibold border border-amber-500/30 rounded px-1 py-0.5 leading-none"
            >
              edit
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {edit && !edit.editing && !loading && (
            <button
              type="button"
              onClick={edit.onStartEdit}
              className="p-0.5 rounded text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
              title="Edit value"
            >
              <Pencil size={12} />
            </button>
          )}
          <CardFeedbackMenu cardId={cardId} />
        </div>
      </div>

      {/* Value */}
      <div className="relative">
        {edit?.editing ? (
          <div className="flex items-center gap-1.5">
            <div className="inline-flex items-center gap-1 bg-black/40 border border-blue-600 rounded px-2 py-1 w-36">
              {(edit.inputPrefix ?? '$') && (
                <span className="text-xs text-gray-500">{edit.inputPrefix ?? '$'}</span>
              )}
              <input
                autoFocus
                inputMode="decimal"
                value={edit.draft}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '' || /^-?\d*\.?\d*$/.test(v)) edit.setDraft(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') edit.onSaveEdit();
                  if (e.key === 'Escape') edit.onCancelEdit();
                }}
                disabled={edit.saving}
                className="w-full bg-transparent outline-none text-right text-white text-xl tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
              />
            </div>
            <button
              type="button"
              onClick={edit.onSaveEdit}
              disabled={edit.saving}
              className="p-1 rounded bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-300"
              title="Save"
            >
              {edit.saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            </button>
            <button
              type="button"
              onClick={edit.onCancelEdit}
              className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400"
              title="Cancel"
            >
              <XIcon size={12} />
            </button>
          </div>
        ) : (
          <div className="text-3xl md:text-[34px] font-bold text-white tracking-tight leading-none">
            {loading ? <Loader2 size={22} className="animate-spin text-gray-600" /> : value}
          </div>
        )}
        {/* Hover tooltip: exact value pill */}
        {!loading && !edit?.editing && (
          <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-9 opacity-0 group-hover:opacity-100 transition-opacity bg-[#0a0c0f] border border-gray-700 text-blue-300 text-xs font-semibold px-2.5 py-1 rounded shadow-lg whitespace-nowrap">
            {exact}
            <span className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-[#0a0c0f] border-r border-b border-gray-700 rotate-45" />
          </div>
        )}
      </div>

      {/* Period date */}
      <div className="text-[11px] text-gray-400 mt-2">{periodLabel}</div>

      {/* Trend row */}
      {prior !== null && priorLabel ? (
        <div className={`mt-1.5 flex items-center gap-1 text-[11px] font-semibold ${trendColor}`}>
          {trend !== 'flat' && <ArrowIcon size={12} strokeWidth={3} />}
          <span>{Math.abs(pctDelta).toFixed(2)}%</span>
          <span className="text-gray-500 font-normal">
            vs. {priorLabel}: {priorValueFmt(prior)}
          </span>
        </div>
      ) : (
        <div className="mt-1.5 text-[11px] text-gray-600">—</div>
      )}
    </div>
  );
}

export default function HeadlineKPIs() {
  const tf = useTimeframe();
  const { sheetRevenue, loading: dashLoading } = useDashboardData();

  const [priorRev, setPriorRev] = useState<PriorRevenue | null>(null);
  const [priorExpensesTotal, setPriorExpensesTotal] = useState<number | null>(null);
  // CRITICAL: Expenses MTD MUST come from the same t08_expenses source the
  // ExpenseBreakdown donut uses. Earlier this card pulled `expenses` directly
  // from `useDashboardData()` (Mercury Bank API) — the totals never matched
  // the donut because Mercury direct ≠ t08_expenses. Single source of truth.
  const [currentExpensesTotal, setCurrentExpensesTotal] = useState<number | null>(null);
  const [priorLoading, setPriorLoading] = useState(true);

  // ── Manual KPI overrides ──────────────────────────────────────────────
  // The operator can correct any KPI value inline; saved per-(metric, month)
  // to manual_kpi_overrides. Currently only the Deposit Revenue card
  // exposes the affordance, but the wiring is generic so other cards can
  // opt in by passing `edit={...}` to KPICard.
  const month = (tf.from && /^\d{4}-\d{2}/.test(tf.from)) ? tf.from.slice(0, 7) : '';
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [editingMetric, setEditingMetric] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    fetch(`/api/overrides/kpi?month=${month}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setOverrides(d?.overrides ?? {}); })
      .catch(() => { if (!cancelled) setOverrides({}); });
    return () => { cancelled = true; };
  }, [month]);

  const saveOverride = async (metric_key: string, value: number) => {
    setEditSaving(true);
    // Optimistic update so the card snaps to the new value immediately.
    setOverrides((prev) => ({ ...prev, [metric_key]: value }));
    try {
      const res = await fetch('/api/overrides/kpi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metric_key, month, value }),
      });
      if (!res.ok) {
        // Rollback on failure
        const fresh = await fetch(`/api/overrides/kpi?month=${month}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null);
        setOverrides(fresh?.overrides ?? {});
      }
    } finally {
      setEditSaving(false);
      setEditingMetric(null);
    }
  };
  // Architecture B: revenue-buckets (t07) for current + prior month. Same
  // endpoint Revenue Composition reads, so the donut total and Net Revenue
  // KPI are guaranteed to match.
  const [currentRev, setCurrentRev] = useState<RevBuckets | null>(null);
  const [priorRevBuckets, setPriorRevBuckets] = useState<RevBuckets | null>(null);

  // Fetch current + prior-period revenue (t07) + expenses (t08) + sheet
  // (for Active Clients only). Listens for `billing:categorized` so the
  // KPIs auto-refresh as the team works the Uncategorized Billing queue.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setPriorLoading(true);
      // the operator 2026-05-03: pass from/to ranges directly so "Last 7 Days" /
      // "Last 30 Days" actually narrow the cards. Earlier code rounded both
      // bounds up to a YYYY-MM and asked /api/main/revenue-buckets?month=…,
      // which is why the cards stayed stuck on the full month regardless of
      // the timeframe pill. Sheet-revenue is still month-keyed because it
      // sources Active-Client snapshots, not revenue.
      const prior = priorPeriodFor({ from: tf.from, to: tf.to, preset: tf.preset, label: tf.label });
      const priorMonthYM = (prior.from && /^\d{4}-\d{2}/.test(prior.from)) ? prior.from.slice(0, 7) : priorMonthYM_ET();
      const cb = `&_t=${Date.now()}`;
      Promise.all([
        // Architecture B: revenue from t07 — date-range aware
        fetch(`/api/main/revenue-buckets?from=${tf.from}&to=${tf.to}${cb}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`/api/main/revenue-buckets?from=${prior.from}&to=${prior.to}${cb}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        // Sheet only kept around for activeClientCount comparison
        fetch(`/api/data/sheet-revenue?month=${priorMonthYM}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`/api/main/expense-breakdown?from=${prior.from}&to=${prior.to}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`/api/main/expense-breakdown?from=${tf.from}&to=${tf.to}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ])
        .then(([curBuckets, priorBuckets, priorSheet, priorExp, currExp]) => {
          if (cancelled) return;
          if (curBuckets && typeof curBuckets.newCash === 'number') setCurrentRev(curBuckets);
          if (priorBuckets && typeof priorBuckets.newCash === 'number') setPriorRevBuckets(priorBuckets);
          // Active Clients prior comparison still uses sheet (t07 has no
          // notion of active vs paused vs churned — only the sheet does).
          if (priorSheet && typeof priorSheet.newCash === 'number') {
            setPriorRev({
              newCash: priorSheet.newCash ?? 0,
              refunds: priorSheet.refunds ?? 0,
              ar: priorSheet.ar ?? 0,
              renewals: priorSheet.renewals ?? 0,
              upgrades: priorSheet.upgrades ?? 0,
              mastermind: priorSheet.mastermind ?? 0,
              clientCount: priorSheet.activeClientCount ?? priorSheet.clientCount ?? 0,
              totalRevenue: priorSheet.totalRevenue ?? 0,
            });
          } else {
            setPriorRev(null);
          }
          const sumRows = (resp: { rows?: Array<{ amount: number }> } | null) =>
            resp && Array.isArray(resp.rows)
              ? resp.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
              : null;
          setPriorExpensesTotal(sumRows(priorExp));
          setCurrentExpensesTotal(sumRows(currExp));
        })
        .finally(() => !cancelled && setPriorLoading(false));
    };
    load();
    const onCategorized = () => load();
    window.addEventListener('billing:categorized', onCategorized);
    window.addEventListener('expense:categorized', onCategorized);
    return () => {
      cancelled = true;
      window.removeEventListener('billing:categorized', onCategorized);
      window.removeEventListener('expense:categorized', onCategorized);
    };
  }, [tf.from, tf.to, tf.preset, tf.label]);

  const kpis = useMemo(() => {
    // Architecture B: t07_income_processors via /api/main/revenue-buckets.
    // Same source as Revenue Composition donut → guaranteed reconciliation.
    const newCash = currentRev?.newCash ?? 0;
    const refunds = Math.abs(currentRev?.refunds ?? 0);
    // Backend = AR + upsells/renewals + mastermind. Uncategorized rolls in
    // here too (it's revenue we KNOW we collected, just not yet bucketed —
    // the queue work shrinks this and grows the named buckets, but the
    // total stays the same).
    const backend =
      (currentRev?.ar ?? 0) +
      (currentRev?.upsellRenewal ?? 0) +
      (currentRev?.mastermind ?? 0) +
      (currentRev?.uncategorized ?? 0);
    const netRevenue = currentRev?.netRevenue ?? newCash + backend - refunds;
    const totalExpenses = currentExpensesTotal ?? 0;
    const netProfit = netRevenue - totalExpenses;
    const marginPct = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;
    // Active = status IN ('Active','Upsold') per the spec 2026-04-30. Sourced
    // from the sheet (manually-maintained client status). NOT total client
    // count (which was wrongly showing 380 here previously).
    const activeClients = sheetRevenue.activeClientCount ?? 0;
    const depositRevenue = currentRev?.depositRevenue ?? 0;
    return { newCash, refunds, backend, netRevenue, totalExpenses, netProfit, marginPct, activeClients, depositRevenue };
  }, [currentRev, currentExpensesTotal, sheetRevenue]);

  const priorKpis = useMemo(() => {
    if (!priorRev && !priorRevBuckets) return null;
    // Architecture B: prior month also reads from t07 for revenue, sheet
    // only used for activeClientCount comparison.
    const newCash = priorRevBuckets?.newCash ?? priorRev?.newCash ?? 0;
    const refunds = Math.abs(priorRevBuckets?.refunds ?? priorRev?.refunds ?? 0);
    const backend = priorRevBuckets
      ? (priorRevBuckets.ar + priorRevBuckets.upsellRenewal + priorRevBuckets.mastermind + priorRevBuckets.uncategorized)
      : ((priorRev?.ar ?? 0) + (priorRev?.renewals ?? 0) + (priorRev?.upgrades ?? 0) + (priorRev?.mastermind ?? 0));
    const netRevenue = priorRevBuckets?.netRevenue ?? (newCash + backend - refunds);
    const expensesTotal = priorExpensesTotal ?? null;
    const netProfit = expensesTotal !== null ? netRevenue - expensesTotal : null;
    const marginPct = netProfit !== null && netRevenue > 0 ? (netProfit / netRevenue) * 100 : null;
    const depositRevenue = priorRevBuckets?.depositRevenue ?? 0;
    return {
      newCash,
      refunds,
      backend,
      netRevenue,
      expenses: expensesTotal,
      netProfit,
      marginPct,
      activeClients: priorRev?.clientCount ?? 0,
      depositRevenue,
    };
  }, [priorRev, priorRevBuckets, priorExpensesTotal]);

  const periodLabel = formatLongDate(tf.to);
  const priorLabel = priorRev ? formatLongDate(tf.from) : null;
  const loading = dashLoading || priorLoading;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          cardId="main:headline:new-cash"
          label="New Cash"
          Icon={DollarSign}
          value={fmtUSD(kpis.newCash)}
          exact={fmtUSD(kpis.newCash)}
          current={kpis.newCash}
          prior={priorKpis?.newCash ?? null}
          priorLabel={priorLabel}
          periodLabel={periodLabel}
          loading={loading}
        />
        <KPICard
          cardId="main:headline:backend-revenue"
          label="Backend Revenue"
          Icon={Repeat}
          value={fmtUSD(kpis.backend)}
          exact={fmtUSD(kpis.backend)}
          current={kpis.backend}
          prior={priorKpis?.backend ?? null}
          priorLabel={priorLabel}
          periodLabel={periodLabel}
          loading={loading}
        />
        {(() => {
          const override = overrides['deposit_revenue'];
          const isOverridden = override !== undefined;
          const display = isOverridden ? override : kpis.depositRevenue;
          return (
            <KPICard
              cardId="main:headline:deposit-revenue"
              label="Deposit Revenue"
              Icon={DollarSign}
              value={fmtUSD(display)}
              exact={fmtUSD(display)}
              current={display}
              prior={priorKpis?.depositRevenue ?? null}
              priorLabel={priorLabel}
              periodLabel={periodLabel}
              loading={loading}
              edit={month ? {
                editing: editingMetric === 'deposit_revenue',
                draft: editDraft,
                setDraft: setEditDraft,
                onStartEdit: () => {
                  setEditDraft(String(isOverridden ? override : Math.round(kpis.depositRevenue)));
                  setEditingMetric('deposit_revenue');
                },
                onCancelEdit: () => setEditingMetric(null),
                onSaveEdit: () => {
                  const parsed = parseFloat(editDraft);
                  if (!Number.isFinite(parsed)) {
                    setEditingMetric(null);
                    return;
                  }
                  saveOverride('deposit_revenue', parsed);
                },
                saving: editSaving,
                isOverridden,
              } : undefined}
            />
          );
        })()}
        <KPICard
          cardId="main:headline:refunds"
          label="Refunds"
          Icon={Undo2}
          value={`-${fmtUSD(kpis.refunds)}`}
          exact={`-${fmtUSD(kpis.refunds)}`}
          current={kpis.refunds}
          prior={priorKpis?.refunds ?? null}
          inverse
          priorLabel={priorLabel}
          periodLabel={periodLabel}
          loading={loading}
        />
        <KPICard
          cardId="main:headline:net-revenue"
          label="Net Revenue"
          Icon={TrendingUp}
          value={fmtUSD(kpis.netRevenue)}
          exact={fmtUSD(kpis.netRevenue)}
          current={kpis.netRevenue}
          prior={priorKpis?.netRevenue ?? null}
          priorLabel={priorLabel}
          periodLabel={periodLabel}
          loading={loading}
        />
        <KPICard
          cardId="main:headline:expenses"
          label="Expenses"
          Icon={Receipt}
          value={fmtUSD(kpis.totalExpenses)}
          exact={fmtUSD(kpis.totalExpenses)}
          current={kpis.totalExpenses}
          prior={priorKpis?.expenses ?? null}
          inverse
          priorLabel={priorLabel}
          periodLabel={periodLabel}
          loading={loading}
        />
        <KPICard
          cardId="main:headline:net-profit"
          label="Net Profit"
          Icon={Wallet}
          value={fmtUSD(kpis.netProfit)}
          exact={fmtUSD(kpis.netProfit)}
          current={kpis.netProfit}
          prior={priorKpis?.netProfit ?? null}
          priorLabel={priorLabel}
          periodLabel={periodLabel}
          loading={loading}
        />
        <KPICard
          cardId="main:headline:margin"
          label="Margin %"
          Icon={Percent}
          value={fmtPct(kpis.marginPct)}
          exact={fmtPct(kpis.marginPct)}
          current={kpis.marginPct}
          prior={priorKpis?.marginPct ?? null}
          priorValueFmt={fmtPct}
          priorLabel={priorLabel}
          periodLabel={periodLabel}
          loading={loading}
        />
        {(() => {
          const override = overrides['active_clients'];
          const isOverridden = override !== undefined;
          const display = isOverridden ? override : kpis.activeClients;
          return (
            <KPICard
              cardId="main:headline:active-clients"
              label="Active Clients"
              Icon={Users}
              value={fmtCount(display)}
              exact={fmtCount(display)}
              current={display}
              prior={priorKpis?.activeClients ?? null}
              priorValueFmt={fmtCount}
              priorLabel={priorLabel}
              periodLabel={periodLabel}
              loading={loading}
              edit={month ? {
                editing: editingMetric === 'active_clients',
                draft: editDraft,
                setDraft: setEditDraft,
                onStartEdit: () => {
                  setEditDraft(String(isOverridden ? override : Math.round(kpis.activeClients)));
                  setEditingMetric('active_clients');
                },
                onCancelEdit: () => setEditingMetric(null),
                onSaveEdit: () => {
                  const parsed = parseFloat(editDraft);
                  if (!Number.isFinite(parsed)) {
                    setEditingMetric(null);
                    return;
                  }
                  saveOverride('active_clients', parsed);
                },
                saving: editSaving,
                isOverridden,
                inputPrefix: '',
              } : undefined}
            />
          );
        })()}
      </div>

      {/* Pace legend (matches Metabase footer) */}
      <div className="flex items-center justify-end gap-4 text-[11px] text-gray-500 px-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          on/above pace
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
          just below
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
          off pace
        </span>
      </div>
    </div>
  );
}
