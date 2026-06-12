'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Pencil, Check, X as XIcon, Loader2 } from 'lucide-react';
import type { Lead, Ad } from '@/lib/types';
import type { SheetRevenueSummary } from '@/hooks/useDashboardData';
import type { DateRange } from '@/components/TimeframeSelector';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CloserEodAggregate {
  closer_name: string;
  calls_shown: number;
  calls_closed: number;
  cash_collected: number;
  calls_booked: number;
  offers_given: number;
  no_shows: number;
}

interface MetricRow {
  key: string;
  label: string;
  actual: number;
  /** 'currency' | 'count' | 'percent' — drives formatting + comparison sign */
  format: 'currency' | 'count' | 'percent';
  /** When true, a HIGHER actual vs projection is GOOD (e.g. cash, leads).
   *  When false, a LOWER actual is good (e.g. CPL, cost-per-call). */
  higherIsBetter: boolean;
}

interface MetricSection {
  title: string;
  rows: MetricRow[];
}

interface Props {
  leads: Lead[];
  ads: Ad[];
  sheetRevenue: SheetRevenueSummary;
  dateRange: DateRange;
}

// ─── Formatters ──────────────────────────────────────────────────────────────

const fmtCurrency = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtNumber = (n: number) =>
  Math.round(n).toLocaleString('en-US');

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

function formatValue(v: number, fmt: MetricRow['format']): string {
  if (!Number.isFinite(v)) return '—';
  if (fmt === 'currency') return fmtCurrency(v);
  if (fmt === 'percent') return fmtPct(v);
  return fmtNumber(v);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ProjectionsTab({ leads, ads, sheetRevenue, dateRange }: Props) {
  // Derive YYYY-MM from the dateRange.start (the dashboard already defaults
  // to the first of the current month).
  const month = useMemo(() => dateRange.start.slice(0, 7), [dateRange.start]);

  // ─── Server-side actuals: EOD aggregates (calls scheduled / taken / offers)
  const [eod, setEod] = useState<CloserEodAggregate[]>([]);
  useEffect(() => {
    const qs = `?start=${encodeURIComponent(dateRange.start)}&end=${encodeURIComponent(dateRange.end)}`;
    fetch(`/api/data/closer-eods${qs}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setEod(d); })
      .catch(() => setEod([]));
  }, [dateRange.start, dateRange.end]);

  // ─── Projections (read from Supabase, write inline) ─────────────────────
  const [projections, setProjections] = useState<Record<string, number>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/projections/funnel?month=${month}`)
      .then(r => r.json())
      .then(d => setProjections(d?.projections ?? {}))
      .catch(() => setProjections({}));
  }, [month]);

  const saveProjection = useCallback(async (metric_key: string, projected_value: number) => {
    setSavingKey(metric_key);
    setProjections(prev => ({ ...prev, [metric_key]: projected_value }));
    try {
      await fetch('/api/projections/funnel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ month, metric_key, projected_value }),
      });
    } finally {
      setSavingKey(null);
    }
  }, [month]);

  // ─── Manual actuals overrides (manual_kpi_overrides table) ──────────────
  // Operator can correct a computed actual (e.g. Leads) when the upstream
  // source is wrong. Keyed by metric_key so additional rows can opt in.
  const [actualOverrides, setActualOverrides] = useState<Record<string, number>>({});
  const [editingActualKey, setEditingActualKey] = useState<string | null>(null);
  const [actualSavingKey, setActualSavingKey] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/overrides/kpi?month=${month}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setActualOverrides(d?.overrides ?? {}))
      .catch(() => setActualOverrides({}));
  }, [month]);

  const saveActualOverride = useCallback(async (metric_key: string, value: number) => {
    setActualSavingKey(metric_key);
    setActualOverrides(prev => ({ ...prev, [metric_key]: value }));
    try {
      const res = await fetch('/api/overrides/kpi', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metric_key, month, value }),
      });
      if (!res.ok) {
        // Rollback on failure
        const fresh = await fetch(`/api/overrides/kpi?month=${month}`, { cache: 'no-store' })
          .then(r => r.json()).catch(() => null);
        setActualOverrides(fresh?.overrides ?? {});
      }
    } finally {
      setActualSavingKey(null);
      setEditingActualKey(null);
    }
  }, [month]);

  // ─── Compute actuals from existing dashboard data ───────────────────────
  const actuals = useMemo(() => {
    // Ads & Leads
    const adSpend     = ads.reduce((s, a) => s + (a.spend || 0), 0);
    const clicks      = ads.reduce((s, a) => s + (a.clicks || 0), 0);
    // Prefer Meta-reported leads (same logic as aggregateMetrics's ROAS fix).
    // Operator override (metric_key='projections_leads') wins over both —
    // CPL is recomputed from the override so the two stay reconciled.
    const metaLeads      = ads.reduce((s, a) => s + (a.metaLeads ?? a.leads ?? 0), 0);
    const crmLeads       = leads.length;
    const computedLeads  = metaLeads > 0 ? metaLeads : crmLeads;
    const leadsOverride  = actualOverrides['projections_leads'];
    const leadsActual    = leadsOverride !== undefined ? leadsOverride : computedLeads;
    const cpl            = leadsActual > 0 ? adSpend / leadsActual : 0;

    // Demo Calls (sourced from EOD aggregates — these are the closer's
    // self-reported counts that the team treats as the source of truth)
    const callsScheduled = eod.reduce((s, e) => s + (e.calls_booked || 0), 0);
    const callsTaken     = eod.reduce((s, e) => s + (e.calls_shown || 0), 0);
    const noShows        = eod.reduce((s, e) => s + (e.no_shows || 0), 0);
    const offersMade     = eod.reduce((s, e) => s + (e.offers_given || 0), 0);
    const dealsClosed    = eod.reduce((s, e) => s + (e.calls_closed || 0), 0);
    const showRate       = callsScheduled > 0 ? (callsTaken / callsScheduled) * 100 : 0;
    const closeRate      = callsTaken > 0 ? (dealsClosed / callsTaken) * 100 : 0;

    // Revenue
    const cashCollected  = sheetRevenue.newCash || 0;
    const avgDealSize    = dealsClosed > 0 ? cashCollected / dealsClosed : 0;
    const cashPerCall    = callsTaken > 0 ? cashCollected / callsTaken : 0;
    const roas           = adSpend > 0 ? cashCollected / adSpend : 0;
    const marketingMargin = cashCollected > 0 ? ((cashCollected - adSpend) / cashCollected) * 100 : 0;

    return {
      adSpend, clicks, leadsActual, cpl,
      callsScheduled, callsTaken, noShows, offersMade, dealsClosed, showRate, closeRate,
      cashCollected, avgDealSize, cashPerCall, roas, marketingMargin,
    };
  }, [ads, leads.length, eod, sheetRevenue.newCash, actualOverrides]);

  const sections: MetricSection[] = useMemo(() => ([
    {
      title: 'Ads & Leads',
      rows: [
        { key: 'ad_spend',  label: 'Ad Spend',      actual: actuals.adSpend,     format: 'currency', higherIsBetter: false },
        { key: 'leads',     label: 'Leads',         actual: actuals.leadsActual, format: 'count',    higherIsBetter: true },
        { key: 'cpl',       label: 'Cost Per Lead', actual: actuals.cpl,         format: 'currency', higherIsBetter: false },
        { key: 'clicks',    label: 'Clicks',        actual: actuals.clicks,      format: 'count',    higherIsBetter: true },
      ],
    },
    {
      title: 'Demo Calls',
      rows: [
        { key: 'calls_scheduled', label: 'Calls Scheduled', actual: actuals.callsScheduled, format: 'count',   higherIsBetter: true },
        { key: 'calls_taken',     label: 'Calls Taken',     actual: actuals.callsTaken,     format: 'count',   higherIsBetter: true },
        { key: 'show_rate',       label: 'Show Rate',       actual: actuals.showRate,       format: 'percent', higherIsBetter: true },
        { key: 'offers_made',     label: 'Offers Made',     actual: actuals.offersMade,     format: 'count',   higherIsBetter: true },
        { key: 'close_rate',      label: 'Close Rate',      actual: actuals.closeRate,      format: 'percent', higherIsBetter: true },
      ],
    },
    {
      title: 'Revenue',
      rows: [
        { key: 'cash_collected', label: 'Cash Collected', actual: actuals.cashCollected, format: 'currency', higherIsBetter: true },
        { key: 'deals_closed',   label: 'Deals Closed',   actual: actuals.dealsClosed,   format: 'count',    higherIsBetter: true },
        { key: 'avg_deal_size',  label: 'Avg Deal Size',  actual: actuals.avgDealSize,   format: 'currency', higherIsBetter: true },
        { key: 'cash_per_call',  label: 'Cash Per Call',  actual: actuals.cashPerCall,   format: 'currency', higherIsBetter: true },
      ],
    },
  ]), [actuals]);

  // ─── Variance helper ────────────────────────────────────────────────────
  function variance(actual: number, projected: number | undefined, higherIsBetter: boolean) {
    if (projected === undefined || projected === 0) return { pct: null as number | null, color: 'bg-gray-600' };
    const pct = ((actual - projected) / projected) * 100;
    const isAhead = higherIsBetter ? actual >= projected : actual <= projected;
    return { pct, color: isAhead ? 'bg-green-500' : 'bg-red-500' };
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Headline cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <HeadlineCard label="Cash Collected"    value={fmtCurrency(actuals.cashCollected)} />
        <HeadlineCard label="Ad Spend"          value={fmtCurrency(actuals.adSpend)} />
        <HeadlineCard label="ROAS"              value={`${actuals.roas.toFixed(2)}x`} />
        <HeadlineCard label="Marketing Margin"  value={fmtPct(actuals.marketingMargin)} />
      </div>

      {/* Metric sections */}
      {sections.map(section => (
        <div key={section.title} className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-700">
            <h3 className="text-sm font-semibold text-white">{section.title}</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-xs bg-[#15171c]">
                <th className="text-left py-2 px-5 font-medium">Metric</th>
                <th className="text-right py-2 px-3 font-medium">Actual</th>
                <th className="text-right py-2 px-3 font-medium">Projection</th>
                <th className="text-right py-2 pr-5 font-medium">Variance</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map(row => {
                const projected = projections[row.key];
                const { pct, color } = variance(row.actual, projected, row.higherIsBetter);
                // Only the Leads row supports manual actuals override today.
                // Wire other rows in by mapping their `row.key` → metric_key here.
                const actualOverrideKey = row.key === 'leads' ? 'projections_leads' : null;
                const isOverridden = actualOverrideKey
                  ? actualOverrides[actualOverrideKey] !== undefined
                  : false;
                const isEditingActual = actualOverrideKey
                  ? editingActualKey === actualOverrideKey
                  : false;
                const isSavingActual = actualOverrideKey
                  ? actualSavingKey === actualOverrideKey
                  : false;
                return (
                  <tr key={row.key} className="group/row border-t border-gray-800 hover:bg-[#15171c]">
                    <td className="py-2.5 px-5 text-gray-200">
                      <span className="inline-flex items-center gap-2">
                        {row.label}
                        {isOverridden && !isEditingActual && (
                          <span
                            title="Operator override active"
                            className="text-[9px] uppercase tracking-wider text-amber-400 font-semibold border border-amber-500/30 rounded px-1 py-0.5 leading-none"
                          >
                            edit
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-white tabular-nums">
                      {isEditingActual && actualOverrideKey ? (
                        <ActualOverrideInput
                          value={actualOverrides[actualOverrideKey] ?? row.actual}
                          disabled={isSavingActual}
                          saving={isSavingActual}
                          onSave={(v) => saveActualOverride(actualOverrideKey, v)}
                          onCancel={() => setEditingActualKey(null)}
                        />
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span>{formatValue(row.actual, row.format)}</span>
                          {actualOverrideKey && (
                            <button
                              type="button"
                              onClick={() => setEditingActualKey(actualOverrideKey)}
                              className="opacity-0 group-hover/row:opacity-100 transition-opacity text-gray-500 hover:text-white"
                              title="Override actual value"
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <ProjectionInput
                        value={projected}
                        format={row.format}
                        disabled={savingKey === row.key}
                        onSave={(v) => saveProjection(row.key, v)}
                      />
                    </td>
                    <td className="py-2.5 pr-5 text-right">
                      <div className="inline-flex items-center gap-2 tabular-nums">
                        <span className={`w-2 h-2 rounded-full ${color}`} />
                        <span className="text-gray-300">
                          {pct === null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function HeadlineCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#1a1d23] rounded-xl border border-gray-700 px-5 py-4">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="text-2xl font-semibold text-white tabular-nums">{value}</div>
    </div>
  );
}

interface ProjectionInputProps {
  value: number | undefined;
  format: MetricRow['format'];
  disabled: boolean;
  onSave: (v: number) => void;
}

function ProjectionInput({ value, format, disabled, onSave }: ProjectionInputProps) {
  // Render-as-string so the input doesn't constantly re-format while the
  // user types. Only emit on blur / Enter.
  const [draft, setDraft] = useState<string>(value !== undefined ? String(value) : '');

  useEffect(() => {
    setDraft(value !== undefined ? String(value) : '');
  }, [value]);

  function commit() {
    const parsed = parseFloat(draft.replace(/[^0-9.\-]/g, ''));
    if (!Number.isFinite(parsed)) return;
    if (parsed === value) return;
    onSave(parsed);
  }

  const prefix = format === 'currency' ? '$' : '';
  const suffix = format === 'percent' ? '%' : '';

  return (
    <div className="inline-flex items-center gap-1 bg-[#0f1115] border border-gray-700 rounded px-2 py-1 focus-within:border-blue-500">
      {prefix && <span className="text-gray-500 text-xs">{prefix}</span>}
      <input
        type="text"
        inputMode="decimal"
        className="w-20 bg-transparent text-right text-white text-sm outline-none tabular-nums disabled:opacity-50"
        placeholder="—"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(value !== undefined ? String(value) : '');
        }}
      />
      {suffix && <span className="text-gray-500 text-xs">{suffix}</span>}
    </div>
  );
}

// ─── Inline editor for the Actual cell (manual override).
// Separate from ProjectionInput so it gets its own keyboard handlers
// (Enter to save, Esc to cancel) and explicit Save/Cancel buttons —
// blur-to-save would be too easy to trip accidentally on the dense table.
interface ActualOverrideInputProps {
  value: number;
  disabled: boolean;
  saving: boolean;
  onSave: (v: number) => void;
  onCancel: () => void;
}

function ActualOverrideInput({ value, disabled, saving, onSave, onCancel }: ActualOverrideInputProps) {
  const [draft, setDraft] = useState<string>(String(Math.round(value)));

  function commit() {
    const parsed = parseFloat(draft.replace(/[^0-9.\-]/g, ''));
    if (!Number.isFinite(parsed)) {
      onCancel();
      return;
    }
    onSave(parsed);
  }

  return (
    <div className="inline-flex items-center gap-1">
      <div className="inline-flex items-center gap-1 bg-[#0f1115] border border-blue-600 rounded px-2 py-1">
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          className="w-20 bg-transparent text-right text-white text-sm outline-none tabular-nums disabled:opacity-50"
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '' || /^-?\d*\.?\d*$/.test(v)) setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') onCancel();
          }}
        />
      </div>
      <button
        type="button"
        onClick={commit}
        disabled={disabled}
        className="p-1 rounded bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-300"
        title="Save"
      >
        {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400"
        title="Cancel"
      >
        <XIcon size={11} />
      </button>
    </div>
  );
}
