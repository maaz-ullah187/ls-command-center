'use client';

import { useState, useMemo } from 'react';
import { Lead } from '@/lib/types';
import { getCloserStats } from '@/lib/mock-data';
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  FileText,
} from 'lucide-react';
import Select from './Select';

interface EODReportsViewProps {
  leads: Lead[];
}

interface DailyCloserReport {
  closer: string;
  date: string;
  calls: number;
  shows: number;
  noShows: number;
  cancelled: number;
  closed: number;
  followUps: number;
  cashCollected: number;
  contractedRevenue: number;
  showRate: number;
  closeRate: number;
  cashPerCall: number;
  formSubmitted: boolean; // true if all calls that day have outcomes logged
  unloggedCount: number;
}

function buildReports(leads: Lead[]): DailyCloserReport[] {
  // Group leads by closer + demoDate
  const grouped = new Map<string, Lead[]>();
  for (const lead of leads) {
    if (!lead.demoBooked || !lead.assignedCloser || !lead.demoDate) continue;
    const key = `${lead.assignedCloser}|${lead.demoDate}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(lead);
  }

  const reports: DailyCloserReport[] = [];
  for (const [key, groupLeads] of grouped.entries()) {
    const [closer, date] = key.split('|');
    const calls = groupLeads.length;
    const shows = groupLeads.filter((l) => l.showStatus === 'Showed').length;
    const noShows = groupLeads.filter((l) => l.showStatus === 'No Show').length;
    const cancelled = groupLeads.filter(
      (l) => l.showStatus === 'Cancelled' || l.showStatus === 'Rescheduled'
    ).length;
    const isWon = (l: Lead) => l.callOutcome === 'Closed Won' || l.stage === 'Closed Won' || l.cashCollected > 1;
    const closed = groupLeads.filter(isWon).length;
    const followUps = groupLeads.filter((l) => l.callOutcome === 'Follow Up Booked').length;
    const cashCollected = groupLeads
      .filter(isWon)
      .reduce((s, l) => s + l.cashCollected, 0);
    const contractedRevenue = groupLeads
      .filter(isWon)
      .reduce((s, l) => s + l.contractedRevenue, 0);
    const unloggedCount = groupLeads.filter(
      (l) => l.showStatus === 'Showed' && !l.callOutcome
    ).length;

    reports.push({
      closer,
      date,
      calls,
      shows,
      noShows,
      cancelled,
      closed,
      followUps,
      cashCollected,
      contractedRevenue,
      showRate: (calls - cancelled) > 0 ? (shows / (calls - cancelled)) * 100 : 0,
      closeRate: shows > 0 ? (closed / shows) * 100 : 0,
      cashPerCall: calls > 0 ? cashCollected / calls : 0,
      formSubmitted: unloggedCount === 0,
      unloggedCount,
    });
  }

  // Sort by date desc, then closer
  reports.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.closer.localeCompare(b.closer);
  });

  return reports;
}

export default function EODReportsView({ leads }: EODReportsViewProps) {
  const [closerFilter, setCloserFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'submitted' | 'pending'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const reports = useMemo(() => buildReports(leads), [leads]);

  const closerList = useMemo(
    () => Array.from(new Set(reports.map((r) => r.closer))).sort(),
    [reports]
  );

  const filtered = useMemo(() => {
    let list = reports;
    if (closerFilter !== 'all') list = list.filter((r) => r.closer === closerFilter);
    if (statusFilter === 'submitted') list = list.filter((r) => r.formSubmitted);
    if (statusFilter === 'pending') list = list.filter((r) => !r.formSubmitted);
    return list;
  }, [reports, closerFilter, statusFilter]);

  // Totals
  const totals = useMemo(() => {
    return {
      total: reports.length,
      submitted: reports.filter((r) => r.formSubmitted).length,
      pending: reports.filter((r) => !r.formSubmitted).length,
      unloggedCalls: reports.reduce((s, r) => s + r.unloggedCount, 0),
    };
  }, [reports]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-white font-bold text-base flex items-center gap-2">
              <FileText size={16} className="text-blue-400" />
              End-of-Day Reports
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Per-closer daily reports. Rows marked PENDING still have unlogged calls.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              size="sm"
              value={closerFilter}
              onChange={setCloserFilter}
              options={[
                { value: 'all', label: 'All Closers' },
                ...closerList.map((c) => ({ value: c, label: c })),
              ]}
            />
            <Select
              size="sm"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as typeof statusFilter)}
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'submitted', label: 'Submitted' },
                { value: 'pending', label: 'Pending' },
              ]}
            />
          </div>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Reports" value={totals.total.toString()} />
          <StatCard
            label="Submitted"
            value={totals.submitted.toString()}
            color="text-emerald-400"
            icon={<CheckCircle2 size={14} />}
          />
          <StatCard
            label="Pending"
            value={totals.pending.toString()}
            color="text-amber-400"
            icon={<Clock size={14} />}
          />
          <StatCard
            label="Unlogged Calls"
            value={totals.unloggedCalls.toString()}
            color="text-red-400"
            icon={<AlertCircle size={14} />}
          />
        </div>
      </div>

      {/* Reports table */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700 text-[10px] text-gray-500 uppercase">
                <th className="text-left py-3 px-4 w-8"></th>
                <th className="text-left py-3 px-4">Date</th>
                <th className="text-left py-3 px-4">Closer</th>
                <th className="text-right py-3 px-4">Calls</th>
                <th className="text-right py-3 px-4">Shows</th>
                <th className="text-right py-3 px-4">Show Rate</th>
                <th className="text-right py-3 px-4">Closed</th>
                <th className="text-right py-3 px-4">Close Rate</th>
                <th className="text-right py-3 px-4">Cash</th>
                <th className="text-right py-3 px-4">$/Call</th>
                <th className="text-center py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-12 text-gray-500">
                    No EOD reports match these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const key = `${r.closer}|${r.date}`;
                  const isExpanded = expanded.has(key);
                  return (
                    <>
                      <tr
                        key={key}
                        className="border-b border-gray-800 hover:bg-gray-800/40 cursor-pointer transition-colors"
                        onClick={() => toggle(key)}
                      >
                        <td className="py-3 px-4 text-gray-500">
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </td>
                        <td className="py-3 px-4 text-white font-medium whitespace-nowrap">
                          {formatDate(r.date)}
                        </td>
                        <td className="py-3 px-4 text-gray-300">{r.closer}</td>
                        <td className="text-right py-3 px-4 text-gray-300">{r.calls}</td>
                        <td className="text-right py-3 px-4 text-gray-300">{r.shows}</td>
                        <td
                          className={`text-right py-3 px-4 font-medium ${
                            r.showRate >= 70
                              ? 'text-emerald-400'
                              : r.showRate >= 50
                              ? 'text-amber-400'
                              : 'text-red-400'
                          }`}
                        >
                          {r.showRate.toFixed(0)}%
                        </td>
                        <td className="text-right py-3 px-4 text-gray-300">{r.closed}</td>
                        <td
                          className={`text-right py-3 px-4 font-medium ${
                            r.closeRate >= 30 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {r.closeRate.toFixed(0)}%
                        </td>
                        <td className="text-right py-3 px-4 text-emerald-400 font-semibold">
                          ${r.cashCollected.toLocaleString()}
                        </td>
                        <td className="text-right py-3 px-4 text-gray-300">
                          ${r.cashPerCall.toFixed(0)}
                        </td>
                        <td className="text-center py-3 px-4">
                          {r.formSubmitted ? (
                            <span className="inline-flex items-center gap-1 bg-emerald-500/15 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">
                              <CheckCircle2 size={10} /> SUBMITTED
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 bg-amber-500/15 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/30">
                              <Clock size={10} /> {r.unloggedCount} UNLOGGED
                            </span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-black/20 border-b border-gray-800">
                          <td colSpan={11} className="px-12 py-4">
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-[11px]">
                              <BreakdownStat label="Shows" value={r.shows} total={r.calls} />
                              <BreakdownStat label="No Shows" value={r.noShows} total={r.calls} color="text-red-400" />
                              <BreakdownStat label="Cancelled" value={r.cancelled} total={r.calls} color="text-amber-400" />
                              <BreakdownStat label="Closed Won" value={r.closed} total={r.shows} color="text-emerald-400" />
                              <BreakdownStat label="Follow Ups" value={r.followUps} total={r.shows} color="text-blue-400" />
                            </div>
                            <div className="mt-3 pt-3 border-t border-gray-800 flex items-center justify-between">
                              <div className="text-[10px] text-gray-500 uppercase tracking-wider">
                                Contracted Revenue:{' '}
                                <span className="text-emerald-400 font-semibold">
                                  ${r.contractedRevenue.toLocaleString()}
                                </span>
                              </div>
                              {!r.formSubmitted && (
                                <span className="text-[11px] text-amber-400">
                                  ⚠️ {r.unloggedCount} call{r.unloggedCount > 1 ? 's' : ''} need outcome logged to complete this report
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* Sub-components */

function StatCard({
  label,
  value,
  color = 'text-white',
  icon,
}: {
  label: string;
  value: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-black/20 rounded-lg border border-gray-800 p-3">
      <div className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wider mb-1">
        {icon}
        {label}
      </div>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

function BreakdownStat({
  label,
  value,
  total,
  color = 'text-white',
}: {
  label: string;
  value: number;
  total: number;
  color?: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <p className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`font-semibold ${color}`}>
        {value} <span className="text-gray-600 text-[10px]">({pct.toFixed(0)}%)</span>
      </p>
    </div>
  );
}
