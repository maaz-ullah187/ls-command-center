'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, Plus, X, ChevronUp, ChevronDown, ArrowUpDown, Trash2 } from 'lucide-react';
import { FINANCING_FEE } from '@/lib/commission-config';
import PillSelect, { PillSelectOption } from './PillSelect';

interface BillingRow {
  id: string;
  date: string;
  name: string;
  email: string;
  amount: number;
  grossAmount: number;
  status: 'Approved' | 'Failed' | 'Refunded' | 'Chargeback' | 'Pending' | 'Overdue' | 'Declined';
  closer: string;
  program: string;
  financing: boolean;
  finalAmount: number;
  processor: 'Whop' | 'Fanbasis' | 'Manual' | 'Slack';
  notes: string;
  isAnomaly: boolean;
  anomalyReason: string;
  payment_type?: string;
  deleted?: boolean;
}

interface BillingTotals {
  total: number;
  approved: number;
  failed: number;
  refunded: number;
  totalCash: number;
  totalAfterFinancing: number;
}

type SortField = 'date' | 'name' | 'email' | 'amount' | 'status' | 'closer' | 'program' | 'financing' | 'finalAmount' | 'processor';
type SortDir = 'asc' | 'desc';

const STATUS_BADGE: Record<string, { bg: string; text: string; border: string }> = {
  Approved: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  Failed: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
  Refunded: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
  Chargeback: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
  Pending: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  Overdue: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
  Declined: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
};

/* ── Option configs for each dropdown ────────────────────────────────── */

const STATUS_DROPDOWN_OPTIONS: PillSelectOption[] = [
  { value: 'Approved',   label: 'Approved',   color: 'emerald' },
  { value: 'Pending',    label: 'Pending',    color: 'amber' },
  { value: 'Overdue',    label: 'Overdue',    color: 'red' },
  { value: 'Declined',   label: 'Declined',   color: 'red' },
  { value: 'Refunded',   label: 'Refunded',   color: 'purple' },
  { value: 'Chargeback', label: 'Chargeback', color: 'red' },
  { value: 'Failed',     label: 'Failed',     color: 'red' },
];

// Canonical payment_type buckets per the spec (2026-04-28). Values mirror
// t07_income_processors.payment_type DB column. UI labels are human-readable.
const TYPE_DROPDOWN_OPTIONS: PillSelectOption[] = [
  { value: 'new_client',         label: 'New Client',         color: 'emerald' },
  { value: 'account_receivable', label: 'Account Receivable', color: 'orange'  },
  { value: 'upsell_renewal',     label: 'Upsell / Renewal',   color: 'amber'   },
  { value: 'mastermind',         label: 'Mastermind',         color: 'purple'  },
  { value: 'refund',             label: 'Refund',             color: 'red'     },
];

const CLOSER_DROPDOWN_OPTIONS: PillSelectOption[] = [
  { value: 'Closer One',        label: 'Closer One',        color: 'blue' },
  { value: 'Closer Two',   label: 'Closer Two',   color: 'blue' },
  { value: 'The Operator',  label: 'The Operator',  color: 'blue' },
];

const PROGRAM_DROPDOWN_OPTIONS: PillSelectOption[] = [
  { value: 'Program B',   label: 'Program B',   color: 'blue' },
  { value: 'Program A',     label: 'Program A',     color: 'cyan' },
  { value: 'DFY AI Build',      label: 'DFY AI Build',      color: 'purple' },
  { value: 'Done With You AI',  label: 'Done With You AI',  color: 'violet' },
];

/* ── Helpers ─────────────────────────────────────────────────────────── */

function saveOverride(rowId: string, field: string, value: string) {
  fetch('/api/overrides', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      table_name: 'billing',
      row_id: rowId,
      field,
      corrected: value,
    }),
  }).catch(() => {});
}

type TimeFilter = 'all' | 'this_month' | 'last_30' | '7_days' | 'today';

const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  all: 'All Time',
  this_month: 'This Month',
  last_30: 'Last 30 Days',
  '7_days': '7 Days',
  today: 'Today',
};

function filterByTimeframe(rows: BillingRow[], timeFilter: TimeFilter): BillingRow[] {
  if (timeFilter === 'all') return rows;
  const now = new Date();
  let cutoff: Date;
  switch (timeFilter) {
    case 'this_month':
      cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'last_30':
      cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '7_days':
      cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'today':
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    default:
      return rows;
  }
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return rows.filter(p => p.date >= cutoffStr);
}

export default function BillingTracker() {
  const [payments, setPayments] = useState<BillingRow[]>([]);
  const [totals, setTotals] = useState<BillingTotals>({ total: 0, approved: 0, failed: 0, refunded: 0, totalCash: 0, totalAfterFinancing: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [localEdits, setLocalEdits] = useState<Record<string, Partial<BillingRow>>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [showZero, setShowZero] = useState(false);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('this_month');

  // Fetch billing data
  useEffect(() => {
    setLoading(true);
    fetch('/api/data/billing')
      .then(r => r.json())
      .then(data => {
        if (data.payments) setPayments(data.payments);
        if (data.totals) setTotals(data.totals);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Apply local edits onto rows
  const editedPayments = useMemo(() => {
    return payments.map(p => {
      const edits = localEdits[p.id];
      if (!edits) return p;
      const merged = { ...p, ...edits };
      // Recompute finalAmount if financing or amount changed
      if (edits.financing !== undefined || edits.amount !== undefined) {
        const amt = merged.amount;
        merged.finalAmount = merged.financing ? amt * (1 - FINANCING_FEE) : amt;
      }
      return merged;
    });
  }, [payments, localEdits]);

  // Apply time filter first, then compute totals from filtered results
  const timeFiltered = useMemo(() => {
    const nonDeleted = editedPayments.filter(p => !deletedIds.has(p.id) && !p.deleted);
    return filterByTimeframe(nonDeleted, timeFilter);
  }, [editedPayments, deletedIds, timeFilter]);

  // Recompute totals from time-filtered payments
  const computedTotals = useMemo(() => {
    let total = 0, approved = 0, failed = 0, refunded = 0, totalCash = 0, totalAfterFinancing = 0;
    for (const p of timeFiltered) {
      total++;
      if (p.status === 'Approved') { approved++; totalCash += p.amount; totalAfterFinancing += p.finalAmount; }
      else if (p.status === 'Failed') { failed++; }
      else if (p.status === 'Refunded') { refunded++; }
    }
    return { total, approved, failed, refunded, totalCash, totalAfterFinancing };
  }, [timeFiltered]);

  // Filtering: exclude $0 (unless toggled), and search
  const filtered = useMemo(() => {
    let rows = timeFiltered;
    if (!showZero) {
      rows = rows.filter(p => p.amount !== 0);
    }
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter(p =>
      (p.name ?? '').toLowerCase().includes(q) ||
      (p.email ?? '').toLowerCase().includes(q)
    );
  }, [timeFiltered, search, showZero]);

  // Sorting
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      const av = a[sortField];
      const bv = b[sortField];
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else if (typeof av === 'boolean' && typeof bv === 'boolean') {
        cmp = (av ? 1 : 0) - (bv ? 1 : 0);
      } else {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // Inline editing
  const startEdit = (id: string, field: string, currentValue: unknown) => {
    setEditingCell({ id, field });
    setEditValue(String(currentValue ?? ''));
  };

  const saveEdit = useCallback(() => {
    if (!editingCell) return;
    const { id, field } = editingCell;
    let val: unknown = editValue;

    // Type coercion for specific fields
    if (field === 'amount' || field === 'finalAmount') val = parseFloat(editValue) || 0;
    if (field === 'financing') val = editValue.toLowerCase() === 'y' || editValue.toLowerCase() === 'yes' || editValue === 'true';

    setLocalEdits(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: val },
    }));
    setEditingCell(null);
    setEditValue('');
  }, [editingCell, editValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') { setEditingCell(null); setEditValue(''); }
  };

  // Dropdown change handlers
  const handleStatusChange = (rowId: string, value: string) => {
    setLocalEdits(prev => ({
      ...prev,
      [rowId]: { ...prev[rowId], status: value as BillingRow['status'] },
    }));
    saveOverride(rowId, 'status', value);
  };

  const handleProgramChange = (rowId: string, value: string) => {
    setLocalEdits(prev => ({
      ...prev,
      [rowId]: { ...prev[rowId], program: value },
    }));
    saveOverride(rowId, 'program', value);
  };

  const handlePaymentTypeChange = (rowId: string, value: string) => {
    setLocalEdits(prev => ({
      ...prev,
      [rowId]: { ...prev[rowId], payment_type: value },
    }));
    // Direct write to t07_income_processors — categorization is authored
    // signal, not a source-data correction. Mirrors immediately to Supabase.
    // After a successful save we fire a global event so any open Revenue
    // Composition / HeadlineKPIs cards re-fetch and the Uncategorized slice
    // shrinks in real time — no more "I categorized and the donut didn't
    // budge" confusion (the operator 2026-04-29).
    fetch('/api/billing/categorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowId, paymentType: value }),
    })
      .then(() => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('billing:categorized', { detail: { rowId, value } }));
        }
      })
      .catch(() => {});
  };

  // Delete row
  const handleDelete = (rowId: string) => {
    if (!window.confirm('Delete this payment?')) return;
    setDeletedIds(prev => new Set(prev).add(rowId));
    saveOverride(rowId, 'deleted', 'true');
  };

  // Add manual payment
  const handleAddPayment = (data: Partial<BillingRow>) => {
    const newRow: BillingRow = {
      id: `manual-${Date.now()}`,
      date: data.date ?? new Date().toISOString().split('T')[0],
      name: data.name ?? '',
      email: data.email ?? '',
      amount: data.amount ?? 0,
      grossAmount: data.amount ?? 0,
      status: (data.status as BillingRow['status']) ?? 'Approved',
      closer: data.closer ?? '',
      program: data.program ?? '',
      financing: data.financing ?? false,
      finalAmount: data.financing ? (data.amount ?? 0) * (1 - FINANCING_FEE) : (data.amount ?? 0),
      processor: 'Manual',
      notes: data.notes ?? '',
      isAnomaly: false,
      anomalyReason: '',
    };
    setPayments(prev => [newRow, ...prev]);
    setShowAddModal(false);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown size={10} className="ml-1 inline text-gray-600" />;
    return sortDir === 'asc'
      ? <ChevronUp size={10} className="ml-1 inline text-blue-400" />
      : <ChevronDown size={10} className="ml-1 inline text-blue-400" />;
  };

  const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const t = computedTotals;

  // Processing fee calculation
  const procFee = (row: BillingRow) => {
    if (!row.grossAmount || row.grossAmount === 0) return '\u2014';
    return ((row.grossAmount - row.finalAmount) / row.grossAmount * 100).toFixed(1) + '%';
  };

  const renderCell = (row: BillingRow, field: string, displayValue: React.ReactNode, rawValue: unknown) => {
    const isEditing = editingCell?.id === row.id && editingCell?.field === field;
    if (isEditing) {
      return (
        <input
          autoFocus
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={handleKeyDown}
          className="bg-gray-800 border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white w-full focus:outline-none"
        />
      );
    }
    return (
      <span
        className="cursor-pointer hover:bg-gray-700/50 px-1 py-0.5 rounded transition-colors"
        onClick={(e) => { e.stopPropagation(); startEdit(row.id, field, rawValue); }}
        title="Click to edit"
      >
        {displayValue}
      </span>
    );
  };

  // Count $0 transactions for the toggle label (within time filter)
  const zeroCount = useMemo(() => {
    return timeFiltered.filter(p => p.amount === 0).length;
  }, [timeFiltered]);

  return (
    <div className="space-y-6">
      {/* Date Filter Buttons */}
      <div className="flex items-center gap-1.5">
        {(Object.keys(TIME_FILTER_LABELS) as TimeFilter[]).map(key => (
          <button
            key={key}
            onClick={() => setTimeFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              timeFilter === key
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 border border-transparent'
            }`}
          >
            {TIME_FILTER_LABELS[key]}
          </button>
        ))}
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4">
          <p className="text-[10px] text-gray-500 uppercase font-semibold mb-1">Total Payments</p>
          <p className="text-2xl font-bold text-white">{t.total.toLocaleString()}</p>
        </div>
        <div className="bg-[#1a1d23] rounded-xl border border-emerald-500/30 p-4">
          <p className="text-[10px] text-emerald-400 uppercase font-semibold mb-1">Approved</p>
          <p className="text-2xl font-bold text-emerald-400">{t.approved.toLocaleString()}</p>
        </div>
        <div className="bg-[#1a1d23] rounded-xl border border-red-500/30 p-4">
          <p className="text-[10px] text-red-400 uppercase font-semibold mb-1">Failed</p>
          <p className="text-2xl font-bold text-red-400">{t.failed.toLocaleString()}</p>
        </div>
        <div className="bg-[#1a1d23] rounded-xl border border-orange-500/30 p-4">
          <p className="text-[10px] text-orange-400 uppercase font-semibold mb-1">Refunded</p>
          <p className="text-2xl font-bold text-orange-400">{t.refunded.toLocaleString()}</p>
        </div>
        <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4">
          <p className="text-[10px] text-gray-500 uppercase font-semibold mb-1">Total Cash</p>
          <p className="text-2xl font-bold text-emerald-400">{fmt(t.totalCash)}</p>
        </div>
        <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4">
          <p className="text-[10px] text-gray-500 uppercase font-semibold mb-1">After Financing</p>
          <p className="text-2xl font-bold text-white">{fmt(t.totalAfterFinancing)}</p>
          {t.totalCash > 0 && (
            <p className="text-[10px] text-gray-500 mt-1">
              {((1 - t.totalAfterFinancing / t.totalCash) * 100).toFixed(1)}% deducted
            </p>
          )}
        </div>
      </div>

      {/* Search + Add + Filters */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-white">{TIME_FILTER_LABELS[timeFilter]} Payments</h3>
            <span className="text-xs text-gray-500">{filtered.length} of {timeFiltered.length}</span>
          </div>
          <div className="flex items-center gap-3">
            {zeroCount > 0 && (
              <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showZero}
                  onChange={e => setShowZero(e.target.checked)}
                  className="w-3 h-3 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
                />
                Show $0 ({zeroCount})
              </label>
            )}
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search name or email..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 w-64"
              />
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-600/30 transition-colors border border-blue-500/30"
            >
              <Plus size={13} />
              Add Payment
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500 text-sm">Loading payments...</div>
        ) : (
          <div className="overflow-visible">
            <table className="w-full text-sm text-gray-300">
              <thead>
                <tr className="border-b border-gray-700 text-[10px] text-gray-500 uppercase">
                  <th className="text-left py-2 px-2 cursor-pointer hover:text-gray-300" onClick={() => handleSort('date')}>
                    Date <SortIcon field="date" />
                  </th>
                  <th className="text-left py-2 px-2 cursor-pointer hover:text-gray-300" onClick={() => handleSort('name')}>
                    Name <SortIcon field="name" />
                  </th>
                  <th className="text-left py-2 px-2 cursor-pointer hover:text-gray-300" onClick={() => handleSort('email')}>
                    Email <SortIcon field="email" />
                  </th>
                  <th className="text-right py-2 px-2 cursor-pointer hover:text-gray-300" onClick={() => handleSort('amount')}>
                    Amount <SortIcon field="amount" />
                  </th>
                  <th className="text-center py-2 px-2 cursor-pointer hover:text-gray-300" onClick={() => handleSort('status')}>
                    Status <SortIcon field="status" />
                  </th>
                  <th className="text-center py-2 px-2">Type</th>
                  <th className="text-left py-2 px-2 cursor-pointer hover:text-gray-300" onClick={() => handleSort('closer')}>
                    Closer <SortIcon field="closer" />
                  </th>
                  <th className="text-left py-2 px-2 cursor-pointer hover:text-gray-300" onClick={() => handleSort('program')}>
                    Program <SortIcon field="program" />
                  </th>
                  <th className="text-center py-2 px-2 cursor-pointer hover:text-gray-300" onClick={() => handleSort('financing')}>
                    Fin. <SortIcon field="financing" />
                  </th>
                  <th className="text-right py-2 px-2 cursor-pointer hover:text-gray-300" onClick={() => handleSort('finalAmount')}>
                    Final $ <SortIcon field="finalAmount" />
                  </th>
                  <th className="text-center py-2 px-2">
                    Proc %
                  </th>
                  <th className="text-left py-2 px-2 cursor-pointer hover:text-gray-300" onClick={() => handleSort('processor')}>
                    Proc. <SortIcon field="processor" />
                  </th>
                  <th className="text-left py-2 px-2">Notes</th>
                  <th className="py-2 px-1 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(row => {
                  const statusRowClass = (() => {
                    switch (row.status) {
                      case 'Approved': return 'bg-emerald-500/[0.03] border-l-2 border-l-emerald-500/40';
                      case 'Pending': return 'bg-amber-500/[0.03] border-l-2 border-l-amber-500/40';
                      case 'Failed':
                      case 'Declined':
                      case 'Refunded':
                      case 'Overdue': return 'bg-red-500/[0.05] border-l-2 border-l-red-500/40';
                      case 'Chargeback': return 'bg-red-500/[0.05] border-l-2 border-l-red-600/60';
                      default: return '';
                    }
                  })();
                  return (
                  <tr
                    key={row.id}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors ${statusRowClass} ${
                      row.isAnomaly ? 'bg-red-950/20' : ''
                    }`}
                    title={row.isAnomaly ? row.anomalyReason : undefined}
                  >
                    <td className="py-1.5 px-2 text-xs text-gray-400 whitespace-nowrap">
                      {renderCell(row, 'date', row.date, row.date)}
                    </td>
                    <td className="py-1.5 px-2 text-xs text-gray-200 max-w-[160px] truncate">
                      {renderCell(row, 'name', row.name || '-', row.name)}
                    </td>
                    <td className="py-1.5 px-2 text-xs text-gray-400 max-w-[180px] truncate">
                      {renderCell(row, 'email', row.email || '-', row.email)}
                    </td>
                    <td className="py-1.5 px-2 text-xs text-right font-medium text-white">
                      {renderCell(row, 'amount', fmt(row.amount), row.amount)}
                    </td>
                    {/* Status dropdown */}
                    <td className="py-1.5 px-2 text-center">
                      <PillSelect
                        value={row.status}
                        options={STATUS_DROPDOWN_OPTIONS}
                        onChange={val => handleStatusChange(row.id, val)}
                        allowClear
                        maxLabelWidth={100}
                      />
                    </td>
                    {/* Payment Type dropdown */}
                    <td className="py-1.5 px-2 text-center">
                      <PillSelect
                        value={row.payment_type ?? ''}
                        options={TYPE_DROPDOWN_OPTIONS}
                        onChange={val => handlePaymentTypeChange(row.id, val)}
                        allowClear
                        maxLabelWidth={100}
                      />
                    </td>
                    <td className="py-1.5 px-2">
                      <PillSelect
                        value={row.closer || ''}
                        options={CLOSER_DROPDOWN_OPTIONS}
                        onChange={val => {
                          setLocalEdits(prev => ({
                            ...prev,
                            [row.id]: { ...prev[row.id], closer: val },
                          }));
                          saveOverride(row.id, 'closer', val);
                        }}
                        allowClear
                        maxLabelWidth={100}
                      />
                    </td>
                    {/* Program dropdown */}
                    <td className="py-1.5 px-2">
                      <PillSelect
                        value={row.program}
                        options={PROGRAM_DROPDOWN_OPTIONS}
                        onChange={val => handleProgramChange(row.id, val)}
                        allowClear
                        maxLabelWidth={100}
                      />
                    </td>
                    {/* PAID column (renamed from FIN.) */}
                    <td className="py-1.5 px-2 text-center text-xs">
                      {renderCell(
                        row,
                        'financing',
                        row.financing
                          ? <span className="text-amber-400 font-medium">Y</span>
                          : <span className="text-gray-600">N</span>,
                        row.financing ? 'Y' : 'N'
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-xs text-right font-medium text-emerald-400">
                      {renderCell(row, 'finalAmount', fmt(row.finalAmount), row.finalAmount)}
                    </td>
                    {/* Processing % */}
                    <td className="py-1.5 px-2 text-center">
                      <span className="text-[10px] text-gray-400">{procFee(row)}</span>
                    </td>
                    <td className="py-1.5 px-2 text-xs text-gray-500">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        row.processor === 'Whop' ? 'bg-purple-500/15 text-purple-400' :
                        row.processor === 'Fanbasis' ? 'bg-blue-500/15 text-blue-400' :
                        row.processor === 'Slack' ? 'bg-green-500/15 text-green-400' :
                        'bg-gray-500/15 text-gray-400'
                      }`}>
                        {row.processor}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-xs text-gray-500 max-w-[200px] truncate">
                      {renderCell(row, 'notes', row.notes || '-', row.notes)}
                    </td>
                    {/* Delete button */}
                    <td className="py-1.5 px-1">
                      <button
                        onClick={() => handleDelete(row.id)}
                        className="p-1 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        title="Delete payment"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={14} className="py-12 text-center text-gray-500 text-sm">
                      {search ? 'No payments match your search.' : 'No payments found. Connect Whop, Fanbasis, or Slack to see data.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Payment Modal */}
      {showAddModal && <AddPaymentModal onAdd={handleAddPayment} onClose={() => setShowAddModal(false)} />}
    </div>
  );
}

/* --- Add Payment Modal -------------------------------------------------- */

interface AddPaymentModalProps {
  onAdd: (data: Partial<BillingRow>) => void;
  onClose: () => void;
}

function AddPaymentModal({ onAdd, onClose }: AddPaymentModalProps) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState(0);
  const [status, setStatus] = useState<BillingRow['status']>('Approved');
  const [closer, setCloser] = useState('');
  const [program, setProgram] = useState('');
  const [financing, setFinancing] = useState(false);
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd({ date, name, email, amount, status, closer, program, financing, notes });
  };

  const inputCls = 'w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#1a1d23] rounded-2xl border border-gray-700 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h3 className="text-white font-semibold text-sm">Add Payment</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} required />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Status</label>
              <PillSelect
                value={status}
                options={STATUS_DROPDOWN_OPTIONS}
                onChange={val => setStatus(val as BillingRow['status'])}
                maxLabelWidth={200}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Client name" className={inputCls} required />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="client@email.com" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Amount ($)</label>
              <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} className={inputCls} min={0} step={0.01} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Closer</label>
              <PillSelect
                value={closer}
                options={CLOSER_DROPDOWN_OPTIONS}
                onChange={setCloser}
                placeholder="Select closer"
                allowClear
                maxLabelWidth={200}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Program</label>
              <PillSelect
                value={program}
                options={PROGRAM_DROPDOWN_OPTIONS}
                onChange={setProgram}
                placeholder="Select..."
                allowClear
                maxLabelWidth={200}
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={financing}
                onChange={e => setFinancing(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
              />
              Splitit Financing (15% deduction)
            </label>
          </div>
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1">Notes</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." className={inputCls} />
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Add Payment
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
