'use client';

import { Lead } from '@/lib/types';
import { Search, LinkIcon, ExternalLink, ClipboardEdit } from 'lucide-react';
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

interface SalesTabProps {
  leads: Lead[];
  onUpdateLead?: (leadId: string, updates: Partial<Lead>) => void;
  onOpenLead?: (lead: Lead) => void;
}

const SOURCES = ['All Sources', 'Facebook Ads', 'YouTube', 'Instagram', 'LinkedIn', 'X', 'Referral', 'Unknown'] as const;
const TIMEFRAMES = ['All Time', 'This Month', 'Today', '7 Days', '14 Days', '30 Days'] as const;

type SourceFilter = (typeof SOURCES)[number];
type TimeframeFilter = (typeof TIMEFRAMES)[number];

function getTimeframeCutoff(tf: TimeframeFilter): string | null {
  const now = new Date();
  switch (tf) {
    case 'Today': {
      return now.toISOString().slice(0, 10);
    }
    case 'This Month': {
      return now.toISOString().slice(0, 8) + '01';
    }
    case '7 Days': {
      const d = new Date(now.getTime() - 7 * 86_400_000);
      return d.toISOString().slice(0, 10);
    }
    case '14 Days': {
      const d = new Date(now.getTime() - 14 * 86_400_000);
      return d.toISOString().slice(0, 10);
    }
    case '30 Days': {
      const d = new Date(now.getTime() - 30 * 86_400_000);
      return d.toISOString().slice(0, 10);
    }
    default: return null;
  }
}

export default function SalesTab({ leads, onUpdateLead, onOpenLead }: SalesTabProps) {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('All Sources');
  const [timeframeFilter, setTimeframeFilter] = useState<TimeframeFilter>('All Time');
  const [page, setPage] = useState(0);
  const [outcomeFormLead, setOutcomeFormLead] = useState<Lead | null>(null);
  const perPage = 25;

  // Only closed won leads (sales)
  const sales = useMemo(() => leads.filter(l => l.callOutcome === 'Closed Won' || l.stage === 'Closed Won' || l.stage === 'Refunded' || l.cashCollected > 1), [leads]);

  const filtered = useMemo(() => {
    let result = sales;

    // Source filter
    if (sourceFilter !== 'All Sources') {
      result = result.filter(l => l.source === sourceFilter);
    }

    // Timeframe filter — use close date (payment/slack date) if available, fall back to lead date
    const cutoffDate = getTimeframeCutoff(timeframeFilter);
    if (cutoffDate) {
      result = result.filter(l => {
        const closeDate = (l as any).slackNewClientDate || l.demoDate || l.date;
        return closeDate >= cutoffDate;
      });
    }

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q) ||
        l.assignedCloser.toLowerCase().includes(q) ||
        l.program.toLowerCase().includes(q)
      );
    }

    return result;
  }, [sales, sourceFilter, timeframeFilter, search]);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => b.date.localeCompare(a.date)),
    [filtered]
  );

  const pageItems = sorted.slice(page * perPage, (page + 1) * perPage);
  const totalPages = Math.ceil(sorted.length / perPage);

  // Summary stats for filtered set
  const filteredCash = filtered.reduce((s, l) => s + l.cashCollected, 0);
  const filteredContracted = filtered.reduce((s, l) => s + l.contractedRevenue, 0);

  const originSource = (l: Lead) => {
    if (l.source === 'Facebook Ads') return l.campaignName || 'campaignname';
    if (l.source === 'YouTube') return 'youtube_channel_bio';
    if (l.source === 'Instagram') return l.campaignName || 'instagram';
    return l.campaignName || l.source.toLowerCase();
  };

  const lastSource = (l: Lead) => {
    if (l.source === 'Facebook Ads' && l.adName) return l.adName;
    if (l.source === 'YouTube') return 'youtube-organic';
    return l.source.toLowerCase();
  };

  const pillBase = 'px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap cursor-pointer';
  const pillActive = 'bg-blue-600 text-white';
  const pillInactive = 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200';

  return (
    <div className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden">
      {/* Filter Bar */}
      <div className="px-4 py-3 border-b border-gray-700 space-y-3">
        {/* Source filter row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-500 uppercase font-semibold mr-1">Source</span>
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

        {/* Timeframe filter row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-500 uppercase font-semibold mr-1">Timeframe</span>
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
      </div>

      {/* Header with summary + search */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-6">
          <span className="text-sm text-gray-400">Sales: <strong className="text-white">{filtered.length}</strong></span>
          <span className="text-sm text-gray-400">Cash Collected: <strong className="text-emerald-400">${filteredCash.toLocaleString()}</strong></span>
          <span className="text-sm text-gray-400">Contracted: <strong className="text-emerald-400">${filteredContracted.toLocaleString()}</strong></span>
        </div>
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

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-gray-300">
          <thead>
            <tr className="text-[11px] text-gray-500 uppercase border-b border-gray-700/50">
              <th className="text-left py-3 px-3 whitespace-nowrap">Date Closed</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Lead Name</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Quality</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Program</th>
              <th className="text-right py-3 px-3 whitespace-nowrap">Cash Collected</th>
              <th className="text-right py-3 px-3 whitespace-nowrap">Contracted Revenue</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Origin Source</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Last Source</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Lead</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Closer</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Source Detail</th>
              <th className="text-center py-3 px-3 whitespace-nowrap">Recording</th>
              <th className="text-center py-3 px-3 whitespace-nowrap">CRM</th>
              <th className="text-center py-3 px-3 whitespace-nowrap">Edit</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map(l => (
              <tr key={l.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                <td className="py-2.5 px-3 text-sm text-white font-semibold whitespace-nowrap">
                  {(() => {
                    const closeDate = (l as any).slackNewClientDate || l.demoDate || l.date;
                    if (!closeDate) return '—';
                    const d = new Date(closeDate + 'T00:00:00');
                    if (isNaN(d.getTime())) {
                      // Try parsing the raw value directly (might be ISO or other format)
                      const fallback = new Date(closeDate);
                      if (!isNaN(fallback.getTime())) {
                        return fallback.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      }
                      return '—';
                    }
                    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  })()}
                </td>
                <td className="py-2.5 px-3 whitespace-nowrap">
                  {onOpenLead ? (
                    <button
                      onClick={() => onOpenLead(l)}
                      className="text-white font-medium hover:text-blue-400 transition-colors underline decoration-dotted underline-offset-2"
                    >
                      {l.name}
                    </button>
                  ) : (
                    <span className="text-white font-medium">{l.name}</span>
                  )}
                </td>
                <td className="py-2.5 px-3">
                  {l.qualityScore > 0 ? (
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${
                      l.qualityScore >= 8 ? 'bg-emerald-900/50 text-emerald-300' :
                      l.qualityScore >= 6 ? 'bg-blue-900/50 text-blue-300' :
                      l.qualityScore >= 4 ? 'bg-amber-900/50 text-amber-300' :
                      'bg-red-900/50 text-red-300'
                    }`}>{l.qualityScore.toFixed(1)}</span>
                  ) : <span className="text-gray-600">—</span>}
                </td>
                <td className="py-2.5 px-3 text-xs text-gray-300">{l.program}</td>
                <td className={`text-right py-2.5 px-3 font-bold ${(l as any).wasRefunded ? 'text-red-400' : 'text-emerald-400'}`}>
                  ${l.cashCollected.toLocaleString()}
                  {(l as any).wasRefunded && (
                    <span className="ml-1.5 text-[9px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-medium">REFUNDED</span>
                  )}
                </td>
                <td className="text-right py-2.5 px-3 font-medium text-emerald-300">${l.contractedRevenue.toLocaleString()}</td>
                <td className="py-2.5 px-3 text-xs text-gray-400 truncate max-w-[140px]">
                  <span className="inline-flex items-center gap-1">
                    <ChannelIcon channel={l.source} size={12} className="shrink-0" />
                    {originSource(l)}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-xs text-gray-400 truncate max-w-[140px]">{lastSource(l)}</td>
                <td className="py-2.5 px-3 text-xs text-blue-400 truncate max-w-[180px]">{l.email}</td>
                <td className="py-2.5 px-3 text-xs text-gray-300 font-medium whitespace-nowrap">{l.assignedCloser}</td>
                <td className="py-2.5 px-3 text-xs text-gray-500 truncate max-w-[180px]">
                  {l.source === 'Facebook Ads' ? (
                    <span title={`${l.campaignName} > ${l.adSetName} > ${l.adName}`}>
                      {l.adName || l.campaignName}
                    </span>
                  ) : (
                    <span>{l.campaignName || l.source}</span>
                  )}
                </td>
                <td className="text-center py-2.5 px-3">
                  <a href={generateGrainUrl(l)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center text-purple-400 hover:text-purple-300">
                    <ExternalLink size={14} />
                  </a>
                </td>
                <td className="text-center py-2.5 px-3">
                  <a href={generateGhlUrl(l.ghlContactId)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center w-6 h-6 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 hover:text-blue-300 transition-colors">
                    <LinkIcon size={12} />
                  </a>
                </td>
                <td className="text-center py-2.5 px-3">
                  <button
                    onClick={() => setOutcomeFormLead(l)}
                    className="inline-flex items-center justify-center w-6 h-6 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/40 hover:text-amber-300 transition-colors"
                    title="Edit sale details"
                  >
                    <ClipboardEdit size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Call Outcome Form Modal */}
      {outcomeFormLead && onUpdateLead && (
        <CallOutcomeForm
          lead={outcomeFormLead}
          onSave={onUpdateLead}
          onClose={() => setOutcomeFormLead(null)}
        />
      )}

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
    </div>
  );
}
