'use client';

import { Lead, Channel } from '@/lib/types';
import { ExternalLink, Search, Calendar, LinkIcon, ClipboardEdit } from 'lucide-react';
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

interface LeadsTabProps {
  leads: Lead[];
  onUpdateLead?: (leadId: string, updates: Partial<Lead>) => void;
  onOpenLead?: (lead: Lead) => void;
}

const SOURCES: (Channel | 'All Sources')[] = ['All Sources', 'Facebook Ads', 'YouTube', 'Instagram', 'LinkedIn', 'X', 'Referral', 'Unknown'];
type Timeframe = 'All Time' | 'Today' | '7 Days' | '14 Days' | '30 Days' | 'Custom';
const TIMEFRAMES: Timeframe[] = ['All Time', 'Today', '7 Days', '14 Days', '30 Days', 'Custom'];

function getDateThreshold(timeframe: Timeframe): Date | null {
  if (timeframe === 'All Time' || timeframe === 'Custom') return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (timeframe === 'Today') return now;
  if (timeframe === '7 Days') { now.setDate(now.getDate() - 7); return now; }
  if (timeframe === '14 Days') { now.setDate(now.getDate() - 14); return now; }
  if (timeframe === '30 Days') { now.setDate(now.getDate() - 30); return now; }
  return null;
}

export default function LeadsTab({ leads, onUpdateLead, onOpenLead }: LeadsTabProps) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [outcomeFormLead, setOutcomeFormLead] = useState<Lead | null>(null);
  const [sourceFilter, setSourceFilter] = useState<Channel | 'All Sources'>('All Sources');
  const [timeframe, setTimeframe] = useState<Timeframe>('All Time');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const perPage = 25;

  const filtered = useMemo(() => {
    let result = leads;

    // Source filter
    if (sourceFilter !== 'All Sources') {
      result = result.filter(l => l.source === sourceFilter);
    }

    // Timeframe filter
    if (timeframe === 'Custom') {
      if (customFrom) {
        result = result.filter(l => l.date >= customFrom);
      }
      if (customTo) {
        result = result.filter(l => l.date <= customTo);
      }
    } else {
      const threshold = getDateThreshold(timeframe);
      if (threshold) {
        const thresholdStr = threshold.toISOString().split('T')[0];
        result = result.filter(l => l.date >= thresholdStr);
      }
    }

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q) ||
        l.source.toLowerCase().includes(q) ||
        l.campaignName.toLowerCase().includes(q) ||
        l.adName.toLowerCase().includes(q)
      );
    }

    return result;
  }, [leads, search, sourceFilter, timeframe, customFrom, customTo]);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => b.date.localeCompare(a.date)),
    [filtered]
  );

  const pageLeads = sorted.slice(page * perPage, (page + 1) * perPage);
  const totalPages = Math.ceil(sorted.length / perPage);

  const sourceLabel = (l: Lead) => {
    if (l.source === 'Facebook Ads') return l.campaignName || 'Facebook Ads';
    if (l.source === 'YouTube') return l.campaignName || 'YouTube';
    if (l.source === 'Instagram') return l.campaignName || 'Instagram';
    return l.source;
  };

  const lastSource = (l: Lead) => {
    if (l.source === 'Facebook Ads' && l.adName) return l.adName;
    if (l.source === 'YouTube') return l.campaignName || 'youtube-organic';
    if (l.source === 'Instagram') return l.campaignName === 'ig_dm' ? 'ig_dm' : l.campaignName || 'instagram';
    return l.campaignName || l.source.toLowerCase();
  };

  const timeframeLabel = timeframe === 'Custom'
    ? (customFrom || customTo ? `${customFrom || '...'} to ${customTo || '...'}` : 'Custom')
    : timeframe === 'All Time' ? 'All Time'
    : `Last ${timeframe}`;

  return (
    <div className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden">
      {/* Filter Bar */}
      <div className="px-4 py-3 border-b border-gray-700 space-y-3">
        {/* Source filter pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-gray-500 uppercase font-medium mr-1">Source</span>
          <div className="flex items-center gap-1 bg-gray-800/60 rounded-lg p-1">
            {SOURCES.map(src => (
              <button
                key={src}
                onClick={() => { setSourceFilter(src); setPage(0); }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  sourceFilter === src
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
                }`}
              >
                {src}
              </button>
            ))}
          </div>
        </div>

        {/* Timeframe filter pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-gray-500 uppercase font-medium mr-1">
            <Calendar size={11} className="inline -mt-0.5 mr-1" />
            Period
          </span>
          <div className="flex items-center gap-1 bg-gray-800/60 rounded-lg p-1">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => { setTimeframe(tf); setPage(0); }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  timeframe === tf
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
          {timeframe === 'Custom' && (
            <div className="flex items-center gap-2 ml-2">
              <input
                type="date"
                value={customFrom}
                onChange={e => { setCustomFrom(e.target.value); setPage(0); }}
                className="bg-gray-800 border border-gray-600 rounded-md px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
              />
              <span className="text-gray-500 text-xs">to</span>
              <input
                type="date"
                value={customTo}
                onChange={e => { setCustomTo(e.target.value); setPage(0); }}
                className="bg-gray-800 border border-gray-600 rounded-md px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}
        </div>

        {/* Search + Filter Summary row */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">
            Showing <strong className="text-white">{sorted.length}</strong> of <strong className="text-white">{leads.length}</strong> leads
            {sourceFilter !== 'All Sources' && (
              <span> | Source: <strong className="text-blue-400">{sourceFilter}</strong></span>
            )}
            <span> | Timeframe: <strong className="text-blue-400">{timeframeLabel}</strong></span>
          </span>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Name, email, source..."
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
              <th className="text-left py-3 px-3 whitespace-nowrap">Date Opted In</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Lead</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Name</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">First Source</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Last Source</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Program</th>
              <th className="text-right py-3 px-3 whitespace-nowrap">Revenue</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Status</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Demo Date</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Stage</th>
              <th className="text-left py-3 px-3 whitespace-nowrap">Ad / Source Detail</th>
              <th className="text-center py-3 px-3 whitespace-nowrap">Recording</th>
              <th className="text-center py-3 px-3 whitespace-nowrap">CRM</th>
              <th className="text-center py-3 px-3 whitespace-nowrap">Log</th>
            </tr>
          </thead>
          <tbody>
            {pageLeads.map(l => (
              <tr key={l.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                <td className="py-2.5 px-3 text-xs text-gray-300 font-medium whitespace-nowrap">{l.date}</td>
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
                <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                    l.source === 'Facebook Ads' ? 'bg-blue-900/50 text-blue-300' :
                    l.source === 'YouTube' ? 'bg-red-900/50 text-red-300' :
                    l.source === 'Instagram' ? 'bg-pink-900/50 text-pink-300' :
                    l.source === 'LinkedIn' ? 'bg-sky-900/50 text-sky-300' :
                    l.source === 'X' ? 'bg-gray-700 text-gray-300' :
                    'bg-purple-900/50 text-purple-300'
                  }`}>
                    <ChannelIcon channel={l.source} size={12} />
                    {sourceLabel(l)}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-xs text-gray-400 truncate max-w-[160px]">{lastSource(l)}</td>
                <td className="py-2.5 px-3 text-xs text-gray-400">{l.program}</td>
                <td className="text-right py-2.5 px-3 font-medium">
                  {l.cashCollected > 0 ? (
                    <span className="text-emerald-400">${l.cashCollected.toLocaleString()}</span>
                  ) : (
                    <span className="text-gray-600">$0.00</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    {l.showStatus ? (
                      <span className={l.showStatus === 'Showed' ? 'text-emerald-400' : 'text-red-400'}>
                        {l.showStatus}
                      </span>
                    ) : (
                      <span className="text-gray-600">No Info</span>
                    )}
                    {l.paymentFailed && (
                      <span
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-red-900/50 text-red-300 text-[10px] font-medium whitespace-nowrap"
                        title={`Payment Failed${l.paymentFailedReason ? `: ${l.paymentFailedReason}` : ''}${l.paymentFailedAmount ? ` ($${l.paymentFailedAmount})` : ''}${l.paymentFailedDate ? ` on ${l.paymentFailedDate}` : ''}`}
                      >
                        ⚠ Failed
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                  {l.demoDate ? (
                    <span className={
                      l.calendlyStatus === 'active' ? 'text-emerald-400 font-medium' :
                      l.calendlyStatus === 'canceled' ? 'text-red-400 line-through' :
                      'text-gray-400'
                    }>
                      {new Date(l.demoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-xs text-gray-400">{l.stage}</td>
                <td className="py-2.5 px-3 text-xs text-gray-500 truncate max-w-[200px]">
                  {l.source === 'Facebook Ads' ? (
                    <span title={`${l.campaignName} > ${l.adSetName} > ${l.adName}`}>
                      {l.adName || l.adSetName || l.campaignName || '—'}
                    </span>
                  ) : (
                    <span>{l.campaignName || l.source}</span>
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
                  {l.demoBooked && (
                    <button
                      onClick={() => setOutcomeFormLead(l)}
                      className="inline-flex items-center justify-center w-6 h-6 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/40 hover:text-amber-300 transition-colors"
                      title="Log call outcome"
                    >
                      <ClipboardEdit size={12} />
                    </button>
                  )}
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
