'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, Check, ChevronDown, ChevronUp } from 'lucide-react';

export interface ModalRow {
  section: 'contracted' | 'cash_collected' | 'receivables' | 'refunds' | 'expenses';
  metric: string;
  kind: 'revenue' | 'expense' | 'refund';
  target_value: number;
  target_units: number | null;
  target_pct: number | null;
  unit_price: number | null;
  ar_base: number | null;
}

interface Props {
  open: boolean;
  month: string;
  rows: ModalRow[];
  onClose: () => void;
  onSaved: () => void;
}

const SECTION_LABEL: Record<ModalRow['section'], string> = {
  contracted: 'Contracted Revenue',
  cash_collected: 'Cash Collected (Upfront)',
  receivables: 'Receivables / Backend',
  refunds: 'Refund Projections',
  expenses: 'Operating Expenses',
};

const SECTION_HINT: Record<ModalRow['section'], string> = {
  contracted: 'Enter # of units and price per unit. Total $ = units × price.',
  cash_collected: 'Enter % UFCC. Total $ auto-computes against contracted target.',
  receivables: 'ProgB BE AR: enter AR base + % expected. Others: enter $ directly.',
  refunds: 'Enter the projected $ refund amount. Lower actuals = better.',
  expenses: 'Enter the $ cap per category. Going over the cap turns the row red.',
};

// Default per-offer prices used when no saved unit_price exists yet for a given
// month. the operator 2026-05-02: Founder Two asked to be able to override these
// inline (offers get repriced periodically), so the modal treats them as
// defaults rather than locks. A saved positive unit_price always wins.
const DEFAULT_UNIT_PRICES: Record<string, number> = {
  'Program A FE': 5000,
  'Program B BE': 20000,
  'Program C': 15000,
};

const priceFor = (metric: string, savedPrice: number | null | undefined): number => {
  const n = Number(savedPrice ?? 0);
  if (Number.isFinite(n) && n > 0) return n;
  return DEFAULT_UNIT_PRICES[metric] ?? 0;
};

const CASH_TO_CONTRACTED: Record<string, string> = {
  'Program A Upfront': 'Program A FE',
  'Program B Upfront': 'Program B BE',
  'Program C Upfront': 'Program C',
};

const SECTION_ORDER: Array<ModalRow['section']> = [
  'contracted',
  'cash_collected',
  'receivables',
  'refunds',
  'expenses',
];

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function recomputeAll(rows: ModalRow[]): ModalRow[] {
  const contractedTargetByMetric = new Map<string, number>();
  rows.forEach((r) => {
    if (r.section === 'contracted') {
      const price = priceFor(r.metric, r.unit_price);
      contractedTargetByMetric.set(r.metric, Number(r.target_units ?? 0) * price);
    }
  });
  return rows.map((r) => {
    if (r.section === 'contracted') {
      const price = priceFor(r.metric, r.unit_price);
      return { ...r, unit_price: price, target_value: Number(r.target_units ?? 0) * price };
    }
    if (r.section === 'cash_collected') {
      const parent = CASH_TO_CONTRACTED[r.metric];
      const base = parent ? contractedTargetByMetric.get(parent) ?? 0 : 0;
      return { ...r, target_value: Number(r.target_pct ?? 0) * base };
    }
    if (r.section === 'receivables' && r.metric === 'Program B BE AR') {
      return { ...r, target_value: Number(r.ar_base ?? 0) * Number(r.target_pct ?? 0) };
    }
    return r;
  });
}

export default function SetTargetsModal({ open, month, rows, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<ModalRow[]>(rows);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) {
      setDraft(recomputeAll(rows.map((r) => ({ ...r }))));
      setError(null);
      setCollapsed({});
    }
  }, [open, rows]);

  // Lock body scroll while modal open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const monthLabel = useMemo(() => {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) return month;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }, [month]);

  const sectionTotals = useMemo(() => {
    const out: Record<ModalRow['section'], number> = {
      contracted: 0,
      cash_collected: 0,
      receivables: 0,
      refunds: 0,
      expenses: 0,
    };
    draft.forEach((r) => {
      out[r.section] += r.target_value || 0;
    });
    return out;
  }, [draft]);

  const projectedRevenue = useMemo(() => {
    return (
      sectionTotals.contracted +
      sectionTotals.receivables -
      sectionTotals.refunds -
      sectionTotals.expenses
    );
  }, [sectionTotals]);

  if (!open) return null;

  const updateRow = (idx: number, patch: Partial<ModalRow>) => {
    setDraft((prev) => recomputeAll(prev.map((r, i) => (i === idx ? { ...r, ...patch } : r))));
  };

  const sections = SECTION_ORDER.map((s) => ({
    section: s,
    rows: draft.map((r, i) => ({ row: r, idx: i })).filter(({ row }) => row.section === s),
  }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/projections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, rows: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? `http_${res.status}`);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save_failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#13161b] border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gradient-to-b from-[#1a1d23] to-[#13161b]">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-blue-400 font-bold">
              Set Projections
            </div>
            <h3 className="text-white font-bold text-lg mt-0.5">{monthLabel}</h3>
            <p className="text-[11px] text-gray-500 mt-1">
              Only fill in green/grey fields. Dollar totals auto-compute where derivable.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Top summary strip */}
        <div className="px-6 py-3 border-b border-gray-800 bg-black/40 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-5 flex-wrap">
            <SummaryStat label="Contracted" value={sectionTotals.contracted} tone="white" />
            <SummaryStat label="Cash Upfront" value={sectionTotals.cash_collected} tone="emerald" />
            <SummaryStat label="Receivables" value={sectionTotals.receivables} tone="emerald" />
            <SummaryStat label="Refunds" value={sectionTotals.refunds} tone="red" />
            <SummaryStat label="OpEx" value={sectionTotals.expenses} tone="amber" />
          </div>
          <div className="flex items-center gap-2 pl-3 border-l border-gray-700">
            <span className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
              Projected Revenue
            </span>
            <span className="text-emerald-300 font-mono font-bold tabular-nums text-base">
              {fmtUSD(projectedRevenue)}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {sections.map(({ section, rows: secRows }) => {
            const isCollapsed = collapsed[section];
            return (
              <div
                key={section}
                className="bg-[#1a1d23] border border-gray-800 rounded-xl overflow-hidden"
              >
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [section]: !c[section] }))}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-black/30 transition-colors"
                >
                  <div>
                    <div className="text-[11px] font-bold text-gray-200 uppercase tracking-wider">
                      {SECTION_LABEL[section]}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{SECTION_HINT[section]}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-emerald-400 font-mono font-bold tabular-nums text-sm">
                      {fmtUSD(sectionTotals[section])}
                    </span>
                    {isCollapsed ? (
                      <ChevronDown size={14} className="text-gray-500" />
                    ) : (
                      <ChevronUp size={14} className="text-gray-500" />
                    )}
                  </div>
                </button>
                {!isCollapsed && (
                  <div className="px-4 pb-4 pt-1 space-y-2">
                    {secRows.map(({ row, idx }) => (
                      <RowEditor key={`${row.section}|${row.metric}`} row={row} idx={idx} update={updateRow} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="px-6 py-2 bg-red-950/60 border-t border-red-900 text-red-300 text-xs">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-800 bg-black/40">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs text-gray-300 hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-60 transition-colors shadow-lg shadow-blue-900/30"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Save All Targets
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'white' | 'emerald' | 'red' | 'amber';
}) {
  const colorClass =
    tone === 'emerald'
      ? 'text-emerald-300'
      : tone === 'red'
        ? 'text-red-300'
        : tone === 'amber'
          ? 'text-amber-300'
          : 'text-white';
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold">{label}</span>
      <span className={`font-mono font-bold tabular-nums text-xs ${colorClass}`}>
        {fmtUSD(value)}
      </span>
    </div>
  );
}

interface RowEditorProps {
  row: ModalRow;
  idx: number;
  update: (idx: number, patch: Partial<ModalRow>) => void;
}

function RowEditor({ row, idx, update }: RowEditorProps) {
  const isContracted = row.section === 'contracted';
  const isCash = row.section === 'cash_collected' || row.section === 'refunds';
  const isAR = row.section === 'receivables' && row.metric === 'Program B BE AR';
  const isFlat = !isContracted && !isCash && !isAR;

  return (
    <div className="bg-black/30 border border-gray-800 rounded-lg px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-white font-semibold">{row.metric}</div>
        <div className="text-xs text-emerald-300 font-mono font-bold tabular-nums">
          {fmtUSD(row.target_value)}
        </div>
      </div>

      {isContracted && (
        <div className="grid grid-cols-2 gap-3">
          <NiceField
            label="Units"
            value={row.target_units}
            onChange={(v) => update(idx, { target_units: v })}
            mode="integer"
            big
          />
          <NiceField
            label="Price / unit"
            prefix="$"
            value={priceFor(row.metric, row.unit_price)}
            onChange={(v) => update(idx, { unit_price: v })}
            mode="currency"
            big
          />
        </div>
      )}

      {row.section === 'cash_collected' && (
        <div className="grid grid-cols-1 gap-3">
          <NiceField
            label="% of contracted upfront"
            value={row.target_pct != null ? row.target_pct * 100 : null}
            onChange={(v) => update(idx, { target_pct: v != null ? v / 100 : null })}
            suffix="%"
            mode="percent"
            big
          />
        </div>
      )}

      {isAR && (
        <div className="grid grid-cols-2 gap-3">
          <NiceField
            label="AR base"
            prefix="$"
            value={row.ar_base}
            onChange={(v) => update(idx, { ar_base: v })}
            mode="currency"
            big
          />
          <NiceField
            label="% expected"
            suffix="%"
            value={row.target_pct != null ? row.target_pct * 100 : null}
            onChange={(v) => update(idx, { target_pct: v != null ? v / 100 : null })}
            mode="percent"
            big
          />
        </div>
      )}

      {row.section === 'refunds' && (
        <div className="grid grid-cols-1 gap-3">
          <NiceField
            label="Projected refund $"
            prefix="$"
            value={row.target_value}
            onChange={(v) => update(idx, { target_value: v ?? 0 })}
            mode="currency"
            big
          />
        </div>
      )}

      {isFlat && row.section !== 'refunds' && (
        <div className="grid grid-cols-1 gap-3">
          <NiceField
            label={row.section === 'expenses' ? 'Cap $' : 'Total $'}
            prefix="$"
            value={row.target_value}
            onChange={(v) => update(idx, { target_value: v ?? 0 })}
            mode="currency"
            big
          />
        </div>
      )}
    </div>
  );
}

interface NiceFieldProps {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  prefix?: string;
  suffix?: string;
  mode?: 'integer' | 'currency' | 'percent' | 'decimal';
  big?: boolean;
}

function NiceField({ label, value, onChange, prefix, suffix, mode = 'decimal', big }: NiceFieldProps) {
  // Local string state so the user can type freely (e.g. "10.", "0.5", empty).
  const [text, setText] = useState<string>(value == null ? '' : formatForEdit(value, mode));
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external value changes (e.g. when recomputeAll runs) back into local text,
  // unless the user is currently focused (don't clobber what they're typing).
  useEffect(() => {
    if (focused) return;
    setText(value == null ? '' : formatForEdit(value, mode));
  }, [value, mode, focused]);

  const handleChange = (next: string) => {
    // Allow only valid partial-numeric input.
    if (next === '' || /^-?\d*\.?\d*$/.test(next)) {
      setText(next);
      if (next === '' || next === '-' || next === '.') {
        onChange(null);
      } else {
        const n = Number(next);
        if (!Number.isNaN(n)) onChange(n);
      }
    }
  };

  const sizing = big
    ? 'px-3.5 py-2.5 text-base'
    : 'px-3 py-2 text-sm';

  return (
    <label className="block">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div
        className={`flex items-center gap-1.5 bg-black/40 border rounded-lg ${sizing} transition-colors cursor-text ${
          focused ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-700 hover:border-gray-600'
        }`}
        onClick={() => inputRef.current?.focus()}
      >
        {prefix && (
          <span className="text-gray-500 font-mono select-none">{prefix}</span>
        )}
        <input
          ref={inputRef}
          inputMode="decimal"
          value={text}
          onFocus={(e) => {
            setFocused(true);
            e.currentTarget.select();
          }}
          onBlur={() => setFocused(false)}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="0"
          className="w-full bg-transparent outline-none text-white tabular-nums font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        {suffix && (
          <span className="text-gray-500 font-mono select-none">{suffix}</span>
        )}
      </div>
    </label>
  );
}

function formatForEdit(n: number, mode: NonNullable<NiceFieldProps['mode']>): string {
  if (!Number.isFinite(n)) return '';
  if (mode === 'integer') return String(Math.trunc(n));
  // Trim trailing zeros, but keep up to 4 decimals.
  const fixed = n.toFixed(4);
  return fixed.replace(/\.?0+$/, '');
}
