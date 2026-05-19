'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, ChevronUp, ChevronDown, ArrowUpDown } from 'lucide-react';
import { MercuryTransaction } from '@/lib/mappers/mercury';
import PillSelect, { PillSelectOption } from './PillSelect';

/* ── Types ─────────────────────────────────────────────────────────────── */

type TimeFilter = 'all' | 'this_month' | 'last_30';
type SortField = 'date' | 'description' | 'category' | 'amount';
type SortDir = 'asc' | 'desc';

const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  all: 'All Time',
  this_month: 'This Month',
  last_30: 'Last 30 Days',
};

const TYPE_OPTIONS: PillSelectOption[] = [
  { value: 'Overhead',            label: 'Overhead',            color: 'amber' },
  { value: 'Marketing',           label: 'Marketing',           color: 'emerald' },
  { value: 'Labour',              label: 'Labour',              color: 'blue' },
  { value: 'Mastermind Expense',  label: 'Mastermind Expense',  color: 'purple' },
  { value: 'Other',               label: 'Other',               color: 'gray' },
];

/* ── Currency formatter ────────────────────────────────────────────── */

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });

/* ── Main component ───────────────────────────────────────────────── */

export default function ExpensesTab() {
  const [transactions, setTransactions] = useState<MercuryTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('this_month');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Overrides for type and notes (keyed by transaction id)
  const [typeOverrides, setTypeOverrides] = useState<Record<string, string>>({});
  const [notesOverrides, setNotesOverrides] = useState<Record<string, string>>({});
  const [summaryOverrides, setSummaryOverrides] = useState<Record<string, string>>({});

  // Fetch Mercury transactions
  useEffect(() => {
    setLoading(true);

    // Build date params based on filter
    const now = new Date();
    let start: string | undefined;
    let end: string | undefined;

    if (timeFilter === 'this_month') {
      start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      end = now.toISOString().slice(0, 10);
    } else if (timeFilter === 'last_30') {
      const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      start = d.toISOString().slice(0, 10);
      end = now.toISOString().slice(0, 10);
    }
    // 'all' → no date params, API defaults to current month anyway — pass wide range
    if (timeFilter === 'all') {
      start = '2024-01-01';
      end = now.toISOString().slice(0, 10);
    }

    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);

    fetch(`/api/data/expenses-mercury?${params}`)
      .then(r => r.json())
      .then(data => {
        setTransactions(data.transactions ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [timeFilter]);

  // Load existing overrides for expenses table
  useEffect(() => {
    fetch('/api/overrides?table=expenses')
      .then(r => r.json())
      .then((rows: any[]) => {
        if (!Array.isArray(rows)) return;
        const types: Record<string, string> = {};
        const notes: Record<string, string> = {};
        const summaries: Record<string, string> = {};
        for (const r of rows) {
          if (r.field === 'type') types[r.row_id] = r.value;
          if (r.field === 'notes') notes[r.row_id] = r.value;
          if (r.field === 'summary') summaries[r.row_id] = r.value;
        }
        setTypeOverrides(types);
        setNotesOverrides(notes);
        setSummaryOverrides(summaries);
      })
      .catch(() => {});
  }, []);

  // Save override
  const saveOverride = useCallback((rowId: string, field: string, value: string) => {
    fetch('/api/overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table_name: 'expenses',
        row_id: rowId,
        field,
        value,
        edited_by: 'the operator',
      }),
    }).catch(() => {});
  }, []);

  const handleTypeChange = useCallback((txnId: string, newType: string) => {
    setTypeOverrides(prev => ({ ...prev, [txnId]: newType }));
    saveOverride(txnId, 'type', newType);
  }, [saveOverride]);

  const handleNotesChange = useCallback((txnId: string, notes: string) => {
    setNotesOverrides(prev => ({ ...prev, [txnId]: notes }));
    saveOverride(txnId, 'notes', notes);
  }, [saveOverride]);

  const handleSummaryChange = useCallback((txnId: string, summary: string) => {
    setSummaryOverrides(prev => ({ ...prev, [txnId]: summary }));
    saveOverride(txnId, 'summary', summary);
  }, [saveOverride]);

  // Get effective type for a transaction (override > auto-categorized)
  const getType = useCallback((txn: MercuryTransaction): string => {
    return typeOverrides[txn.id] || txn.category || 'Overhead';
  }, [typeOverrides]);

  // Get effective summary for a transaction (override > original)
  const getSummary = useCallback((txn: MercuryTransaction): string => {
    return summaryOverrides[txn.id] || txn.counterpartyName || txn.description || '';
  }, [summaryOverrides]);

  // Filter + sort
  const filtered = useMemo(() => {
    let rows = transactions;

    // Search
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(t =>
        (t.description || '').toLowerCase().includes(q) ||
        (t.counterpartyName || '').toLowerCase().includes(q) ||
        (summaryOverrides[t.id] || '').toLowerCase().includes(q)
      );
    }

    // Sort
    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date':
          cmp = a.date.localeCompare(b.date);
          break;
        case 'description':
          cmp = getSummary(a).localeCompare(getSummary(b));
          break;
        case 'category':
          cmp = getType(a).localeCompare(getType(b));
          break;
        case 'amount':
          cmp = a.amount - b.amount;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return rows;
  }, [transactions, search, sortField, sortDir, getType, getSummary, summaryOverrides]);

  // Summary totals
  const totals = useMemo(() => {
    const result = { overhead: 0, marketing: 0, labour: 0, total: 0 };
    for (const t of transactions) {
      const type = getType(t);
      const amt = t.amount;
      result.total += amt;
      if (type === 'Overhead') result.overhead += amt;
      else if (type === 'Marketing') result.marketing += amt;
      else if (type === 'Labour') result.labour += amt;
    }
    return result;
  }, [transactions, getType]);

  // Sort handler
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'date' ? 'desc' : 'asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown size={12} className="text-gray-600" />;
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Expenses</h2>
          <p className="text-xs text-gray-500 mt-0.5">Mercury banking transactions</p>
        </div>
        <div className="flex items-center gap-2">
          {(Object.keys(TIME_FILTER_LABELS) as TimeFilter[]).map(tf => (
            <button
              key={tf}
              onClick={() => setTimeFilter(tf)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                timeFilter === tf
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {TIME_FILTER_LABELS[tf]}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
          <p className="text-xs text-amber-400 font-medium mb-1">Overhead</p>
          <p className="text-xl font-bold text-amber-300">{fmt(totals.overhead)}</p>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
          <p className="text-xs text-emerald-400 font-medium mb-1">Marketing</p>
          <p className="text-xl font-bold text-emerald-300">{fmt(totals.marketing)}</p>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
          <p className="text-xs text-blue-400 font-medium mb-1">Labour</p>
          <p className="text-xl font-bold text-blue-300">{fmt(totals.labour)}</p>
        </div>
        <div className="bg-gray-500/10 border border-gray-600/20 rounded-xl p-4">
          <p className="text-xs text-gray-400 font-medium mb-1">Total Expenses</p>
          <p className="text-xl font-bold text-white">{fmt(totals.total)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search transactions..."
            className="w-full pl-9 pr-3 py-2 bg-[#1a1d23] border border-gray-700 rounded-lg text-sm text-gray-300 placeholder:text-gray-600 focus:outline-none focus:border-gray-500"
          />
        </div>
        <span className="text-xs text-gray-500">{filtered.length} transactions</span>
      </div>

      {/* Table */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500 text-sm">Loading Mercury transactions...</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-gray-500 text-sm">No transactions found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 bg-[#141720]">
                  <th
                    onClick={() => handleSort('date')}
                    className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-gray-500 font-medium cursor-pointer hover:text-gray-300 w-[110px]"
                  >
                    <span className="flex items-center gap-1">Date <SortIcon field="date" /></span>
                  </th>
                  <th
                    onClick={() => handleSort('description')}
                    className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-gray-500 font-medium cursor-pointer hover:text-gray-300"
                  >
                    <span className="flex items-center gap-1">Short Summary <SortIcon field="description" /></span>
                  </th>
                  <th
                    onClick={() => handleSort('category')}
                    className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-gray-500 font-medium cursor-pointer hover:text-gray-300 w-[170px]"
                  >
                    <span className="flex items-center gap-1">Type <SortIcon field="category" /></span>
                  </th>
                  <th
                    onClick={() => handleSort('amount')}
                    className="text-right px-4 py-3 text-[11px] uppercase tracking-wider text-gray-500 font-medium cursor-pointer hover:text-gray-300 w-[120px]"
                  >
                    <span className="flex items-center gap-1 justify-end">Amount <SortIcon field="amount" /></span>
                  </th>
                  <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-gray-500 font-medium w-[200px]">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(txn => {
                  const type = getType(txn);
                  const summary = getSummary(txn);
                  const notes = notesOverrides[txn.id] || '';

                  return (
                    <tr key={txn.id} className="border-t border-gray-800 hover:bg-gray-800/30 transition-colors">
                      {/* DATE */}
                      <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                        {txn.date}
                      </td>

                      {/* SHORT SUMMARY (editable) */}
                      <td className="px-4 py-2.5">
                        <input
                          type="text"
                          value={summary}
                          onChange={e => handleSummaryChange(txn.id, e.target.value)}
                          className="bg-transparent text-gray-300 text-sm w-full focus:outline-none focus:bg-gray-800/50 rounded px-1 -ml-1 hover:bg-gray-800/30 transition-colors"
                        />
                      </td>

                      {/* TYPE (dropdown) */}
                      <td className="px-4 py-2.5">
                        <PillSelect
                          value={type}
                          options={TYPE_OPTIONS}
                          onChange={(val) => handleTypeChange(txn.id, val)}
                        />
                      </td>

                      {/* AMOUNT */}
                      <td className="px-4 py-2.5 text-right text-red-400 font-medium text-sm whitespace-nowrap">
                        {fmt(txn.amount)}
                      </td>

                      {/* NOTES (editable) */}
                      <td className="px-4 py-2.5">
                        <input
                          type="text"
                          value={notes}
                          onChange={e => handleNotesChange(txn.id, e.target.value)}
                          placeholder="Add note..."
                          className="bg-transparent text-gray-400 text-xs w-full focus:outline-none focus:bg-gray-800/50 rounded px-1 -ml-1 placeholder:text-gray-700 hover:bg-gray-800/30 transition-colors"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
