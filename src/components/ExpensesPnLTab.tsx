'use client';

import { useMemo, useState } from 'react';
import { Client, Expense } from '@/lib/types';
import { getPnLSummary } from '@/lib/mock-data';

// the operator 2026-05-01: inline-edit categories per row, mirrors the
// /api/expense/categorize endpoint that the daily review queue uses.
const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'marketing', label: 'Marketing' },
  { value: 'labour', label: 'Labor' },
  { value: 'overhead', label: 'Overhead' },
  { value: 'coaching', label: 'Coaching' },
  { value: 'mastermind', label: 'Mastermind' },
  { value: 'other', label: 'Other' },
  { value: 'unknown', label: 'Unknown' },
  { value: "personal (shouldn't be there)", label: "Personal (shouldn't be there)" },
];

interface ExpensesPnLTabProps {
  frontEndCash: number;
  clients: Client[];
  expenses: Expense[];
}

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtPrecise = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

// Display card groupings with their constituent raw categories
const CARD_GROUPS: {
  key: string;
  label: string;
  categories: Expense['category'][];
  color: string;
  text: string;
  border: string;
  // P&L bucket this rolls up into
  pnlBucket: 'overhead' | 'labor' | 'marketing';
}[] = [
  {
    key: 'marketing',
    label: 'Marketing',
    categories: ['marketing'],
    color: 'bg-amber-500',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
    pnlBucket: 'marketing',
  },
  {
    key: 'sales_labor',
    label: 'Sales Labor',
    categories: ['sales_labor'],
    color: 'bg-purple-500',
    text: 'text-purple-400',
    border: 'border-purple-500/30',
    pnlBucket: 'labor',
  },
  {
    key: 'fulfillment',
    label: 'Fulfillment',
    categories: ['fulfillment'],
    color: 'bg-indigo-500',
    text: 'text-indigo-400',
    border: 'border-indigo-500/30',
    pnlBucket: 'labor',
  },
  {
    key: 'operations',
    label: 'Operations',
    categories: ['ops', 'ai_team'],
    color: 'bg-teal-500',
    text: 'text-teal-400',
    border: 'border-teal-500/30',
    pnlBucket: 'labor',
  },
  {
    key: 'csm_coaching',
    label: 'CSM & Coaching',
    categories: ['csm_team', 'program_coaches'],
    color: 'bg-rose-500',
    text: 'text-rose-400',
    border: 'border-rose-500/30',
    pnlBucket: 'labor',
  },
  {
    key: 'overhead',
    label: 'Overhead (SaaS/Tools)',
    categories: ['overhead'],
    color: 'bg-blue-500',
    text: 'text-blue-400',
    border: 'border-blue-500/30',
    pnlBucket: 'overhead',
  },
];

// P&L-level targets (% of revenue)
const PNL_TARGETS: Record<string, number> = {
  overhead: 10,
  labor: 25,
  marketing: 25,
};

export default function ExpensesPnLTab({ frontEndCash, clients, expenses }: ExpensesPnLTabProps) {
  const pnl = useMemo(() => getPnLSummary(clients, expenses, frontEndCash), [clients, expenses, frontEndCash]);

  const cardData = useMemo(() => {
    return CARD_GROUPS.map((group) => {
      const items = expenses.filter((e) => group.categories.includes(e.category));
      const total = items.reduce((s, e) => s + e.amount, 0);
      const pctOfRevenue = pnl.totalRevenue > 0 ? (total / pnl.totalRevenue) * 100 : 0;
      return { ...group, items, total, pctOfRevenue };
    });
  }, [pnl, expenses]);

  const refunds = useMemo(() => clients.reduce((s, c) => s + c.refundAmount, 0), [clients]);
  const backEndCash = useMemo(() => clients.reduce((s, c) => s + c.upsellCash + c.mastermindCash + c.referralCashCollected, 0), [clients]);
  const arCollections = useMemo(() => clients.reduce((s, c) => s + c.arCollected, 0), [clients]);

  // Compute actual % of revenue for each P&L bucket
  const overheadPct = pnl.totalRevenue > 0 ? (pnl.overheadExpenses / pnl.totalRevenue) * 100 : 0;
  const laborPct = pnl.totalRevenue > 0 ? (pnl.laborExpenses / pnl.totalRevenue) * 100 : 0;
  const marketingPct = pnl.totalRevenue > 0 ? (pnl.marketingExpenses / pnl.totalRevenue) * 100 : 0;

  const marginColor =
    pnl.profitMargin >= 30 ? 'text-emerald-400' :
    pnl.profitMargin >= 15 ? 'text-yellow-400' :
    'text-red-400';

  return (
    <div className="space-y-6">
      {/* Section 1: P&L Summary */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-6 tracking-wide">Profit & Loss Statement</h2>

        <div className="font-mono text-sm space-y-1">
          {/* Revenue Section */}
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2">Revenue</div>

          <PnLRow label="Front-End Cash Collected" value={fmt(frontEndCash)} valueClass="text-gray-300" />
          <PnLRow label="Back-End Cash (Upsells/MM)" value={fmt(backEndCash)} valueClass="text-gray-300" />
          <PnLRow label="AR Collections" value={fmt(arCollections)} valueClass="text-gray-300" />

          <div className="border-t border-gray-700 my-2" />

          <PnLRow label="Total Revenue" value={fmt(pnl.totalRevenue)} valueClass="text-emerald-400 font-bold" labelClass="font-bold text-white" />

          <div className="h-4" />

          {/* Expenses Section */}
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2">Expenses</div>

          <PnLRowWithTarget
            label="Overhead"
            value={fmt(pnl.overheadExpenses)}
            actualPct={overheadPct}
            targetPct={PNL_TARGETS.overhead}
          />
          <PnLRowWithTarget
            label="Labor"
            value={fmt(pnl.laborExpenses)}
            actualPct={laborPct}
            targetPct={PNL_TARGETS.labor}
          />
          <PnLRowWithTarget
            label="Marketing"
            value={fmt(pnl.marketingExpenses)}
            actualPct={marketingPct}
            targetPct={PNL_TARGETS.marketing}
          />
          <PnLRow label="Refunds" value={fmt(refunds)} valueClass="text-gray-300" />

          <div className="border-t border-gray-700 my-2" />

          <PnLRow label="Total Expenses" value={fmt(pnl.totalExpenses)} valueClass="text-red-400 font-bold" labelClass="font-bold text-white" />

          <div className="h-4" />

          {/* Net Section */}
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2">Net</div>

          <div className="border-t-2 border-gray-600 my-2" />

          <PnLRow
            label="Total Profit"
            value={fmt(pnl.totalProfit)}
            valueClass={`font-bold ${pnl.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
            labelClass="font-bold text-white"
          />
          <PnLRow
            label="Profit Margin"
            value={fmtPct(pnl.profitMargin)}
            valueClass={`font-bold ${marginColor}`}
            labelClass="font-bold text-white"
          />
        </div>
      </div>

      {/* Section 2: Expense Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cardData.map((card) => {
          const targetPct = PNL_TARGETS[card.pnlBucket];
          // For display, we show this card's % of revenue vs the parent bucket target
          const isOver = card.pctOfRevenue > targetPct;

          return (
            <div key={card.key} className="bg-[#1a1d23] rounded-xl border border-gray-700 p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-sm ${card.color}`} />
                  <h3 className={`text-base font-semibold ${card.text}`}>{card.label}</h3>
                </div>
                <span className="text-white font-bold text-base">{fmt(card.total)}</span>
              </div>

              <div className="flex items-center gap-3 mb-4">
                <span className={`text-xs font-medium ${card.pctOfRevenue <= targetPct ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtPct(card.pctOfRevenue)} of revenue
                </span>
                <span className="text-xs text-gray-600">|</span>
                <span className="text-xs text-gray-500">
                  Target: {fmtPct(targetPct)} ({card.pnlBucket})
                </span>
              </div>

              {/* Proportion bar showing % of revenue vs target */}
              <div className="relative w-full h-2 bg-gray-800 rounded-full mb-4 overflow-hidden">
                <div
                  className={`h-full rounded-full ${isOver ? 'bg-red-500' : card.color}`}
                  style={{ width: `${Math.min(card.pctOfRevenue / Math.max(targetPct, 1) * 100, 100)}%` }}
                />
              </div>

              {/* Line items */}
              <div className="space-y-2">
                {card.items.map((exp) => (
                  <div key={exp.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-gray-400 truncate">{exp.description}</span>
                    </div>
                    <span className="text-gray-300 font-medium shrink-0 ml-3 tabular-nums">
                      {exp.amount < 100 ? fmtPrecise(exp.amount) : fmt(Math.round(exp.amount))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Section 3: Expense Distribution Visual */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-6">
        <h3 className="text-base font-semibold text-white mb-4">Expense Distribution</h3>

        {/* Stacked horizontal bar */}
        <div className="w-full h-8 bg-gray-800 rounded-full overflow-hidden flex mb-2">
          {cardData.map((card) => {
            const pct = pnl.totalExpenses > 0 ? (card.total / pnl.totalExpenses) * 100 : 0;
            if (pct <= 0) return null;
            return (
              <div
                key={card.key}
                className={`h-full ${card.color} flex items-center justify-center text-xs text-white font-medium transition-all`}
                style={{ width: `${pct}%` }}
                title={`${card.label}: ${fmtPct(pct)}`}
              >
                {pct >= 8 && <span>{fmtPct(pct)}</span>}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-6">
          {cardData.map((card) => {
            const pct = pnl.totalExpenses > 0 ? (card.total / pnl.totalExpenses) * 100 : 0;
            return (
              <div key={card.key} className="flex items-center gap-1.5 text-xs text-gray-400">
                <div className={`w-2.5 h-2.5 rounded-sm ${card.color}`} />
                <span>{card.label} ({fmtPct(pct)})</span>
              </div>
            );
          })}
        </div>

        {/* P&L Bucket Targets */}
        <h4 className="text-sm font-semibold text-gray-400 mb-3">P&L Bucket Targets (% of Revenue)</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Marketing', actual: marketingPct, target: PNL_TARGETS.marketing, color: 'text-amber-400' },
            { label: 'Labor', actual: laborPct, target: PNL_TARGETS.labor, color: 'text-purple-400' },
            { label: 'Overhead', actual: overheadPct, target: PNL_TARGETS.overhead, color: 'text-blue-400' },
          ].map((bucket) => {
            const isUnder = bucket.actual <= bucket.target;
            return (
              <div key={bucket.label} className="bg-[#0f1117] rounded-lg p-4 border border-gray-700/50">
                <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">{bucket.label}</div>
                <div className="flex items-baseline gap-2">
                  <span className={`text-xl font-bold tabular-nums ${isUnder ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtPct(bucket.actual)}
                  </span>
                  <span className="text-sm text-gray-500">/ {fmtPct(bucket.target)} target</span>
                </div>
                <div className="relative w-full h-1.5 bg-gray-800 rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${isUnder ? 'bg-emerald-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min((bucket.actual / bucket.target) * 100, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <QuickStat
            label="Total Expenses"
            value={fmt(Math.round(pnl.totalExpenses))}
            color="text-red-400"
          />
          <QuickStat
            label="Marketing as % Rev"
            value={fmtPct(marketingPct)}
            color={marketingPct <= PNL_TARGETS.marketing ? 'text-emerald-400' : 'text-red-400'}
          />
          <QuickStat
            label="Labor as % Rev"
            value={fmtPct(laborPct)}
            color={laborPct <= PNL_TARGETS.labor ? 'text-emerald-400' : 'text-red-400'}
          />
          <QuickStat
            label="Overhead as % Rev"
            value={fmtPct(overheadPct)}
            color={overheadPct <= PNL_TARGETS.overhead ? 'text-emerald-400' : 'text-red-400'}
          />
        </div>
      </div>

      {/* the operator 2026-05-01: flat all-transactions table with inline
          category re-assignment. Mirrors the billing tracker UX so we
          can correct miscategorized expenses without leaving the page. */}
      <ExpensesEditableTable expenses={expenses} />
    </div>
  );
}

// ── Editable transactions table ──────────────────────────────────────
function ExpensesEditableTable({ expenses }: { expenses: Expense[] }) {
  // Local override map so the dropdown reflects the user's choice
  // immediately while the network call is in-flight.
  const [localCategory, setLocalCategory] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const sorted = useMemo(() => {
    const filtered = search.trim()
      ? expenses.filter((e) => {
          const q = search.toLowerCase();
          return (
            (e.description ?? '').toLowerCase().includes(q) ||
            (e.category ?? '').toLowerCase().includes(q)
          );
        })
      : expenses;
    return [...filtered].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }, [expenses, search]);

  const handleCategoryChange = async (expense: Expense, value: string) => {
    setLocalCategory((prev) => ({ ...prev, [expense.id]: value }));
    setSavingId(expense.id);
    try {
      const res = await fetch('/api/expense/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: expense.id, expense_type: value }),
      });
      if (!res.ok) {
        // Revert local on failure
        setLocalCategory((prev) => {
          const next = { ...prev };
          delete next[expense.id];
          return next;
        });
      } else {
        // Notify other surfaces (Daily Review Queue counts etc.)
        window.dispatchEvent(new CustomEvent('expense:categorized', { detail: { id: expense.id, value } }));
      }
    } catch {
      setLocalCategory((prev) => {
        const next = { ...prev };
        delete next[expense.id];
        return next;
      });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-6 mt-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">All Transactions ({sorted.length})</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">Inline-edit category — writes to t08_expenses immediately.</p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search vendor / description / category…"
          className="bg-black/30 border border-gray-700 rounded px-3 py-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-blue-500 w-72"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold border-b border-gray-800">
              <th className="text-left py-2 w-[90px]">Date</th>
              <th className="text-left py-2">Description</th>
              <th className="text-right py-2 px-3 w-[110px]">Amount</th>
              <th className="text-left py-2 px-3 w-[200px]">Category</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((exp) => {
              const currentCat = localCategory[exp.id] ?? (exp.category ?? '');
              const isSaving = savingId === exp.id;
              const dateLabel = exp.date
                ? new Date(exp.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                : '—';
              return (
                <tr key={exp.id} className={`border-b border-gray-800/50 ${currentCat === 'unknown' || !currentCat ? 'bg-amber-900/10' : ''}`}>
                  <td className="py-2 text-gray-400 text-xs tabular-nums">{dateLabel}</td>
                  <td className="py-2 text-white truncate max-w-[400px]" title={exp.description ?? ''}>{exp.description ?? '—'}</td>
                  <td className="py-2 px-3 text-right tabular-nums font-medium text-white">{fmt(exp.amount)}</td>
                  <td className="py-2 px-3">
                    <select
                      value={currentCat}
                      onChange={(e) => handleCategoryChange(exp, e.target.value)}
                      disabled={isSaving}
                      className={`bg-black/30 border rounded px-2 py-1 text-xs text-white outline-none focus:border-blue-500 disabled:opacity-50 w-full ${
                        currentCat === 'unknown' || !currentCat ? 'border-amber-700/60' : 'border-gray-700'
                      }`}
                    >
                      <option value="">— uncategorized —</option>
                      {CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">No expenses match the current filter.</div>
        )}
      </div>
    </div>
  );
}

function PnLRow({
  label,
  value,
  valueClass = 'text-gray-300',
  labelClass = 'text-gray-400',
}: {
  label: string;
  value: string;
  valueClass?: string;
  labelClass?: string;
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`${labelClass} text-sm`}>{label}</span>
      <span className={`${valueClass} text-sm tabular-nums`}>{value}</span>
    </div>
  );
}

function PnLRowWithTarget({
  label,
  value,
  actualPct,
  targetPct,
}: {
  label: string;
  value: string;
  actualPct: number;
  targetPct: number;
}) {
  const isUnder = actualPct <= targetPct;
  return (
    <div className="flex items-center justify-between py-0.5">
      <div className="flex items-center gap-2">
        <span className="text-gray-400 text-sm">{label}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isUnder ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
          {fmtPct(actualPct)} / {fmtPct(targetPct)}
        </span>
      </div>
      <span className="text-gray-300 text-sm tabular-nums">{value}</span>
    </div>
  );
}

function QuickStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#0f1117] rounded-lg p-4 border border-gray-700/50">
      <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-xl font-bold ${color} tabular-nums`}>{value}</div>
    </div>
  );
}
