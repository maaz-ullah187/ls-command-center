'use client';

import { Lead } from '@/lib/types';
import { ExternalLink, Search, LinkIcon, ClipboardEdit, Eye } from 'lucide-react';
import { useState, useMemo } from 'react';
import ChannelIcon from './ChannelIcon';
import CallOutcomeForm from './CallOutcomeForm';

function generateGhlUrl(ghlContactId: string): string {
  return `https://app.gohighlevel.com/contacts/detail/${ghlContactId}`;
}

function generateGrainUrl(lead: Lead): string {
  if (lead.grainRecordingId) {
    return `https://grain.com/recordings/${lead.grainRecordingId}`;
  }
  return `https://grain.com/recordings/${lead.id}`;
}

interface CallsTabProps {
  leads: Lead[];
  onUpdateLead?: (leadId: string, updates: Partial<Lead>) => void;
  onOpenLead?: (lead: Lead) => void;
  onOpenCallPanel?: (lead: Lead) => void;
}

const SOURCES = ['All Sources', 'Facebook Ads', 'YouTube', 'Instagram', 'LinkedIn', 'X', 'Referral', 'Unknown'] as const;
const TIMEFRAMES = ['All Time', 'Today', '7 Days', '14 Days', '30 Days'] as const;

type SourceFilter = (typeof SOURCES)[number];
type TimeframeFilter = (typeof TIMEFRAMES)[number];

function getTimeframeDays(tf: TimeframeFilter): number | null {
  switch (tf) {
    case 'Today': return 0;
    case '7 Days': return 7;
    case '14 Days': return 14;
    case '30 Days': return 30;
    default: return null;
  }
}

export default function CallsTab({ leads, onUpdateLead, onOpenLead, onOpenCallPanel }: CallsTabProps) {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('All Sources');
  const [timeframeFilter, setTimeframeFilter] = useState<TimeframeFilter>('All Time');
  const [closerFilter, setCloserFilter] = useState<string>('All Closers');
  const [page, setPage] = useState(0);
  const [outcomeFormLead, setOutcomeFormLead] = useState<Lead | null>(null);
  const perPage = 25;

  // Only leads that had a demo booked (a call was scheduled)
  const calls = useMemo(() => leads.filter(l => l.demoBooked), [leads]);

  // Unique closer list from current calls
  const closerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of calls) {
      if (c.assignedCloser) set.add(c.assignedCloser);
    }
    return ['All Closers', ...Array.from(set).sort()];
  }, [calls]);

  const filtered = useMemo(() => {
    let result = calls;

    // Closer filter
    if (closerFilter !== 'All Closers') {
      result = result.filter(l => l.assignedCloser === closerFilter);
    }

    // Source filter
    if (sourceFilter !== 'All Sources') {
      result = result.filter(l => l.source === sourceFilter);
    }

    // Timeframe filter (based on demoDate)
    const days = getTimeframeDays(timeframeFilter);
    if (days !== null) {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const cutoff = new Date(startOfToday);
      cutoff.setDate(cutoff.getDate() - days);

      result = result.filter(l => {
        if (!l.demoDate) return false;
        const d = new Date(l.demoDate);
        return d >= cutoff;
      });
    }

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q) ||
        l.assignedCloser.toLowerCase().includes(q) ||
        l.campaignName.toLowerCase().includes(q)
      );
    }

    return result;
  }, [calls, sourceFilter, timeframeFilter, closerFilter, search]);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => (b.demoDate || b.date).localeCompare(a.demoDate || a.date)),
    [filtered]
  );

  const pageItems = sorted.slice(page * perPage, (page + 1) * perPage);
  const totalPages = Math.ceil(sorted.length / perPage);

  const originSource = (l: Lead) => {
    if (l.source === 'Facebook Ads') return l.campaignName || 'campaignname';
    if (l.source === 'YouTube') return 'youtube_channel_bio';
    if (l.source === 'Instagram') return l.campaignName || 'instagram';
    return l.campaignName || l.source.toLowerCase();
  };

  const lastSource = (l: Lead) => {
    if (l.source === 'Facebook Ads' && l.adName) return l.adSetName || l.adName;
    if (l.source === 'YouTube') return 'youtube-organic';
    if (l.source === 'Instagram') return l.campaignName === 'ig_dm' ? 'ig_dm' : 'organicpitch';
    return l.source.toLowerCase();
  };

  const callName = (l: Lead) => {
    if (l.program === 'Program A') return 'Call-AI Integration Intro Call';
    return 'Call-AI ROI Audit (Strategy C...';
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const pillBase = 'px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer whitespace-nowrap';
  const pillActive = 'bg-blue-600 text-white';
  const pillInactive = 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300';

  return (
    <div className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden">
      {/* Filter Bar */}
      <div className="px-4 py-3 border-b border-gray-700 space-y-3">
        {/* Source Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-500 uppercase font-semibold mr-1">Source:</span>
          {SOURCES.map(s => (
            <button
              key={s}
              onClick={() => { setSourceFilter(s); setPage(0); }}
              className={`${pillBase} ${sourceFilter === s ? pillActive : pillInactive}`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Timeframe Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-500 uppercase font-semibold mr-1">Timeframe:</span>
          {TIMEFRAMES.map(t => (
            <button
              key={t}
              onClick={() => { setTimeframeFilter(t); setPage(0); }}
              className={`${pillBase} ${timeframeFilter === t ? pillActive : pillInactive}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Closer Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-500 uppercase font-semibold mr-1">Closer:</span>
          {closerOptions.map(c => (
            <button
              key={c}
              onClick={() => { setCloserFilter(c); setPage(0); }}
              className={`${pillBase} ${closerFilter === c ? pillActive : pillInactive}`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Search + Summary */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">
            Showing <strong className="text-white">{sorted.length}</strong> of <strong className="text-white">{calls.length}</strong> calls
          </span>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Lead name, email, Order..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              className="bg-gray-800 border border-gray-600 rounded-lg pl-9 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500 w-64"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-gray-300">
          <thead>
            <tr className="text-[11px] text-gray-500 uppercase border-b border-gray-700/50">
              <th className="text-left py-3 px-3 whitespace-nowrap">Date Booked</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Name</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Source</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Origin Source</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Last Source</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Lead</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Lead Name</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Closer</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Status</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Outcome</th>
              <th className="text-center py-3 px-3 whitespace-nowrap">Recording</th>
              <th className="text-center py-3 px-3 whitespace-nowrap">CRM</th>
              <th className="text-center py-3 px-3 whitespace-nowrap">View</th>
              <th className="text-center py-3 px-3 whitespace-nowrap">Log</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map(l => (
              <tr key={l.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                <td className="py-2.5 px-3 text-xs text-white font-medium whitespace-nowrap">{formatDate(l.demoDate)}</td>
                <td className="py-2.5 px-3 text-white text-xs truncate max-w-[200px]">{callName(l)}</td>
                <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    l.source === 'Facebook Ads' ? 'bg-purple-500/20 text-purple-400' :
                    l.source === 'YouTube' ? 'bg-red-500/20 text-red-400' :
                    l.source === 'Instagram' ? 'bg-pink-500/20 text-pink-400' :
                    l.source === 'LinkedIn' ? 'bg-blue-500/20 text-blue-400' :
                    l.source === 'X' ? 'bg-gray-500/20 text-gray-300' :
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    <ChannelIcon channel={l.source} size={12} />
                    {l.source}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-xs text-gray-400 truncate max-w-[160px]">{originSource(l)}</td>
                <td className="py-2.5 px-3 text-xs text-gray-400 truncate max-w-[140px]">{lastSource(l)}</td>
                <td className="py-2.5 px-3 text-xs text-blue-400 truncate max-w-[180px]">{l.email}</td>
                <td className="py-2.5 px-3 whitespace-nowrap">
                  {onOpenLead ? (
                    <button
                      onClick={() => onOpenLead(l)}
                      className="text-white font-medium hover:text-blue-400 transition-colors"
                    >
                      {l.name}
                    </button>
                  ) : (
                    <span className="text-white font-medium">{l.name}</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-xs text-gray-400 whitespace-nowrap">{l.assignedCloser}</td>
                <td className="py-2.5 px-3 text-xs">
                  {l.showStatus === 'Showed' ? (
                    <span className="text-emerald-400 flex items-center gap-1">✓ Showed</span>
                  ) : l.showStatus === 'No Show' ? (
                    <span className="text-red-400 flex items-center gap-1">✗ No Show</span>
                  ) : l.showStatus === 'Cancelled' ? (
                    <span className="text-amber-400 flex items-center gap-1">⊘ Cancelled</span>
                  ) : l.showStatus === 'Rescheduled' ? (
                    <span className="text-blue-400 flex items-center gap-1">↻ Rescheduled</span>
                  ) : l.demoDate && l.demoDate > new Date().toISOString().slice(0, 10) ? (
                    <span className="text-blue-400/60 flex items-center gap-1">◷ Upcoming</span>
                  ) : (
                    <span className="text-gray-600">Pending</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-xs">
                  {l.callOutcome ? (
                    <span className={l.callOutcome === 'Closed Won' ? 'text-emerald-400 font-medium' : 'text-gray-400'}>
                      {l.callOutcome}
                    </span>
                  ) : (
                    <button
                      onClick={() => setOutcomeFormLead(l)}
                      className="text-gray-600 hover:text-amber-400 hover:underline transition-colors cursor-pointer"
                      title="Click to log outcome"
                    >
                      —
                    </button>
                  )}
                </td>
                <td className="text-center py-2.5 px-3">
                  {l.callOutcome === 'Closed Won' ? (
                    <a href={generateGrainUrl(l)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center text-purple-400 hover:text-purple-300">
                      <ExternalLink size={14} />
                    </a>
                  ) : (
                    <span className="text-gray-600 text-xs">N/A</span>
                  )}
                </td>
                <td className="text-center py-2.5 px-3">
                  <a href={generateGhlUrl(l.ghlContactId)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center w-6 h-6 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 hover:text-blue-300 transition-colors">
                    <LinkIcon size={12} />
                  </a>
                </td>
                <td className="text-center py-2.5 px-3">
                  {onOpenCallPanel && (
                    <button
                      onClick={() => onOpenCallPanel(l)}
                      className="inline-flex items-center justify-center w-6 h-6 rounded bg-purple-600/20 text-purple-400 hover:bg-purple-600/40 hover:text-purple-300 transition-colors"
                      title="Open call detail panel"
                    >
                      <Eye size={12} />
                    </button>
                  )}
                </td>
                <td className="text-center py-2.5 px-3">
                  <button
                    onClick={() => setOutcomeFormLead(l)}
                    className="inline-flex items-center justify-center w-6 h-6 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/40 hover:text-amber-300 transition-colors"
                    title="Log call outcome"
                  >
                    <ClipboardEdit size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 text-xs text-gray-500">
        <span>{perPage} items per page</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30">Prev</button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
            const p = page < 3 ? i : page - 2 + i;
            if (p >= totalPages) return null;
            return (
              <button key={p} onClick={() => setPage(p)} className={`px-2 py-1 rounded ${p === page ? 'bg-blue-600 text-white' : 'bg-gray-800 hover:bg-gray-700'}`}>{p + 1}</button>
            );
          })}
          {totalPages > 5 && <span>... {totalPages}</span>}
          <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30">Next</button>
        </div>
      </div>
      {/* Call Outcome Form Modal */}
      {outcomeFormLead && onUpdateLead && (
        <CallOutcomeForm
          lead={outcomeFormLead}
          onSave={onUpdateLead}
          onClose={() => setOutcomeFormLead(null)}
        />
      )}
    </div>
  );
}
