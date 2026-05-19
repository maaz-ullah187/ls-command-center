'use client';

import { useEffect, useMemo, useState } from 'react';
import { Pencil, Check, X, Loader2, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react';
import CardFeedbackMenu from './CardFeedbackMenu';
import SetTargetsModal, { ModalRow } from './SetTargetsModal';
import { useTimeframe } from '@/lib/useTimeframe';

type Section = 'contracted' | 'cash_collected' | 'receivables' | 'refunds' | 'expenses';
type Kind = 'revenue' | 'expense' | 'refund';
type Status = 'ahead' | 'on_pace' | 'behind' | 'critical' | 'under' | 'at_cap' | 'over_cap';

interface ProjectionRow {
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

interface SectionTotals { target: number; actual: number }
interface ApiResponse {
  month: string;
  expected_pace: number;
  rows: ProjectionRow[];
  totals: Record<Section, SectionTotals>;
  projected_revenue: SectionTotals;
}

/**
 * Pace-adjusted % for revenue/refund rows: `actual / (target × expected_pace)`.
 * Returns null when pace adjustment doesn't apply (expense rows where pacing is
 * inverse, or zero target/pace).
 */
function paceAdjustedPct(row: ProjectionRow, expectedPace: number): number | null {
  if (row.kind !== 'revenue') return null;
  if (row.target_value <= 0 || expectedPace <= 0) return null;
  return row.actual_value / (row.target_value * expectedPace);
}

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${(n * 100).toFixed(0)}%`;

const STATUS_PILL: Record<Status, string> = {
  ahead: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/40',
  on_pace: 'bg-blue-900/40 text-blue-300 border-blue-800/40',
  behind: 'bg-amber-900/40 text-amber-300 border-amber-800/40',
  critical: 'bg-red-900/40 text-red-300 border-red-800/40',
  under: 'bg-gray-800 text-gray-400 border-gray-700',
  at_cap: 'bg-amber-900/40 text-amber-300 border-amber-800/40',
  over_cap: 'bg-red-900/40 text-red-300 border-red-800/40',
};

const ROW_BG: Record<Status, string> = {
  ahead: 'bg-emerald-900/10',
  on_pace: '',
  behind: 'bg-amber-900/10',
  critical: 'bg-red-900/15',
  under: '',
  at_cap: 'bg-amber-900/10',
  over_cap: 'bg-red-900/15',
};

const SECTION_LABEL: Record<Section, string> = {
  contracted: 'Contracted Revenue',
  cash_collected: 'Cash Collected (Upfront)',
  receivables: 'Receivables / Backend',
  refunds: 'Refund Projections',
  expenses: 'Operating Expenses',
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return currentMonth();
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

export default function PaceVsProjection() {
  const tf = useTimeframe();
  // the operator 2026-05-01: sync this card's month with the global timeframe
  // filter. User can still click `< >` arrows on this card to override.
  const tfMonth = (tf.from && /^\d{4}-\d{2}/.test(tf.from)) ? tf.from.slice(0, 7) : currentMonth();
  const [month, setMonth] = useState<string>(tfMonth);
  // When the global timeframe changes, snap this card to the new month
  // so picking "Last Month" updates everything in lockstep.
  useEffect(() => { setMonth(tfMonth); }, [tfMonth]);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ value: string; value2: string; reason: string }>({
    value: '',
    value2: '',
    reason: '',
  });
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Cache-bust the URL — without this the browser/edge can return a
    // stale response. the operator 2026-04-30: "it's a 50-50 chance the
    // actuals even pull in." Same pattern we use on RevenueComposition.
    const load = () => {
      fetch(`/api/projections?month=${month}&_t=${Date.now()}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d: ApiResponse) => {
          if (cancelled) return;
          setData(d);
        })
        .catch(() => {
          if (!cancelled) setData(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    // Refetch when the team categorizes a row in the queue — projections
    // depend on t07 payment_type so they need to react in real time.
    const onCategorized = () => load();
    if (typeof window !== 'undefined') {
      window.addEventListener('billing:categorized', onCategorized);
      window.addEventListener('expense:categorized', onCategorized);
    }
    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('billing:categorized', onCategorized);
        window.removeEventListener('expense:categorized', onCategorized);
      }
    };
  }, [month, tick]);

  const startEdit = (r: ProjectionRow) => {
    setEditingId(`${r.section}|${r.metric}`);
    if (r.section === 'contracted') {
      setDraft({ value: String(r.target_units ?? ''), value2: '', reason: r.reason ?? '' });
    } else if (r.section === 'cash_collected') {
      setDraft({
        value: r.target_pct != null ? String(r.target_pct * 100) : '',
        value2: '',
        reason: r.reason ?? '',
      });
    } else if (r.section === 'receivables' && r.metric === 'Program B BE AR') {
      setDraft({
        value: String(r.ar_base ?? ''),
        value2: r.target_pct != null ? String(r.target_pct * 100) : '',
        reason: r.reason ?? '',
      });
    } else {
      setDraft({ value: String(r.target_value), value2: '', reason: r.reason ?? '' });
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft({ value: '', value2: '', reason: '' });
  };

  const saveEdit = async (r: ProjectionRow) => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        month,
        section: r.section,
        metric: r.metric,
        kind: r.kind,
        reason: draft.reason || null,
      };
      if (r.section === 'contracted') {
        payload.target_units = draft.value === '' ? null : Number(draft.value);
        payload.target_pct = r.target_pct;
        payload.unit_price = r.unit_price;
        payload.ar_base = r.ar_base;
      } else if (r.section === 'cash_collected') {
        payload.target_units = r.target_units;
        payload.target_pct = draft.value === '' ? null : Number(draft.value) / 100;
        payload.unit_price = r.unit_price;
        payload.ar_base = r.ar_base;
      } else if (r.section === 'receivables' && r.metric === 'Program B BE AR') {
        payload.target_units = r.target_units;
        payload.ar_base = draft.value === '' ? null : Number(draft.value);
        payload.target_pct = draft.value2 === '' ? null : Number(draft.value2) / 100;
        payload.unit_price = r.unit_price;
      } else {
        payload.target_value = Number(draft.value);
        payload.target_units = r.target_units;
        payload.target_pct = r.target_pct;
        payload.unit_price = r.unit_price;
        payload.ar_base = r.ar_base;
      }
      const res = await fetch('/api/projections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        alert(`Save failed: ${result?.error ?? res.status}`);
        return;
      }
      setEditingId(null);
      setTick((t) => t + 1);
      // Notify other cards (Revenue Trajectory) that targets changed so
      // they refetch immediately. the operator 2026-04-30: "when I set the
      // new projection target, the graph should also update."
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('targets:saved', { detail: { month } }));
      }
    } finally {
      setSaving(false);
    }
  };

  const grouped = useMemo(() => {
    if (!data) return null;
    const out: Array<{ section: Section; rows: ProjectionRow[] }> = [];
    for (const s of ['contracted', 'cash_collected', 'receivables', 'refunds', 'expenses'] as Section[]) {
      out.push({ section: s, rows: data.rows.filter((r) => r.section === s) });
    }
    return out;
  }, [data]);

  const modalRows: ModalRow[] = useMemo(
    () =>
      (data?.rows ?? []).map((r) => ({
        section: r.section,
        metric: r.metric,
        kind: r.kind,
        target_value: r.target_value,
        target_units: r.target_units,
        target_pct: r.target_pct,
        unit_price: r.unit_price,
        ar_base: r.ar_base,
      })),
    [data],
  );

  return (
    <div className="group bg-[#1a1d23] border border-gray-800 rounded-xl overflow-visible">
      <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-white font-bold text-base tracking-tight">MTD Pace vs Projection</h2>
          <p className="text-xs text-gray-400 mt-1">
            Click any target to edit · pace expected{' '}
            <span className="text-gray-200 font-medium">{data ? fmtPct(data.expected_pace) : '—'}</span> through today
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center bg-black/30 border border-gray-700 rounded-md">
            <button
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
              className="px-2 py-1 text-gray-400 hover:text-white"
              title="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value || currentMonth())}
              className="bg-transparent text-white text-xs font-medium px-2 py-1 outline-none w-[140px] text-center"
            />
            <button
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
              className="px-2 py-1 text-gray-400 hover:text-white"
              title="Next month"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <button
            onClick={() => setMonth(currentMonth())}
            className="px-2 py-1 rounded text-[11px] text-gray-300 hover:bg-gray-800"
            title="Jump to current month"
          >
            This Month
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-600/30 hover:bg-blue-600/50 border border-blue-700/40 text-blue-200 text-[11px] font-medium"
            title="Set all targets for this month"
          >
            <Settings2 size={12} /> Set Targets
          </button>
          <CardFeedbackMenu cardId="main:pace-vs-projection" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-black/20">
            <tr className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">
              <th className="text-left px-5 py-3">Metric</th>
              <th className="text-right px-3 py-3">Target</th>
              <th className="text-right px-3 py-3">Actual</th>
              <th className="text-right px-3 py-3">% of Target</th>
              <th
                className="text-right px-3 py-3"
                title="actual ÷ pace-adjusted target. >100% = ahead of pace, <100% = behind."
              >
                % of Pace
              </th>
              <th className="text-left px-3 py-3">Status</th>
              <th className="px-3 py-3 text-left">Note</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-500">
                  <Loader2 size={14} className="inline animate-spin mr-2" /> Loading {formatMonthLabel(month)}…
                </td>
              </tr>
            ) : !grouped ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-gray-500">
                  Failed to load projections.{' '}
                  <button onClick={() => setTick((t) => t + 1)} className="text-blue-400 hover:text-blue-300 underline">
                    Retry
                  </button>
                </td>
              </tr>
            ) : data && data.rows.length > 0 && data.rows.every((r) => r.actual_value === 0) && new Date(month + '-15') < new Date() ? (
              // Defensive: rows present but every actual_value is 0 even
              // though the month is past or in-progress. Almost certainly a
              // stale browser bundle or a transient API hiccup. Don't
              // silently render "$0 across the board" — make it loud and
              // give the operator a one-click retry. the operator 2026-04-30.
              <tr>
                <td colSpan={7} className="text-center py-10">
                  <div className="text-amber-300 font-semibold mb-1">⚠ All actuals returned as $0</div>
                  <div className="text-xs text-gray-400 mb-3">
                    This usually means a stale browser tab. Try a hard-refresh (Cmd+Shift+R) or click below.
                  </div>
                  <button
                    onClick={() => setTick((t) => t + 1)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600/30 hover:bg-blue-600/50 border border-blue-700/40 text-blue-200 text-xs font-medium"
                  >
                    <Loader2 size={12} /> Retry fetch
                  </button>
                </td>
              </tr>
            ) : (
              grouped.map(({ section, rows }) => {
                const totals = data!.totals[section];
                const sectionPct = totals.target > 0 ? totals.actual / totals.target : 0;
                return (
                  <SectionGroup
                    key={section}
                    section={section}
                    rows={rows}
                    totals={totals}
                    sectionPct={sectionPct}
                    expectedPace={data!.expected_pace}
                    editingId={editingId}
                    draft={draft}
                    saving={saving}
                    loading={loading}
                    setDraft={setDraft}
                    startEdit={startEdit}
                    cancelEdit={cancelEdit}
                    saveEdit={saveEdit}
                  />
                );
              })
            )}
            {data && (
              <tr className="border-t-2 border-gray-700 bg-black/40">
                <td className="px-5 py-3 text-white font-bold uppercase tracking-wider text-xs">
                  Projected Revenue
                </td>
                <td className="px-3 py-3 text-right text-white font-bold tabular-nums">
                  {fmtUSD(data.projected_revenue.target)}
                </td>
                <td className="px-3 py-3 text-right text-emerald-300 font-bold tabular-nums">
                  {fmtUSD(data.projected_revenue.actual)}
                </td>
                <td className="px-3 py-3 text-right text-white font-bold tabular-nums">
                  {data.projected_revenue.target > 0
                    ? fmtPct(data.projected_revenue.actual / data.projected_revenue.target)
                    : '—'}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">
                  {data.projected_revenue.target > 0 && data.expected_pace > 0
                    ? (() => {
                        const p = data.projected_revenue.actual / (data.projected_revenue.target * data.expected_pace);
                        const cls = p >= 1 ? 'text-emerald-300' : p >= 0.85 ? 'text-amber-300' : 'text-red-300';
                        return <span className={cls}>{fmtPct(p)}</span>;
                      })()
                    : <span className="text-gray-600">—</span>}
                </td>
                <td colSpan={2} className="px-3 py-3" />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <SetTargetsModal
        open={modalOpen}
        month={month}
        rows={modalRows}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setTick((t) => t + 1);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('targets:saved', { detail: { month } }));
          }
        }}
      />
    </div>
  );
}

interface SectionGroupProps {
  section: Section;
  rows: ProjectionRow[];
  totals: SectionTotals;
  sectionPct: number;
  expectedPace: number;
  editingId: string | null;
  draft: { value: string; value2: string; reason: string };
  saving: boolean;
  loading: boolean;
  setDraft: (d: { value: string; value2: string; reason: string }) => void;
  startEdit: (r: ProjectionRow) => void;
  cancelEdit: () => void;
  saveEdit: (r: ProjectionRow) => void;
}

function SectionGroup({
  section,
  rows,
  totals,
  sectionPct,
  expectedPace,
  editingId,
  draft,
  saving,
  loading,
  setDraft,
  startEdit,
  cancelEdit,
  saveEdit,
}: SectionGroupProps) {
  return (
    <>
      <tr className="bg-black/30 border-t border-gray-800">
        <td colSpan={7} className="px-5 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-200 inline-flex items-center gap-2">
              {SECTION_LABEL[section]}
              {loading && <Loader2 size={11} className="animate-spin opacity-60" />}
            </span>
            <span className="text-xs text-gray-400 tabular-nums">
              {loading ? (
                <span className="opacity-60">— / {fmtUSD(totals.target)}</span>
              ) : (
                <>
                  {fmtUSD(totals.actual)} / {fmtUSD(totals.target)}
                  {totals.target > 0 ? <span className="ml-2 text-gray-300 font-medium">({fmtPct(sectionPct)})</span> : null}
                </>
              )}
            </span>
          </div>
        </td>
      </tr>
      {rows.map((r) => {
        const id = `${r.section}|${r.metric}`;
        const isEditing = editingId === id;
        return (
          <tr
            key={id}
            className={`border-t border-gray-800/60 hover:bg-black/20 ${ROW_BG[r.status]}`}
          >
            <td className="px-5 py-2 text-white">
              <div className="font-medium">{r.metric}</div>
              <SubText row={r} />
            </td>
            <td className="px-3 py-2 text-right">
              {isEditing ? (
                <EditInputs
                  row={r}
                  draft={draft}
                  setDraft={setDraft}
                  saving={saving}
                  onSave={() => saveEdit(r)}
                  onCancel={cancelEdit}
                />
              ) : (
                <button
                  onClick={() => startEdit(r)}
                  className="group inline-flex items-center gap-1.5 text-gray-200 hover:text-white"
                  title="Click to edit target"
                >
                  <span className="tabular-nums">{fmtUSD(r.target_value)}</span>
                  <Pencil
                    size={11}
                    className="opacity-0 group-hover:opacity-100 text-gray-500"
                  />
                </button>
              )}
            </td>
            <td className="px-3 py-2 text-right text-emerald-400 tabular-nums">
              {loading ? (
                <Loader2 size={12} className="inline animate-spin opacity-60" />
              ) : (
                fmtUSD(r.actual_value)
              )}
            </td>
            <td className="px-3 py-2 text-right text-gray-300 tabular-nums">
              {loading ? (
                <span className="text-gray-600">—</span>
              ) : r.target_value > 0 ? (
                fmtPct(r.pct_of_target)
              ) : (
                '—'
              )}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {loading ? (
                <span className="text-gray-600">—</span>
              ) : (
                (() => {
                  const pct = paceAdjustedPct(r, expectedPace);
                  if (pct === null) return <span className="text-gray-600">—</span>;
                  const cls = pct >= 1 ? 'text-emerald-300' : pct >= 0.85 ? 'text-amber-300' : 'text-red-300';
                  return <span className={cls}>{fmtPct(pct)}</span>;
                })()
              )}
            </td>
            <td className="px-3 py-2">
              <span
                className={`inline-flex px-2 py-0.5 rounded border text-[11px] font-semibold uppercase tracking-wider ${
                  STATUS_PILL[r.status]
                }`}
              >
                {r.status.replace('_', ' ')}
              </span>
            </td>
            <td className="px-3 py-2 text-xs text-gray-400">
              {r.reason ? (
                <span title={`${r.updated_by ?? ''} · ${r.updated_at ?? ''}`}>{r.reason}</span>
              ) : null}
            </td>
          </tr>
        );
      })}
    </>
  );
}

interface EditInputsProps {
  row: ProjectionRow;
  draft: { value: string; value2: string; reason: string };
  setDraft: (d: { value: string; value2: string; reason: string }) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}

function EditInputs({ row, draft, setDraft, saving, onSave, onCancel }: EditInputsProps) {
  const isContracted = row.section === 'contracted';
  const isCash = row.section === 'cash_collected';
  const isAR = row.section === 'receivables' && row.metric === 'Program B BE AR';
  const isFlat = !isContracted && !isCash && !isAR;

  return (
    <div className="inline-flex items-center gap-1.5">
      {isContracted && (
        <NumberInput
          autoFocus
          value={draft.value}
          onChange={(v) => setDraft({ ...draft, value: v })}
          suffix="units"
          width="w-24"
        />
      )}
      {isCash && (
        <NumberInput
          autoFocus
          value={draft.value}
          onChange={(v) => setDraft({ ...draft, value: v })}
          suffix="%"
          width="w-20"
        />
      )}
      {isAR && (
        <>
          <NumberInput
            autoFocus
            value={draft.value}
            onChange={(v) => setDraft({ ...draft, value: v })}
            prefix="$"
            width="w-28"
          />
          <NumberInput
            value={draft.value2}
            onChange={(v) => setDraft({ ...draft, value2: v })}
            suffix="%"
            width="w-16"
          />
        </>
      )}
      {isFlat && (
        <NumberInput
          autoFocus
          value={draft.value}
          onChange={(v) => setDraft({ ...draft, value: v })}
          prefix="$"
          width="w-28"
        />
      )}
      <input
        type="text"
        placeholder="reason"
        value={draft.reason}
        onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
        className="w-28 bg-black/40 border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none"
      />
      <button
        onClick={onSave}
        disabled={saving}
        className="p-1 rounded bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-300"
        title="Save"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
      </button>
      <button
        onClick={onCancel}
        className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400"
        title="Cancel"
      >
        <X size={12} />
      </button>
    </div>
  );
}

interface NumberInputProps {
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  width?: string;
  autoFocus?: boolean;
}

function NumberInput({ value, onChange, prefix, suffix, width = 'w-24', autoFocus }: NumberInputProps) {
  return (
    <div
      className={`inline-flex items-center gap-1 bg-black/40 border border-blue-700 rounded px-2 py-0.5 ${width}`}
    >
      {prefix && <span className="text-[11px] text-gray-500">{prefix}</span>}
      <input
        autoFocus={autoFocus}
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '' || /^-?\d*\.?\d*$/.test(v)) onChange(v);
        }}
        className="w-full bg-transparent outline-none text-right text-white text-xs tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      {suffix && <span className="text-[11px] text-gray-500">{suffix}</span>}
    </div>
  );
}

function SubText({ row }: { row: ProjectionRow }) {
  const parts: string[] = [];
  if (row.target_units != null && row.unit_price != null) {
    parts.push(
      `${row.target_units} units × ${row.unit_price.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`,
    );
  } else if (row.target_pct != null) {
    parts.push(`${(row.target_pct * 100).toFixed(0)}%`);
    if (row.ar_base != null) {
      parts.push(
        `of ${row.ar_base.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} base`,
      );
    }
  }
  if (parts.length === 0) return null;
  return <div className="text-[10px] text-gray-500 mt-0.5">{parts.join(' · ')}</div>;
}
