'use client';

import { Lead } from '@/lib/types';
import { getCloserStats, CLOSERS } from '@/lib/mock-data';
import { isWithinKPI } from '@/lib/kpi-config';
import { AlertTriangle, ChevronDown, ChevronRight, Eye, Plus, UserMinus, Pencil, Trash2, X, Check, DollarSign } from 'lucide-react';
import { useState, Fragment, useMemo, useEffect, useCallback } from 'react';
import AddPersonForm from './AddPersonForm';
import { STORAGE_KEYS, loadJSON, saveJSON } from '@/lib/storage/localStore';
import EditableValue from './EditableValue';
import PillSelect, { PillSelectOption } from './PillSelect';
import type { CloserEodAggregate, CloserEodRow } from '@/app/api/data/closer-eods/route';
import {
  DEFAULT_TEAM,
  FINANCING_FEE,
  PIF_BONUS,
  ROLE_COLORS,
  ROLE_LABELS,
  type TeamMember,
} from '@/lib/commission-config';

interface PersistedClosers {
  active: string[];
  deactivated: string[];
}

interface CloserBreakdownProps {
  leads: Lead[];
  ads?: { spend: number }[];
  onViewLeads: (closer: string) => void;
  dateRange?: { start: string; end: string };
}

/** Return missing business day dates (Mon-Fri) in a date range that are missing from reportDates */
function getMissingBusinessDays(start: string, end: string, reportDates: string[]): string[] {
  const reportSet = new Set(reportDates);
  const today = new Date().toISOString().split('T')[0];
  // Clamp end to today (can't expect EODs for future dates)
  const effectiveEnd = end > today ? today : end;
  const missingDates: string[] = [];
  const d = new Date(start + 'T00:00:00');
  const endDate = new Date(effectiveEnd + 'T00:00:00');
  while (d <= endDate) {
    const day = d.getDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) {
      const ds = d.toISOString().split('T')[0];
      if (!reportSet.has(ds)) missingDates.push(ds);
    }
    d.setDate(d.getDate() + 1);
  }
  return missingDates;
}

function formatMissingDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function CloserBreakdown({ leads, ads = [], onViewLeads, dateRange }: CloserBreakdownProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeClosers, setActiveClosers] = useState<string[]>([...CLOSERS]);
  const [deactivated, setDeactivated] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [, setRefreshKey] = useState(0);
  const triggerRefresh = useCallback(() => setRefreshKey(k => k + 1), []);
  const [eodData, setEodData] = useState<CloserEodAggregate[]>([]);
  const [eodDetailRows, setEodDetailRows] = useState<CloserEodRow[]>([]);
  const [editingEodId, setEditingEodId] = useState<string | null>(null);
  const [editingEodValues, setEditingEodValues] = useState<Partial<CloserEodRow>>({});
  const [showAddEodForm, setShowAddEodForm] = useState(false);
  const [addEodCloser, setAddEodCloser] = useState<string | null>(null);
  // Commission state is managed by the CommissionTracker subcomponent

  // Fetch closer EOD aggregates from Supabase, filtered by dateRange
  useEffect(() => {
    const params = new URLSearchParams();
    if (dateRange?.start) params.set('start', dateRange.start);
    if (dateRange?.end) params.set('end', dateRange.end);
    const qs = params.toString();
    fetch(`/api/data/closer-eods${qs ? `?${qs}` : ''}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: CloserEodAggregate[]) => { if (Array.isArray(data)) setEodData(data); })
      .catch(() => {});
  }, [dateRange]);

  // Build a lookup map from closer name → EOD aggregate
  const eodByCloser = useMemo(() => {
    const m = new Map<string, CloserEodAggregate>();
    for (const e of eodData) m.set(e.closer_name, e);
    return m;
  }, [eodData]);

  // Fetch individual EOD rows for edit/delete
  const fetchEodDetails = useCallback(() => {
    const params = new URLSearchParams({ detail: 'true' });
    if (dateRange?.start) params.set('start', dateRange.start);
    if (dateRange?.end) params.set('end', dateRange.end);
    fetch(`/api/data/closer-eods?${params}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: CloserEodRow[]) => { if (Array.isArray(data)) setEodDetailRows(data); })
      .catch(() => {});
  }, [dateRange]);

  useEffect(() => { fetchEodDetails(); }, [fetchEodDetails]);

  // Group detail rows by closer
  const eodRowsByCloser = useMemo(() => {
    const m = new Map<string, CloserEodRow[]>();
    for (const row of eodDetailRows) {
      const arr = m.get(row.closer_name) ?? [];
      arr.push(row);
      m.set(row.closer_name, arr);
    }
    return m;
  }, [eodDetailRows]);

  // Re-fetch aggregates helper
  const refetchEods = useCallback(() => {
    const params = new URLSearchParams();
    if (dateRange?.start) params.set('start', dateRange.start);
    if (dateRange?.end) params.set('end', dateRange.end);
    const qs = params.toString();
    fetch(`/api/data/closer-eods${qs ? `?${qs}` : ''}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: CloserEodAggregate[]) => { if (Array.isArray(data)) setEodData(data); })
      .catch(() => {});
    fetchEodDetails();
  }, [dateRange, fetchEodDetails]);

  // Save edited EOD
  const handleSaveEod = async (id: string) => {
    const updates = editingEodValues;
    const res = await fetch('/api/data/closer-eods', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    });
    if (res.ok) {
      setEditingEodId(null);
      setEditingEodValues({});
      refetchEods();
    }
  };

  // Delete EOD
  const handleDeleteEod = async (id: string) => {
    if (!confirm('Delete this EOD report? This cannot be undone.')) return;
    const res = await fetch(`/api/data/closer-eods?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) refetchEods();
  };

  // Add EOD
  const handleAddEod = async (formData: Record<string, any>) => {
    const res = await fetch('/api/data/closer-eods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    if (res.ok) {
      setShowAddEodForm(false);
      setAddEodCloser(null);
      refetchEods();
    }
  };

  // Hydrate from localStorage on mount (client-only, SSR-safe)
  useEffect(() => {
    const persisted = loadJSON<PersistedClosers | null>(STORAGE_KEYS.closers, null);
    if (persisted) {
      setActiveClosers(persisted.active);
      setDeactivated(new Set(persisted.deactivated));
    }
    setHydrated(true);
  }, []);

  // Persist every change after hydration
  useEffect(() => {
    if (!hydrated) return;
    saveJSON(STORAGE_KEYS.closers, {
      active: activeClosers,
      deactivated: Array.from(deactivated),
    });
  }, [activeClosers, deactivated, hydrated]);


  // Compute stats for all closers (including manually added ones),
  // then overlay self-reported EOD data when available.
  const closers = useMemo(() => {
    const stats = getCloserStats(leads);
    // Add any manually added closers that don't have stats yet
    for (const name of activeClosers) {
      if (!stats.find(s => s.name === name) && !deactivated.has(name)) {
        stats.push({
          name,
          totalCalls: 0,
          closedDeals: 0,
          revenue: 0,
          organicCalls: 0,
          organicClosed: 0,
          organicRevenue: 0,
          paidCalls: 0,
          paidClosed: 0,
          paidRevenue: 0,
        });
      }
    }

    // Also ensure any closer that exists in EOD data but not yet in stats gets a row
    for (const eod of eodData) {
      if (!stats.find(s => s.name === eod.closer_name) && !deactivated.has(eod.closer_name)) {
        stats.push({
          name: eod.closer_name,
          totalCalls: 0,
          closedDeals: 0,
          revenue: 0,
          organicCalls: 0,
          organicClosed: 0,
          organicRevenue: 0,
          paidCalls: 0,
          paidClosed: 0,
          paidRevenue: 0,
        });
      }
    }

    // Overlay EOD self-reported values (takes priority over lead-derived counts)
    for (const s of stats) {
      const eod = eodByCloser.get(s.name);
      if (eod) {
        s.totalCalls = eod.calls_shown;
        s.closedDeals = eod.calls_closed;
        s.revenue = eod.cash_collected;
      }
    }

    // Filter out deactivated
    return stats.filter(s => !deactivated.has(s.name));
  }, [leads, activeClosers, deactivated, eodData, eodByCloser]);

  const toggle = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const handleAddCloser = (name: string) => {
    if (!activeClosers.includes(name)) {
      setActiveClosers(prev => [...prev, name]);
    }
    // If it was deactivated, reactivate
    setDeactivated(prev => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  };

  const handleDeactivate = (name: string) => {
    setDeactivated(prev => new Set(prev).add(name));
  };

  const closeRate = (closed: number, total: number) => total > 0 ? (closed / total) * 100 : 0;
  const dollarPerCall = (rev: number, total: number) => total > 0 ? rev / total : 0;


  return (
    <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-5">
      {/* Header with Add button */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">Closer Performance</h3>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-600/30 transition-colors border border-blue-500/30"
        >
          <Plus size={13} />
          Add Closer
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-gray-300">
          <thead>
            <tr className="border-b border-gray-700 text-[11px] text-gray-500 uppercase">
              <th className="text-left py-3 px-3 w-8"></th>
              <th className="text-left py-3 px-3">Closer</th>
              <th className="text-right py-3 px-3">Booked</th>
              <th className="text-right py-3 px-3">Showed</th>
              <th className="text-right py-3 px-3">Show Rate</th>
              <th className="text-right py-3 px-3">Closed</th>
              <th className="text-right py-3 px-3">Close Rate</th>
              <th className="text-right py-3 px-3">Revenue</th>
              <th className="text-right py-3 px-3">Avg Upfront</th>
              <th className="text-right py-3 px-3">Cash/Call</th>
              <th className="text-right py-3 px-3">$ Per Call</th>
              <th className="text-center py-3 px-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {closers.sort((a, b) => b.revenue - a.revenue).map(closer => {
              const eod = eodByCloser.get(closer.name);
              const booked = eod?.calls_booked ?? 0;
              const cancelled = eod?.calls_cancelled ?? 0;
              const showed = closer.totalCalls; // totalCalls is overlaid with calls_shown from EOD
              // Show rate: showed / (booked - cancelled)
              const showRateDenom = booked - cancelled;
              const sr = showRateDenom > 0 ? (showed / showRateDenom) * 100 : 0;
              const srGood = sr >= 70;
              const cr = closeRate(closer.closedDeals, closer.totalCalls);
              const dpc = dollarPerCall(closer.revenue, closer.totalCalls);
              const crGood = isWithinKPI('closeRate', cr);
              const dpcGood = isWithinKPI('dollarPerCall', dpc);

              // Missing EOD detection — returns actual dates, not just count
              const missingDates = dateRange && eod
                ? getMissingBusinessDays(dateRange.start, dateRange.end, eod.report_dates ?? [])
                : [];
              const missingDays = missingDates.length;

              return (
                <Fragment key={closer.name}>
                  <tr
                    className="border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer transition-colors"
                    onClick={() => toggle(closer.name)}
                  >
                    <td className="py-2.5 px-3 text-gray-500">
                      {expanded.has(closer.name) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-white">
                      <div className="flex items-center gap-2">
                        {closer.name}
                        {missingDays > 0 && (
                          <span
                            className="inline-flex items-center gap-1 bg-amber-500/15 text-amber-400 text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-500/30"
                            title={`${closer.name}: missing ${missingDates.map(formatMissingDate).join(', ')}`}
                          >
                            <AlertTriangle size={10} />
                            {missingDays} Missing EOD{missingDays > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-right py-2.5 px-3 text-gray-400">
                      {booked > 0 ? booked : '-'}
                    </td>
                    <td className="text-right py-2.5 px-3">
                      <EditableValue
                        value={closer.totalCalls}
                        tableName="closer_eod_reports"
                        rowId={closer.name}
                        field="totalCalls"
                        format="number"
                        onSaved={triggerRefresh}
                      />
                    </td>
                    <td className={`text-right py-2.5 px-3 font-medium ${booked > 0 ? (srGood ? 'text-emerald-400' : sr >= 50 ? 'text-amber-400' : 'text-red-400') : 'text-gray-500'}`}>
                      {booked > 0 ? `${sr.toFixed(1)}%` : '-'}
                    </td>
                    <td className="text-right py-2.5 px-3">
                      <EditableValue
                        value={closer.closedDeals}
                        tableName="closer_eod_reports"
                        rowId={closer.name}
                        field="closedDeals"
                        format="number"
                        onSaved={triggerRefresh}
                      />
                    </td>
                    <td className={`text-right py-2.5 px-3 font-medium ${crGood ? 'text-emerald-400' : 'text-red-400'}`}>
                      {cr.toFixed(1)}%
                    </td>
                    <td className="text-right py-2.5 px-3 font-medium text-emerald-400">
                      <EditableValue
                        value={closer.revenue}
                        tableName="closer_eod_reports"
                        rowId={closer.name}
                        field="revenue"
                        format="currency"
                        onSaved={triggerRefresh}
                      />
                    </td>
                    <td className="text-right py-2.5 px-3 font-medium text-white">
                      {closer.closedDeals > 0
                        ? `$${(closer.revenue / closer.closedDeals).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                        : '-'}
                    </td>
                    <td className="text-right py-2.5 px-3">${closer.totalCalls > 0 ? (closer.revenue / closer.totalCalls).toFixed(0) : 0}</td>
                    <td className={`text-right py-2.5 px-3 font-medium ${dpcGood ? 'text-emerald-400' : 'text-red-400'}`}>
                      ${dpc.toFixed(2)}
                    </td>
                    <td className="text-center py-2.5 px-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); onViewLeads(closer.name); }}
                          className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-gray-300"
                          title="View calls"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeactivate(closer.name); }}
                          className="p-1 hover:bg-red-900/30 rounded text-gray-600 hover:text-red-400"
                          title="Deactivate closer"
                        >
                          <UserMinus size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded.has(closer.name) && (
                    <>
                      <tr className="border-b border-gray-800/50 bg-blue-950/20">
                        <td className="py-2 px-3"></td>
                        <td className="py-2 px-3 pl-8 text-blue-400 text-xs font-medium">Facebook Ads</td>
                        <td className="text-right py-2 px-3 text-xs"></td>
                        <td className="text-right py-2 px-3 text-xs">{closer.paidCalls}</td>
                        <td className="text-right py-2 px-3 text-xs"></td>
                        <td className="text-right py-2 px-3 text-xs">{closer.paidClosed}</td>
                        <td className="text-right py-2 px-3 text-xs">{closeRate(closer.paidClosed, closer.paidCalls).toFixed(1)}%</td>
                        <td className="text-right py-2 px-3 text-xs">${closer.paidRevenue.toLocaleString()}</td>
                        <td className="text-right py-2 px-3 text-xs">{closer.paidClosed > 0 ? `$${(closer.paidRevenue / closer.paidClosed).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'}</td>
                        <td className="text-right py-2 px-3 text-xs">${closer.paidCalls > 0 ? (closer.paidRevenue / closer.paidCalls).toFixed(0) : 0}</td>
                        <td className="text-right py-2 px-3 text-xs">${dollarPerCall(closer.paidRevenue, closer.paidCalls).toFixed(2)}</td>
                        <td></td>
                      </tr>
                      <tr className="border-b border-gray-800/50 bg-emerald-950/20">
                        <td className="py-2 px-3"></td>
                        <td className="py-2 px-3 pl-8 text-emerald-400 text-xs font-medium">Organic</td>
                        <td className="text-right py-2 px-3 text-xs"></td>
                        <td className="text-right py-2 px-3 text-xs">{closer.organicCalls}</td>
                        <td className="text-right py-2 px-3 text-xs"></td>
                        <td className="text-right py-2 px-3 text-xs">{closer.organicClosed}</td>
                        <td className="text-right py-2 px-3 text-xs">{closeRate(closer.organicClosed, closer.organicCalls).toFixed(1)}%</td>
                        <td className="text-right py-2 px-3 text-xs">${closer.organicRevenue.toLocaleString()}</td>
                        <td className="text-right py-2 px-3 text-xs">{closer.organicClosed > 0 ? `$${(closer.organicRevenue / closer.organicClosed).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'}</td>
                        <td className="text-right py-2 px-3 text-xs">${closer.organicCalls > 0 ? (closer.organicRevenue / closer.organicCalls).toFixed(0) : 0}</td>
                        <td className="text-right py-2 px-3 text-xs">${dollarPerCall(closer.organicRevenue, closer.organicCalls).toFixed(2)}</td>
                        <td></td>
                      </tr>
                      {/* EOD Summary Row */}
                      {(() => {
                        const eod = eodByCloser.get(closer.name);
                        if (!eod) return null;
                        return (
                          <tr className="border-b border-gray-800/50 bg-yellow-950/20">
                            <td className="py-2 px-3"></td>
                            <td className="py-2 px-3 pl-8 text-yellow-400 text-xs font-medium" colSpan={11}>
                              <div className="flex items-center gap-6">
                                <span className="text-gray-500">EOD Self-Reported (Totals):</span>
                                <span>Booked <span className="text-white font-medium">{eod.calls_booked}</span></span>
                                <span>Offers <span className="text-white font-medium">{eod.offers_given}</span></span>
                                <span>Deposits <span className="text-white font-medium">{eod.deposits}</span></span>
                                <span>No Shows <span className="text-white font-medium">{eod.no_shows}</span></span>
                                <span>Cancelled <span className="text-white font-medium">{eod.calls_cancelled}</span></span>
                                <span>Rev Generated <span className="text-emerald-400 font-medium">${eod.revenue_generated.toLocaleString()}</span></span>
                              </div>
                            </td>
                          </tr>
                        );
                      })()}

                      {/* Individual EOD Reports with Edit/Delete */}
                      {(() => {
                        const rows = eodRowsByCloser.get(closer.name);
                        if (!rows || rows.length === 0) return null;
                        return (
                          <>
                            <tr className="border-b border-gray-800/50 bg-gray-900/40">
                              <td className="py-1.5 px-3"></td>
                              <td className="py-1.5 px-3 pl-8" colSpan={11}>
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-gray-500 uppercase font-semibold">Daily EOD Reports</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setAddEodCloser(closer.name); setShowAddEodForm(true); }}
                                    className="flex items-center gap-1 px-2 py-0.5 bg-emerald-600/20 text-emerald-400 rounded text-[10px] font-medium hover:bg-emerald-600/30 transition-colors border border-emerald-500/30"
                                  >
                                    <Plus size={10} />
                                    Add EOD
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {/* Column headers for EOD detail */}
                            <tr className="border-b border-gray-800/30 bg-gray-900/30">
                              <td className="py-1 px-3"></td>
                              <td className="py-1 px-3 pl-10 text-[9px] text-gray-600 uppercase">Date</td>
                              <td className="text-right py-1 px-3 text-[9px] text-gray-600 uppercase">Calls</td>
                              <td className="text-right py-1 px-3 text-[9px] text-gray-600 uppercase">Shows</td>
                              <td className="text-right py-1 px-3 text-[9px] text-gray-600 uppercase">Closed</td>
                              <td className="text-right py-1 px-3 text-[9px] text-gray-600 uppercase">Close %</td>
                              <td className="text-right py-1 px-3 text-[9px] text-gray-600 uppercase">Cash</td>
                              <td className="text-right py-1 px-3 text-[9px] text-gray-600 uppercase">$/Call</td>
                              <td className="py-1 px-3" colSpan={3}></td>
                              <td className="text-center py-1 px-3 text-[9px] text-gray-600 uppercase">Actions</td>
                            </tr>
                            {rows.map(row => {
                              const isEditing = editingEodId === row.id;
                              const ev = editingEodValues;
                              const rowCloseRate = (Number(row.calls_shown) > 0) ? ((Number(row.calls_closed) / Number(row.calls_shown)) * 100) : 0;
                              const rowEcall = (Number(row.calls_shown) > 0) ? (Number(row.cash_collected) / Number(row.calls_shown)) : 0;

                              if (isEditing) {
                                return (
                                  <tr key={row.id} className="border-b border-gray-800/30 bg-blue-950/30">
                                    <td className="py-1 px-3"></td>
                                    <td className="py-1 px-3 pl-10 text-xs text-gray-300">
                                      <input type="date" defaultValue={row.date} onChange={e => setEditingEodValues(p => ({ ...p, date: e.target.value }))} className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white w-28" />
                                    </td>
                                    <td className="text-right py-1 px-3">
                                      <input type="number" defaultValue={row.calls_booked} onChange={e => setEditingEodValues(p => ({ ...p, calls_booked: Number(e.target.value) } as any))} className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white w-14 text-right" />
                                    </td>
                                    <td className="text-right py-1 px-3">
                                      <input type="number" defaultValue={row.calls_shown} onChange={e => setEditingEodValues(p => ({ ...p, calls_shown: Number(e.target.value) } as any))} className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white w-14 text-right" />
                                    </td>
                                    <td className="text-right py-1 px-3">
                                      <input type="number" defaultValue={row.calls_closed} onChange={e => setEditingEodValues(p => ({ ...p, calls_closed: Number(e.target.value) } as any))} className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white w-14 text-right" />
                                    </td>
                                    <td className="text-right py-1 px-3 text-xs text-gray-500">auto</td>
                                    <td className="text-right py-1 px-3">
                                      <input type="number" defaultValue={row.cash_collected} onChange={e => setEditingEodValues(p => ({ ...p, cash_collected: Number(e.target.value) } as any))} className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white w-20 text-right" />
                                    </td>
                                    <td className="text-right py-1 px-3 text-xs text-gray-500">auto</td>
                                    <td className="py-1 px-3" colSpan={3}></td>
                                    <td className="text-center py-1 px-3">
                                      <div className="flex items-center justify-center gap-1">
                                        <button onClick={() => handleSaveEod(row.id)} className="p-1 hover:bg-emerald-900/30 rounded text-emerald-400" title="Save">
                                          <Check size={12} />
                                        </button>
                                        <button onClick={() => { setEditingEodId(null); setEditingEodValues({}); }} className="p-1 hover:bg-gray-700 rounded text-gray-400" title="Cancel">
                                          <X size={12} />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              }

                              return (
                                <tr key={row.id} className="border-b border-gray-800/30 hover:bg-gray-800/30 transition-colors">
                                  <td className="py-1 px-3"></td>
                                  <td className="py-1 px-3 pl-10 text-xs text-gray-400">
                                    {new Date(row.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })}
                                  </td>
                                  <td className="text-right py-1 px-3 text-xs text-gray-400">{row.calls_booked || '-'}</td>
                                  <td className="text-right py-1 px-3 text-xs text-gray-300">{row.calls_shown}</td>
                                  <td className="text-right py-1 px-3 text-xs text-gray-300">{row.calls_closed}</td>
                                  <td className="text-right py-1 px-3 text-xs text-gray-400">{rowCloseRate.toFixed(0)}%</td>
                                  <td className="text-right py-1 px-3 text-xs text-emerald-400">${Number(row.cash_collected).toLocaleString()}</td>
                                  <td className="text-right py-1 px-3 text-xs text-gray-400">${rowEcall.toFixed(0)}</td>
                                  <td className="py-1 px-3" colSpan={3}></td>
                                  <td className="text-center py-1 px-3">
                                    <div className="flex items-center justify-center gap-1">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setEditingEodId(row.id); setEditingEodValues({}); }}
                                        className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-blue-400"
                                        title="Edit EOD"
                                      >
                                        <Pencil size={11} />
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteEod(row.id); }}
                                        className="p-1 hover:bg-red-900/30 rounded text-gray-600 hover:text-red-400"
                                        title="Delete EOD"
                                      >
                                        <Trash2 size={11} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </>
                        );
                      })()}
                    </>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ─── Commission Tracker ────────────────────────────────────────── */}
      <CommissionTracker leads={leads} dateRange={dateRange} />

      {/* Deactivated closers */}
      {deactivated.size > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-700">
          <p className="text-[10px] text-gray-500 uppercase font-semibold mb-2">Deactivated Closers</p>
          <div className="flex flex-wrap gap-2">
            {Array.from(deactivated).map(name => (
              <button
                key={name}
                onClick={() => {
                  setDeactivated(prev => {
                    const next = new Set(prev);
                    next.delete(name);
                    return next;
                  });
                }}
                className="px-2.5 py-1 bg-gray-800 text-gray-500 rounded-lg text-xs hover:text-gray-300 hover:bg-gray-700 transition-colors"
              >
                {name} <span className="text-[10px] ml-1 text-blue-400">reactivate</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Add Closer Modal */}
      {showAddForm && (
        <AddPersonForm
          title="Add Closer"
          onAdd={handleAddCloser}
          onClose={() => setShowAddForm(false)}
        />
      )}

      {/* Add EOD Modal */}
      {showAddEodForm && (
        <AddEodForm
          closerName={addEodCloser}
          closers={activeClosers.filter(c => !deactivated.has(c))}
          onAdd={handleAddEod}
          onClose={() => { setShowAddEodForm(false); setAddEodCloser(null); }}
        />
      )}
    </div>
  );
}

/* ─── Add EOD Form (modal) ────────────────────────────────────────────── */

interface AddEodFormProps {
  closerName: string | null;
  closers: string[];
  onAdd: (data: Record<string, any>) => void;
  onClose: () => void;
}

function AddEodForm({ closerName, closers, onAdd, onClose }: AddEodFormProps) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [closer, setCloser] = useState(closerName ?? closers[0] ?? '');
  const [callsBooked, setCallsBooked] = useState(0);
  const [callsShown, setCallsShown] = useState(0);
  const [callsClosed, setCallsClosed] = useState(0);
  const [cashCollected, setCashCollected] = useState(0);
  const [revenueGenerated, setRevenueGenerated] = useState(0);
  const [noShows, setNoShows] = useState(0);
  const [callsCancelled, setCallsCancelled] = useState(0);
  const [offersGiven, setOffersGiven] = useState(0);
  const [deposits, setDeposits] = useState(0);
  const [feedback, setFeedback] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !closer) return;
    onAdd({
      date,
      closer_name: closer,
      calls_booked: callsBooked,
      calls_shown: callsShown,
      calls_closed: callsClosed,
      cash_collected: cashCollected,
      revenue_generated: revenueGenerated,
      no_shows: noShows,
      calls_cancelled: callsCancelled,
      offers_given: offersGiven,
      deposits,
      feedback: feedback || null,
    });
  };

  const inputCls = "w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500";

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#1a1d23] rounded-2xl border border-gray-700 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h3 className="text-white font-semibold text-sm">Add EOD Report</h3>
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
              <label className="block text-xs text-gray-400 font-medium mb-1">Closer</label>
              <PillSelect
                value={closer}
                options={closers.map<PillSelectOption>(c => ({ value: c, label: c, color: 'blue' }))}
                onChange={setCloser}
                maxLabelWidth={200}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Calls Booked</label>
              <input type="number" value={callsBooked} onChange={e => setCallsBooked(Number(e.target.value))} className={inputCls} min={0} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Shows</label>
              <input type="number" value={callsShown} onChange={e => setCallsShown(Number(e.target.value))} className={inputCls} min={0} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Closed</label>
              <input type="number" value={callsClosed} onChange={e => setCallsClosed(Number(e.target.value))} className={inputCls} min={0} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Cash Collected ($)</label>
              <input type="number" value={cashCollected} onChange={e => setCashCollected(Number(e.target.value))} className={inputCls} min={0} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Revenue Generated ($)</label>
              <input type="number" value={revenueGenerated} onChange={e => setRevenueGenerated(Number(e.target.value))} className={inputCls} min={0} />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">No Shows</label>
              <input type="number" value={noShows} onChange={e => setNoShows(Number(e.target.value))} className={inputCls} min={0} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Cancelled</label>
              <input type="number" value={callsCancelled} onChange={e => setCallsCancelled(Number(e.target.value))} className={inputCls} min={0} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Offers</label>
              <input type="number" value={offersGiven} onChange={e => setOffersGiven(Number(e.target.value))} className={inputCls} min={0} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Deposits</label>
              <input type="number" value={deposits} onChange={e => setDeposits(Number(e.target.value))} className={inputCls} min={0} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1">Notes / Feedback</label>
            <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={2} className={inputCls} placeholder="Optional notes..." />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium text-gray-400 hover:text-white transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!date || !closer}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Plus size={13} />
              Add EOD
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Commission Tracker ────────────────────────────────────────────── */

type CommissionPeriod = 'this_month' | 'last_month' | 'all_time';

interface CommissionDeal {
  id: string;
  date: string;
  client: string;
  grossAmount: number;
  financing: boolean;
  netAmount: number;
  commission: number;
  pifBonus: number;
  status: 'Approved' | 'Refunded' | 'Chargeback' | 'Pending';
  paid: boolean;
}

interface CommissionTrackerProps {
  leads: Lead[];
  dateRange?: { start: string; end: string };
}

function CommissionTracker({ leads, dateRange }: CommissionTrackerProps) {
  const [team, setTeam] = useState<TeamMember[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_TEAM;
    const persisted = loadJSON<TeamMember[] | null>(STORAGE_KEYS.commissionTeam, null);
    return persisted ?? DEFAULT_TEAM;
  });
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());
  const [paidDeals, setPaidDeals] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    const saved = loadJSON<string[]>('ls-cc.commissionPaid', []);
    return new Set(saved);
  });
  const [period, setPeriod] = useState<CommissionPeriod>('this_month');
  const [showAddMember, setShowAddMember] = useState(false);
  const [editingRate, setEditingRate] = useState<string | null>(null);
  const [editRateValue, setEditRateValue] = useState('');

  // Persist team
  useEffect(() => {
    saveJSON(STORAGE_KEYS.commissionTeam, team);
  }, [team]);

  // Persist paid deals
  useEffect(() => {
    saveJSON('ls-cc.commissionPaid', Array.from(paidDeals));
  }, [paidDeals]);

  // Period filtering
  const periodFilter = useMemo(() => {
    const now = new Date();
    if (period === 'this_month') {
      const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const end = now.toISOString().split('T')[0];
      return { start, end };
    }
    if (period === 'last_month') {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const start = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      const end = lastDay.toISOString().split('T')[0];
      return { start, end };
    }
    return dateRange ?? { start: '2020-01-01', end: now.toISOString().split('T')[0] };
  }, [period, dateRange]);

  const filteredLeads = useMemo(() => {
    return leads.filter(l => l.date >= periodFilter.start && l.date <= periodFilter.end);
  }, [leads, periodFilter]);

  // Total new cash for all_new_cash based roles
  const totalNewCash = useMemo(() => {
    return filteredLeads
      .filter(l => l.cashCollected > 0 && (l.callOutcome === 'Closed Won' || l.stage === 'Closed Won' || l.cashCollected > 1))
      .reduce((s, l) => s + l.cashCollected, 0);
  }, [filteredLeads]);

  // Build deals per team member
  const getMemberDeals = useCallback((member: TeamMember): CommissionDeal[] => {
    // For deal_cash members, find their deals
    if (member.basedOn === 'deal_cash') {
      const matchField = member.role === 'setter' ? 'assignedSetter' : 'assignedCloser';
      return filteredLeads
        .filter(l => {
          const matchValue = matchField === 'assignedSetter'
            ? (l.assignedSetter ?? '')
            : l.assignedCloser;
          return matchValue === member.name && (l.cashCollected > 0 || l.contractedRevenue > 0);
        })
        .map(l => {
          const isRefunded = l.callOutcome === 'Closed Lost' && l.cashCollected <= 0;
          const isChargeback = l.paymentFailed === true;
          const status: CommissionDeal['status'] = isRefunded ? 'Refunded' : isChargeback ? 'Chargeback' : 'Approved';
          const financing = false; // Default; can be overridden in billing data
          const netAmount = financing ? l.cashCollected * (1 - FINANCING_FEE) : l.cashCollected;
          const commission = status === 'Refunded' || status === 'Chargeback'
            ? -(netAmount * member.rate)
            : netAmount * member.rate;
          // PIF bonus: if contractedRevenue roughly equals cashCollected (paid in full)
          const isPIF = l.contractedRevenue > 0 && l.cashCollected >= l.contractedRevenue * 0.95;
          const program = l.program || 'Program B';
          const pifBonus = isPIF && !financing
            ? (PIF_BONUS[program] || 0)
            : 0;

          return {
            id: l.id,
            date: l.date,
            client: l.name,
            grossAmount: l.cashCollected,
            financing,
            netAmount,
            commission,
            pifBonus: status === 'Approved' ? pifBonus : 0,
            status,
            paid: paidDeals.has(l.id + '-' + member.name),
          };
        })
        .sort((a, b) => b.date.localeCompare(a.date));
    }
    // For all_new_cash members, they get one aggregate line
    return [];
  }, [filteredLeads, paidDeals]);

  // Compute per-member summary
  const getMemberSummary = useCallback((member: TeamMember) => {
    if (member.basedOn === 'all_new_cash') {
      const commission = totalNewCash * member.rate;
      return {
        deals: 0,
        grossCash: totalNewCash,
        financingDeductions: 0,
        netCash: totalNewCash,
        commission,
        pifBonuses: 0,
        refundDeductions: 0,
        totalPayout: commission,
      };
    }

    const deals = getMemberDeals(member);
    const approvedDeals = deals.filter(d => d.status === 'Approved');
    const refundedDeals = deals.filter(d => d.status === 'Refunded' || d.status === 'Chargeback');

    const grossCash = approvedDeals.reduce((s, d) => s + d.grossAmount, 0);
    const financingDeductions = approvedDeals.reduce((s, d) => s + (d.financing ? d.grossAmount * FINANCING_FEE : 0), 0);
    const netCash = grossCash - financingDeductions;
    const commission = approvedDeals.reduce((s, d) => s + d.commission, 0);
    const pifBonuses = approvedDeals.reduce((s, d) => s + d.pifBonus, 0);
    const refundDeductions = Math.abs(refundedDeals.reduce((s, d) => s + d.commission, 0));
    const totalPayout = commission + pifBonuses - refundDeductions;

    return {
      deals: approvedDeals.length,
      grossCash,
      financingDeductions,
      netCash,
      commission,
      pifBonuses,
      refundDeductions,
      totalPayout,
    };
  }, [getMemberDeals, totalNewCash]);

  const toggleMember = (name: string) => {
    setExpandedMembers(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const togglePaid = (dealId: string, memberName: string) => {
    const key = dealId + '-' + memberName;
    setPaidDeals(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleRateEdit = (memberName: string, newRate: number) => {
    setTeam(prev => prev.map(m =>
      m.name === memberName ? { ...m, rate: newRate } : m
    ));
    setEditingRate(null);
  };

  const handleAddMember = (data: { name: string; role: TeamMember['role']; rate: number }) => {
    const newMember: TeamMember = {
      name: data.name,
      role: data.role,
      rate: data.rate / 100,
      basedOn: data.role === 'sales_manager' || data.role === 'marketing_manager' ? 'all_new_cash' : 'deal_cash',
    };
    setTeam(prev => [...prev, newMember]);
    setShowAddMember(false);
  };

  const handleRemoveMember = (name: string) => {
    setTeam(prev => prev.filter(m => m.name !== name));
  };

  const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  // Totals
  const teamTotals = useMemo(() => {
    return team.reduce((acc, m) => {
      const s = getMemberSummary(m);
      return {
        totalCommission: acc.totalCommission + s.totalPayout,
        byRole: {
          ...acc.byRole,
          [m.role]: (acc.byRole[m.role] ?? 0) + s.totalPayout,
        },
      };
    }, { totalCommission: 0, byRole: {} as Record<string, number> });
  }, [team, getMemberSummary]);

  return (
    <div className="mt-6 pt-5 border-t border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <DollarSign size={16} className="text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">Commission Tracker</h3>
        </div>
        <div className="flex items-center gap-3">
          {/* Period selector */}
          <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
            {([
              { key: 'this_month', label: 'This Month' },
              { key: 'last_month', label: 'Last Month' },
              { key: 'all_time', label: 'All Time' },
            ] as { key: CommissionPeriod; label: string }[]).map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                  period === p.key ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowAddMember(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 text-emerald-400 rounded-lg text-xs font-medium hover:bg-emerald-600/30 transition-colors border border-emerald-500/30"
          >
            <Plus size={13} />
            Add Team Member
          </button>
        </div>
      </div>

      {/* Per-person commission cards */}
      <div className="space-y-3">
        {team.map(member => {
          const summary = getMemberSummary(member);
          const deals = getMemberDeals(member);
          const isExpanded = expandedMembers.has(member.name);
          const colors = ROLE_COLORS[member.role];
          const roleLabel = ROLE_LABELS[member.role];

          return (
            <div key={member.name} className="bg-gray-800/40 rounded-lg border border-gray-700/50 overflow-hidden">
              {/* Header */}
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-800/60 transition-colors"
                onClick={() => member.basedOn === 'deal_cash' && toggleMember(member.name)}
              >
                <div className="flex items-center gap-3">
                  {member.basedOn === 'deal_cash' && (
                    <span className="text-gray-500">
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                  )}
                  <span className="text-sm font-medium text-white">{member.name}</span>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${colors.bg} ${colors.text} border ${colors.border}`}>
                    {roleLabel}
                  </span>
                  {/* Editable rate */}
                  {editingRate === member.name ? (
                    <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <input
                        autoFocus
                        type="number"
                        step="0.5"
                        value={editRateValue}
                        onChange={e => setEditRateValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleRateEdit(member.name, parseFloat(editRateValue) / 100);
                          if (e.key === 'Escape') setEditingRate(null);
                        }}
                        onBlur={() => handleRateEdit(member.name, parseFloat(editRateValue) / 100)}
                        className="bg-gray-900 border border-blue-500 rounded px-1.5 py-0.5 text-[11px] text-white w-16 focus:outline-none"
                      />
                      <span className="text-[10px] text-gray-500">%</span>
                    </span>
                  ) : (
                    <span
                      className="text-[11px] text-gray-500 cursor-pointer hover:text-blue-400 flex items-center gap-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingRate(member.name);
                        setEditRateValue(String((member.rate * 100)));
                      }}
                    >
                      {(member.rate * 100).toFixed(member.rate * 100 % 1 === 0 ? 0 : 2)}%
                      <Pencil size={9} className="inline" />
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-bold text-emerald-400">{fmt(summary.totalPayout)}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemoveMember(member.name); }}
                    className="p-1 hover:bg-red-900/30 rounded text-gray-600 hover:text-red-400"
                    title="Remove team member"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {/* Summary row */}
              <div className="px-4 py-2 bg-gray-900/30 border-t border-gray-700/30">
                {member.basedOn === 'all_new_cash' ? (
                  <div className="text-xs text-gray-400">
                    <span className="text-gray-500">{(member.rate * 100).toFixed(member.rate * 100 % 1 === 0 ? 0 : 2)}% of </span>
                    <span className="text-white font-medium">{fmt(totalNewCash)}</span>
                    <span className="text-gray-500"> total new cash = </span>
                    <span className="text-emerald-400 font-medium">{fmt(summary.commission)}</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-8 gap-2 text-[10px]">
                    <div>
                      <p className="text-gray-600 uppercase">Deals</p>
                      <p className="text-white font-medium">{summary.deals}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 uppercase">Gross Cash</p>
                      <p className="text-white font-medium">{fmt(summary.grossCash)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 uppercase">Fin. Ded.</p>
                      <p className="text-red-400 font-medium">{summary.financingDeductions > 0 ? `-${fmt(summary.financingDeductions)}` : '-'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 uppercase">Net Cash</p>
                      <p className="text-white font-medium">{fmt(summary.netCash)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 uppercase">Commission</p>
                      <p className="text-emerald-400 font-medium">{fmt(summary.commission)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 uppercase">PIF Bonus</p>
                      <p className="text-amber-400 font-medium">{summary.pifBonuses > 0 ? fmt(summary.pifBonuses) : '-'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 uppercase">Refund Ded.</p>
                      <p className="text-red-400 font-medium">{summary.refundDeductions > 0 ? `-${fmt(summary.refundDeductions)}` : '-'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 uppercase font-bold">Total</p>
                      <p className="text-emerald-400 font-bold">{fmt(summary.totalPayout)}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Expandable deal-by-deal table */}
              {isExpanded && member.basedOn === 'deal_cash' && deals.length > 0 && (
                <div className="border-t border-gray-700/30">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[9px] text-gray-600 uppercase bg-gray-900/40">
                        <th className="text-left py-1.5 px-3">Date</th>
                        <th className="text-left py-1.5 px-3">Client</th>
                        <th className="text-right py-1.5 px-3">Gross</th>
                        <th className="text-center py-1.5 px-3">Fin?</th>
                        <th className="text-right py-1.5 px-3">Net</th>
                        <th className="text-right py-1.5 px-3">Commission</th>
                        <th className="text-right py-1.5 px-3">PIF Bonus</th>
                        <th className="text-center py-1.5 px-3">Status</th>
                        <th className="text-center py-1.5 px-3">Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deals.map(deal => {
                        const isRefund = deal.status === 'Refunded' || deal.status === 'Chargeback';
                        return (
                          <tr
                            key={deal.id}
                            className={`border-t border-gray-800/30 hover:bg-gray-800/30 transition-colors ${
                              isRefund ? 'bg-red-950/10' : ''
                            }`}
                          >
                            <td className="py-1.5 px-3 text-gray-400">
                              {new Date(deal.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </td>
                            <td className="py-1.5 px-3 text-gray-200">{deal.client}</td>
                            <td className={`py-1.5 px-3 text-right ${isRefund ? 'text-red-400' : 'text-white'}`}>
                              {isRefund ? '-' : ''}{fmt(deal.grossAmount)}
                            </td>
                            <td className="py-1.5 px-3 text-center">
                              {deal.financing
                                ? <span className="text-amber-400">Y</span>
                                : <span className="text-gray-600">N</span>
                              }
                            </td>
                            <td className="py-1.5 px-3 text-right text-gray-300">{fmt(deal.netAmount)}</td>
                            <td className={`py-1.5 px-3 text-right font-medium ${deal.commission >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {deal.commission < 0 ? '-' : ''}{fmt(Math.abs(deal.commission))}
                            </td>
                            <td className="py-1.5 px-3 text-right text-amber-400">
                              {deal.pifBonus > 0 ? fmt(deal.pifBonus) : '-'}
                            </td>
                            <td className="py-1.5 px-3 text-center">
                              {(() => {
                                const badge = deal.status === 'Approved'
                                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                  : deal.status === 'Refunded'
                                  ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
                                  : 'bg-red-500/15 text-red-400 border-red-500/30';
                                return (
                                  <span className={`inline-block px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${badge} border`}>
                                    {deal.status}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="py-1.5 px-3 text-center">
                              <input
                                type="checkbox"
                                checked={deal.paid}
                                onChange={() => togglePaid(deal.id, member.name)}
                                className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {isExpanded && member.basedOn === 'deal_cash' && deals.length === 0 && (
                <div className="border-t border-gray-700/30 px-4 py-3 text-xs text-gray-500 text-center">
                  No deals in this period
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Team Totals */}
      <div className="mt-4 bg-gray-800/60 rounded-lg border border-gray-700/50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-gray-500 uppercase font-semibold mb-1">Total Commission Payable</p>
            <p className="text-xl font-bold text-emerald-400">{fmt(teamTotals.totalCommission)}</p>
          </div>
          <div className="flex items-center gap-4">
            {Object.entries(teamTotals.byRole).filter(([, v]) => v > 0).map(([role, amount]) => (
              <div key={role} className="text-right">
                <p className="text-[9px] text-gray-500 uppercase">{ROLE_LABELS[role as TeamMember['role']] ?? role}s</p>
                <p className="text-sm font-medium text-gray-300">{fmt(amount)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Add Team Member Modal */}
      {showAddMember && (
        <AddTeamMemberModal
          onAdd={handleAddMember}
          onClose={() => setShowAddMember(false)}
        />
      )}
    </div>
  );
}

/* ─── Add Team Member Modal ────────────────────────────────────────── */

interface AddTeamMemberModalProps {
  onAdd: (data: { name: string; role: TeamMember['role']; rate: number }) => void;
  onClose: () => void;
}

function AddTeamMemberModal({ onAdd, onClose }: AddTeamMemberModalProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<TeamMember['role']>('closer');
  const [rate, setRate] = useState(10);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({ name: name.trim(), role, rate });
  };

  const inputCls = 'w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#1a1d23] rounded-2xl border border-gray-700 w-full max-w-md mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h3 className="text-white font-semibold text-sm">Add Team Member</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Team member name" className={inputCls} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Role</label>
              <PillSelect
                value={role}
                options={[
                  { value: 'setter', label: 'Setter', color: 'blue' },
                  { value: 'closer', label: 'Closer', color: 'emerald' },
                  { value: 'sales_manager', label: 'Sales Manager', color: 'purple' },
                  { value: 'marketing_manager', label: 'Marketing Manager', color: 'amber' },
                ]}
                onChange={(v) => setRole(v as TeamMember['role'])}
                maxLabelWidth={200}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Commission Rate (%)</label>
              <input
                type="number"
                value={rate}
                onChange={e => setRate(Number(e.target.value))}
                className={inputCls}
                min={0}
                max={100}
                step={0.5}
              />
            </div>
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Add Member
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
