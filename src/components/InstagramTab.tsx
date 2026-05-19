'use client';

import { useState, useMemo, Fragment } from 'react';
import { ContentPost, Lead } from '@/lib/types';
import type { ManyChatSummary, ManyChatLead, KeywordPerformance } from '@/lib/mappers/manychat';
import { MessageCircle, Eye, TrendingUp, Trophy, DollarSign, Phone, Users, BarChart3, ExternalLink, Hash, X, Search, ChevronDown, ChevronUp, ArrowUpRight } from 'lucide-react';

interface InstagramTabProps {
  leads: Lead[];
  posts: ContentPost[];
  manychatData: ManyChatSummary;
}

type ContentTypeFilter = 'all' | 'reel' | 'carousel' | 'static';
type TimeFilter = 'all' | '7d' | '30d';
type SortOption = 'latest' | 'views' | 'engagement' | 'reach';
type ActiveSection = 'content' | 'dmFunnel';
type KeywordSort = 'leads' | 'booked' | 'cash' | 'lastLead';

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return '$' + n.toLocaleString();
}

function fmtPct(n: number): string {
  return n.toFixed(1) + '%';
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const typeBadgeColors: Record<string, string> = {
  reel: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  carousel: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  static: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

function TypeBadge({ type }: { type: string }) {
  const colors = typeBadgeColors[type] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${colors}`}>
      {type}
    </span>
  );
}

const stageBadgeColors: Record<string, string> = {
  'DM Close': 'bg-emerald-500/20 text-emerald-400',
  'Call Booked': 'bg-green-500/20 text-green-400',
  'Booking Link Sent': 'bg-blue-500/20 text-blue-400',
  'Opt-In Link Sent': 'bg-cyan-500/20 text-cyan-400',
  'Call Pitched': 'bg-purple-500/20 text-purple-400',
  'Needs Follow Up': 'bg-orange-500/20 text-orange-400',
  'Follow Up': 'bg-orange-500/20 text-orange-400',
  'New Lead': 'bg-yellow-500/20 text-yellow-400',
  'Ghosted': 'bg-gray-500/20 text-gray-400',
  'Low Ticket': 'bg-amber-500/20 text-amber-400',
  'Unrelated': 'bg-gray-500/20 text-gray-400',
  'Bad Leads': 'bg-red-500/20 text-red-400',
};

export default function InstagramTab({ leads, posts, manychatData }: InstagramTabProps) {
  const [section, setSection] = useState<ActiveSection>('content');
  const [typeFilter, setTypeFilter] = useState<ContentTypeFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('latest');
  const [detailPost, setDetailPost] = useState<ContentPost | null>(null);
  const [detailLead, setDetailLead] = useState<ManyChatLead | null>(null);
  const [keywordSearch, setKeywordSearch] = useState('');
  const [keywordSort, setKeywordSort] = useState<KeywordSort>('leads');
  const [expandedKeyword, setExpandedKeyword] = useState<string | null>(null);
  const [expandedColumn, setExpandedColumn] = useState<'leads' | 'booked' | 'showed' | 'won'>('leads');

  const { keywords, stages, overview } = manychatData;
  const mcLeads = manychatData.leads;

  // Content stats
  const contentStats = useMemo(() => {
    const totalViews = posts.reduce((s, p) => s + p.views, 0);
    const totalReach = posts.reduce((s, p) => s + p.reach, 0);
    const avgEngagement = posts.length > 0 ? posts.reduce((s, p) => s + p.engagementRate, 0) / posts.length : 0;
    const totalLikes = posts.reduce((s, p) => s + p.likes, 0);
    const totalComments = posts.reduce((s, p) => s + p.comments, 0);
    const totalSaves = posts.reduce((s, p) => s + (p.saves ?? 0), 0);
    return { totalViews, totalReach, avgEngagement, totalLikes, totalComments, totalSaves };
  }, [posts]);

  // Filter + sort posts
  const filteredPosts = useMemo(() => {
    let result = [...posts];
    if (typeFilter !== 'all') result = result.filter(p => p.type === typeFilter);
    if (timeFilter !== 'all') {
      const cutoff = new Date(Date.now() - (timeFilter === '7d' ? 7 : 30) * 86_400_000);
      result = result.filter(p => new Date(p.date) >= cutoff);
    }
    switch (sortBy) {
      case 'latest': result.sort((a, b) => b.date.localeCompare(a.date)); break;
      case 'views': result.sort((a, b) => b.views - a.views); break;
      case 'engagement': result.sort((a, b) => b.engagementRate - a.engagementRate); break;
      case 'reach': result.sort((a, b) => b.reach - a.reach); break;
    }
    return result;
  }, [posts, typeFilter, timeFilter, sortBy]);

  // Filter + sort keywords
  const filteredKeywords = useMemo(() => {
    let result = [...keywords];
    if (keywordSearch) {
      const q = keywordSearch.toUpperCase();
      result = result.filter(kw => kw.keyword.includes(q));
    }
    switch (keywordSort) {
      case 'leads': result.sort((a, b) => b.leads - a.leads); break;
      case 'booked': result.sort((a, b) => b.booked - a.booked); break;
      case 'cash': result.sort((a, b) => b.cash - a.cash); break;
      case 'lastLead': result.sort((a, b) => b.lastLeadDate.localeCompare(a.lastLeadDate)); break;
    }
    return result;
  }, [keywords, keywordSearch, keywordSort]);

  // Get leads for a specific keyword (for drill-down)
  const leadsForKeyword = useMemo(() => {
    if (!expandedKeyword) return [];
    let filtered = mcLeads.filter(l => l.optinKeyword === expandedKeyword);
    // Filter by column when user clicks a specific metric
    switch (expandedColumn) {
      case 'booked': filtered = filtered.filter(l => l.demoBooked); break;
      case 'showed': filtered = filtered.filter(l => l.showStatus?.toLowerCase() === 'showed'); break;
      case 'won': filtered = filtered.filter(l => l.callOutcome?.toLowerCase() === 'won' || l.cashCollected > 1); break;
      // 'leads' shows all
    }
    return filtered;
  }, [mcLeads, expandedKeyword, expandedColumn]);

  const topByViews = useMemo(() => [...posts].sort((a, b) => b.views - a.views).slice(0, 3), [posts]);
  const topByEngagement = useMemo(() => [...posts].sort((a, b) => b.engagementRate - a.engagementRate).slice(0, 3), [posts]);

  const pillBase = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150';
  const pillActive = 'bg-blue-600 text-white';
  const pillInactive = 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300';

  return (
    <div className="space-y-6">
      {/* Section Toggle */}
      <div className="flex items-center gap-2 bg-[#1a1d23] rounded-xl border border-gray-700 p-1.5 w-fit">
        <button onClick={() => setSection('content')} className={`${pillBase} ${section === 'content' ? pillActive : pillInactive}`}>
          Content Performance
        </button>
        <button onClick={() => setSection('dmFunnel')} className={`${pillBase} ${section === 'dmFunnel' ? pillActive : pillInactive}`}>
          DM Funnel ({fmt(overview.totalLeads)} leads)
        </button>
      </div>

      {section === 'content' && (
        <>
          {/* Content Overview Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label: 'Posts', value: fmt(posts.length), color: 'text-white' },
              { label: 'Total Views', value: fmt(contentStats.totalViews), color: 'text-blue-400' },
              { label: 'Total Reach', value: fmt(contentStats.totalReach), color: 'text-cyan-400' },
              { label: 'Avg Eng%', value: fmtPct(contentStats.avgEngagement), color: contentStats.avgEngagement >= 3 ? 'text-emerald-400' : 'text-yellow-400' },
              { label: 'Likes', value: fmt(contentStats.totalLikes), color: 'text-pink-400' },
              { label: 'Comments', value: fmt(contentStats.totalComments), color: 'text-gray-300' },
              { label: 'Saves', value: fmt(contentStats.totalSaves), color: 'text-purple-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4">
                <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</div>
                <div className={`text-xl font-bold ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 bg-[#1a1d23] rounded-xl border border-gray-700 p-1.5">
              {([['all', 'All'], ['reel', 'Reel'], ['carousel', 'Carousel'], ['static', 'Static']] as [ContentTypeFilter, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setTypeFilter(key)} className={`${pillBase} ${typeFilter === key ? pillActive : pillInactive}`}>{label}</button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 bg-[#1a1d23] rounded-xl border border-gray-700 p-1.5">
              {([['all', 'All Time'], ['7d', '7 Days'], ['30d', '30 Days']] as [TimeFilter, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setTimeFilter(key)} className={`${pillBase} ${timeFilter === key ? pillActive : pillInactive}`}>{label}</button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 bg-[#1a1d23] rounded-xl border border-gray-700 p-1.5">
              {([['latest', 'Latest'], ['views', 'Top Views'], ['engagement', 'Top Eng%'], ['reach', 'Top Reach']] as [SortOption, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setSortBy(key)} className={`${pillBase} ${sortBy === key ? pillActive : pillInactive}`}>{label}</button>
              ))}
            </div>
          </div>

          {/* Post Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredPosts.map(post => (
              <button
                key={post.id}
                onClick={() => setDetailPost(post)}
                className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden hover:border-blue-500/50 transition-colors text-left"
              >
                {/* Thumbnail */}
                {post.thumbnailUrl && (
                  <div className="relative w-full aspect-[3/4] max-h-[220px] bg-gray-900 overflow-hidden">
                    <img src={post.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                    <div className="absolute top-2 left-2"><TypeBadge type={post.type} /></div>
                    <div className="absolute top-2 right-2 text-[11px] text-white/80 bg-black/60 px-2 py-0.5 rounded">{post.date}</div>
                    {post.dmTrigger && (
                      <div className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 bg-emerald-600/90 rounded-lg px-2.5 py-1">
                        <MessageCircle size={11} className="text-white" />
                        <span className="text-[10px] font-bold text-white">{post.dmTrigger.replace(/^DM\s*/, '').replace(/"/g, '')}</span>
                      </div>
                    )}
                  </div>
                )}
                {!post.thumbnailUrl && (
                  <div className="flex items-center justify-between px-4 pt-4 pb-2">
                    <TypeBadge type={post.type} />
                    <span className="text-[11px] text-gray-500">{post.date}</span>
                  </div>
                )}

                {/* Title */}
                <div className="px-4 py-3">
                  <p className="text-sm text-white font-medium leading-snug line-clamp-2">{post.title}</p>
                </div>

                {/* Compact metrics row */}
                <div className="grid grid-cols-4 gap-2 px-4 pb-3">
                  <MetricCell label="VIEWS" value={fmt(post.views)} color="text-blue-400" />
                  <MetricCell label="REACH" value={fmt(post.reach)} color="text-cyan-400" />
                  <MetricCell label="ENG%" value={fmtPct(post.engagementRate)} color={post.engagementRate >= 3 ? 'text-emerald-400' : 'text-white'} />
                  <MetricCell label="SAVES" value={fmt(post.saves)} color="text-purple-400" />
                </div>
              </button>
            ))}
          </div>

          {filteredPosts.length === 0 && (
            <div className="text-center py-16 text-gray-500 text-sm">No posts match the current filters.</div>
          )}

          {/* Top Performing */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RankedList title="Top by Views" icon={<Eye size={14} className="text-blue-400" />} posts={topByViews} metricFn={p => fmt(p.views)} color="text-blue-400" onClick={setDetailPost} />
            <RankedList title="Top by Engagement" icon={<TrendingUp size={14} className="text-emerald-400" />} posts={topByEngagement} metricFn={p => fmtPct(p.engagementRate)} color="text-emerald-400" onClick={setDetailPost} />
          </div>
        </>
      )}

      {section === 'dmFunnel' && (
        <>
          {/* DM Funnel Overview Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Total DM Leads', value: fmt(overview.totalLeads), icon: Users, color: 'text-blue-400' },
              { label: 'Booked', value: fmt(overview.booked), icon: Phone, color: 'text-white' },
              { label: 'Book Rate', value: fmtPct(overview.bookRate), icon: TrendingUp, color: overview.bookRate >= 12 ? 'text-emerald-400' : 'text-yellow-400' },
              { label: 'Showed', value: fmt(overview.showed), icon: Users, color: 'text-white' },
              { label: 'Close Rate', value: fmtPct(overview.closeRate), icon: Trophy, color: overview.closeRate >= 20 ? 'text-emerald-400' : 'text-yellow-400' },
              { label: 'Cash Collected', value: fmtCurrency(overview.cash), icon: DollarSign, color: 'text-emerald-400' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={14} className="text-gray-500" />
                  <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">{label}</span>
                </div>
                <div className={`text-xl font-bold ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Secondary metrics row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4">
              <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1">Show Rate</div>
              <div className={`text-xl font-bold ${overview.showRate >= 70 ? 'text-emerald-400' : 'text-yellow-400'}`}>{fmtPct(overview.showRate)}</div>
            </div>
            <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4">
              <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1">Cash Per Call</div>
              <div className="text-xl font-bold text-emerald-400">{fmtCurrency(overview.cashPerCall)}</div>
            </div>
            <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4">
              <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1">Deal Revenue</div>
              <div className="text-xl font-bold text-emerald-400">{fmtCurrency(overview.dealRev)}</div>
            </div>
            <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4">
              <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1">Won</div>
              <div className="text-xl font-bold text-emerald-400">{fmt(overview.won)}</div>
            </div>
          </div>

          {/* Keyword Performance Table */}
          <div className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
              <Hash size={14} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-white">Keyword Performance</h3>
              {/* Search */}
              <div className="ml-auto flex items-center gap-2">
                <div className="relative">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    placeholder="Search keywords..."
                    value={keywordSearch}
                    onChange={e => setKeywordSearch(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-gray-500 w-40 focus:outline-none focus:border-blue-500"
                  />
                </div>
                {/* Sort pills */}
                <div className="flex items-center gap-1">
                  {([['leads', 'Leads'], ['booked', 'Booked'], ['cash', 'Cash'], ['lastLead', 'Recent']] as [KeywordSort, string][]).map(([key, label]) => (
                    <button key={key} onClick={() => setKeywordSort(key)} className={`px-2 py-1 rounded text-[10px] font-medium ${keywordSort === key ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-gray-500 uppercase tracking-wider border-b border-gray-700/50">
                    <th className="text-left px-4 py-2 font-medium">Keyword</th>
                    <th className="text-right px-3 py-2 font-medium">Leads</th>
                    <th className="text-right px-3 py-2 font-medium">Booked</th>
                    <th className="text-right px-3 py-2 font-medium">Showed</th>
                    <th className="text-right px-3 py-2 font-medium">Won</th>
                    <th className="text-right px-3 py-2 font-medium">Cash</th>
                    <th className="text-right px-3 py-2 font-medium">Deal Rev</th>
                    <th className="text-right px-3 py-2 font-medium">Book %</th>
                    <th className="text-right px-3 py-2 font-medium">Last Lead</th>
                    <th className="text-right px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredKeywords.map((kw, i) => {
                    const bookPct = kw.leads > 0 ? (kw.booked / kw.leads) * 100 : 0;
                    const isExpanded = expandedKeyword === kw.keyword;
                    return (
                      <Fragment key={kw.keyword}>
                        <tr className={`${i % 2 === 0 ? 'bg-[#0f1117]' : ''} hover:bg-gray-700/30 transition-colors cursor-pointer`}>
                          <td className="px-4 py-2.5" onClick={() => { setExpandedKeyword(isExpanded ? null : kw.keyword); setExpandedColumn('leads'); }}>
                            <span className="text-emerald-400 font-mono font-bold text-xs bg-emerald-500/10 px-2 py-0.5 rounded">{kw.keyword}</span>
                          </td>
                          <td className="text-right px-3 py-2.5 text-white font-bold hover:text-blue-400 hover:underline" onClick={() => { setExpandedKeyword(kw.keyword); setExpandedColumn('leads'); }}>
                            {kw.capped ? (
                              <span title="ManyChat API caps at 100 results per keyword. Conversion rates are calculated from the 100 most recent leads." className="cursor-help border-b border-dashed border-gray-500">
                                {kw.leads}+
                              </span>
                            ) : fmt(kw.leads)}
                          </td>
                          <td className="text-right px-3 py-2.5 text-gray-300 hover:text-blue-400 hover:underline" onClick={() => { setExpandedKeyword(kw.keyword); setExpandedColumn('booked'); }}>{fmt(kw.booked)}</td>
                          <td className="text-right px-3 py-2.5 text-gray-300 hover:text-blue-400 hover:underline" onClick={() => { setExpandedKeyword(kw.keyword); setExpandedColumn('showed'); }}>{fmt(kw.showed)}</td>
                          <td className="text-right px-3 py-2.5 text-emerald-400 font-bold hover:text-blue-400 hover:underline" onClick={() => { setExpandedKeyword(kw.keyword); setExpandedColumn('won'); }}>{fmt(kw.won)}</td>
                          <td className="text-right px-3 py-2.5 text-emerald-400">{fmtCurrency(kw.cash)}</td>
                          <td className="text-right px-3 py-2.5 text-emerald-400">{fmtCurrency(kw.dealRev)}</td>
                          <td className="text-right px-3 py-2.5"><span className={bookPct >= 12 ? 'text-emerald-400' : 'text-gray-400'}>{fmtPct(bookPct)}</span></td>
                          <td className="text-right px-3 py-2.5 text-gray-400 text-xs">{formatDate(kw.lastLeadDate)}</td>
                          <td className="text-right px-4 py-2.5">
                            {isExpanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
                          </td>
                        </tr>
                        {/* Expanded leads list */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={10} className="px-4 py-3 bg-[#0a0c10]">
                              <div className="flex items-center gap-2 text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                                <span>{expandedColumn === 'leads' ? 'All leads' : expandedColumn === 'booked' ? 'Booked leads' : expandedColumn === 'showed' ? 'Showed leads' : 'Won leads'} for &quot;{kw.keyword}&quot; ({leadsForKeyword.length})</span>
                                {expandedColumn !== 'leads' && (
                                  <button onClick={() => setExpandedColumn('leads')} className="text-blue-400 hover:text-blue-300 normal-case">Show all</button>
                                )}
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-[300px] overflow-y-auto">
                                {leadsForKeyword.map(lead => (
                                  <DMLeadRow key={lead.id} lead={lead} onClick={setDetailLead} />
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {filteredKeywords.length === 0 && (
                    <tr><td colSpan={10} className="text-center py-8 text-gray-500">No keywords match your search</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Lead Status Breakdown + Recent DM Leads */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Lead Status */}
            <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 size={14} className="text-purple-400" />
                <h3 className="text-sm font-semibold text-white">Lead Status Breakdown</h3>
              </div>
              <div className="space-y-2">
                {stages.map(({ status, count }) => {
                  const pct = overview.totalLeads > 0 ? (count / overview.totalLeads) * 100 : 0;
                  const badgeColor = stageBadgeColors[status] || 'bg-gray-500/20 text-gray-400';
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${badgeColor} w-36 text-center truncate`}>{status}</span>
                      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500/50 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <span className="text-xs text-gray-400 w-12 text-right font-mono">{count}</span>
                      <span className="text-[10px] text-gray-500 w-12 text-right">{fmtPct(pct)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent DM Leads */}
            <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-3">
                <MessageCircle size={14} className="text-blue-400" />
                <h3 className="text-sm font-semibold text-white">Recent DM Leads</h3>
                <span className="text-[11px] text-gray-500 ml-auto">{mcLeads.length} total</span>
              </div>
              <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
                {mcLeads.slice(0, 30).map((lead) => (
                  <DMLeadRow key={lead.id} lead={lead} onClick={setDetailLead} />
                ))}
                {mcLeads.length === 0 && (
                  <div className="text-center py-8 text-gray-500 text-sm">No DM leads yet</div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Post Detail Modal */}
      {detailPost && <PostDetailModal post={detailPost} onClose={() => setDetailPost(null)} />}
      {/* Lead Detail Modal */}
      {detailLead && <MCLeadDetailModal lead={detailLead} onClose={() => setDetailLead(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post Detail Modal (like YouTube's VideoDetailModal)
// ---------------------------------------------------------------------------

function PostDetailModal({ post, onClose }: { post: ContentPost; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#1a1d23] rounded-2xl border border-gray-700 w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-700">
          <div className="flex-1 pr-3">
            <div className="flex items-center gap-2 mb-1.5">
              <TypeBadge type={post.type} />
              <span className="text-[11px] text-gray-500">{post.date} · {timeAgo(post.date)}</span>
            </div>
            <h3 className="text-white font-bold text-base leading-snug">{post.title}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Thumbnail */}
        {post.thumbnailUrl && (
          <div className="relative w-full max-h-[400px] bg-gray-900 overflow-hidden">
            <img src={post.thumbnailUrl} alt={post.title} className="w-full h-full object-contain" />
          </div>
        )}

        {/* Engagement */}
        <div className="px-5 py-4 border-b border-gray-700">
          <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wider mb-3">Engagement</p>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-3 text-center">
            <DetailStat label="Views" value={fmt(post.views)} color="text-blue-400" />
            <DetailStat label="Reach" value={fmt(post.reach)} color="text-cyan-400" />
            <DetailStat label="Eng%" value={fmtPct(post.engagementRate)} color={post.engagementRate >= 3 ? 'text-emerald-400' : 'text-white'} />
            <DetailStat label="Follows" value={post.follows > 0 ? `+${fmt(post.follows)}` : '0'} color={post.follows > 0 ? 'text-emerald-400' : 'text-gray-500'} />
            <DetailStat label="Likes" value={fmt(post.likes)} />
            <DetailStat label="Comments" value={fmt(post.comments)} />
            <DetailStat label="Shares" value={fmt(post.shares)} />
            <DetailStat label="Saves" value={fmt(post.saves)} color="text-purple-400" />
          </div>
        </div>

        {/* DM Trigger Info */}
        {post.dmTrigger && (
          <div className="px-5 py-4 border-b border-gray-700">
            <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wider mb-3">DM Call-to-Action</p>
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-2">
                <MessageCircle size={16} className="text-emerald-400" />
                <span className="text-sm font-bold text-emerald-400">{post.dmTrigger.replace(/^DM\s*/, '').replace(/"/g, '')}</span>
              </div>
              <div className="text-xs text-gray-400">
                {post.dmReplies > 0 ? `${fmt(post.dmReplies)} replies` : 'No reply data yet'}
              </div>
            </div>
          </div>
        )}

        {/* Link to Post */}
        <div className="px-5 py-4">
          <a
            href={post.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <ArrowUpRight size={14} />
            View on Instagram
          </a>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ManyChat Lead Detail Modal
// ---------------------------------------------------------------------------

function MCLeadDetailModal({ lead, onClose }: { lead: ManyChatLead; onClose: () => void }) {
  const badgeColor = stageBadgeColors[lead.stage] || 'bg-gray-500/20 text-gray-400';
  const hasGHL = !!lead.ghlLeadId;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#1a1d23] rounded-2xl border border-gray-700 w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            {lead.profilePic ? (
              <img src={lead.profilePic} alt="" className="w-12 h-12 rounded-full object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center">
                <Users size={20} className="text-gray-500" />
              </div>
            )}
            <div>
              <h3 className="text-white font-bold text-lg">{lead.name || 'Unknown'}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                {lead.igUsername && (
                  <a href={`https://instagram.com/${lead.igUsername}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300">
                    @{lead.igUsername}
                  </a>
                )}
                <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${badgeColor}`}>{lead.stage}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-black/20 rounded-lg p-3 border border-gray-800">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Keyword</div>
              <div className="text-sm font-bold text-emerald-400 font-mono">{lead.optinKeyword || '—'}</div>
            </div>
            <div className="bg-black/20 rounded-lg p-3 border border-gray-800">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Setter</div>
              <div className="text-sm font-semibold text-white">{lead.setter || 'James'}</div>
            </div>
            <div className="bg-black/20 rounded-lg p-3 border border-gray-800">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Subscribed</div>
              <div className="text-sm font-semibold text-white">{formatDate(lead.subscribedAt)}</div>
            </div>
            <div className="bg-black/20 rounded-lg p-3 border border-gray-800">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Last Active</div>
              <div className="text-sm font-semibold text-white">{lead.lastInteraction ? timeAgo(lead.lastInteraction) : '—'}</div>
            </div>
          </div>

          {/* DM Info */}
          <div>
            <h4 className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-3">DM Context</h4>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-gray-800/50">
                  <span className="text-gray-500">Trigger Source</span>
                  <span className="text-gray-200">{lead.triggerSource || 'DM'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-gray-800/50">
                  <span className="text-gray-500">Type</span>
                  <span className="text-gray-200">{lead.adsType || 'Organic'}</span>
                </div>
                {lead.email && (
                  <div className="flex justify-between py-1 border-b border-gray-800/50">
                    <span className="text-gray-500">Email</span>
                    <span className="text-gray-200">{lead.email}</span>
                  </div>
                )}
              </div>
              {lead.lastMessage && (
                <div className="bg-black/20 rounded-lg p-3 border border-gray-800 mt-2">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Last Message</p>
                  <p className="text-xs text-gray-300 italic">&ldquo;{lead.lastMessage}&rdquo;</p>
                </div>
              )}
            </div>
          </div>

          {/* GHL Cross-Reference */}
          {hasGHL && (
            <div>
              <h4 className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-3">Sales Pipeline (GHL)</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-black/20 rounded-lg p-3 border border-gray-800">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Demo Booked</div>
                  <div className={`text-sm font-bold ${lead.demoBooked ? 'text-emerald-400' : 'text-gray-500'}`}>
                    {lead.demoBooked ? 'Yes' : 'No'}
                  </div>
                </div>
                <div className="bg-black/20 rounded-lg p-3 border border-gray-800">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Show Status</div>
                  <div className="text-sm font-semibold text-white">{lead.showStatus || '—'}</div>
                </div>
                <div className="bg-black/20 rounded-lg p-3 border border-gray-800">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Call Outcome</div>
                  <div className={`text-sm font-bold ${lead.callOutcome === 'won' ? 'text-emerald-400' : 'text-white'}`}>
                    {lead.callOutcome || '—'}
                  </div>
                </div>
                <div className="bg-black/20 rounded-lg p-3 border border-gray-800">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Closer</div>
                  <div className="text-sm font-semibold text-white">{lead.closer || '—'}</div>
                </div>
                <div className="bg-black/20 rounded-lg p-3 border border-gray-800">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Cash Collected</div>
                  <div className="text-sm font-bold text-emerald-400">{lead.cashCollected > 0 ? fmtCurrency(lead.cashCollected) : '—'}</div>
                </div>
                <div className="bg-black/20 rounded-lg p-3 border border-gray-800">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Deal Revenue</div>
                  <div className="text-sm font-bold text-emerald-400">{lead.contractedRevenue > 0 ? fmtCurrency(lead.contractedRevenue) : '—'}</div>
                </div>
              </div>
            </div>
          )}

          {!hasGHL && (
            <div className="bg-yellow-900/20 border border-yellow-500/20 rounded-lg p-3 flex items-center gap-2">
              <span className="text-yellow-400 text-xs">No GHL match — this lead hasn&apos;t entered the sales pipeline yet or the name/email doesn&apos;t match a GHL contact.</span>
            </div>
          )}

          {/* External Links */}
          <div className="flex flex-wrap gap-2">
            {lead.chatLink && (
              <a href={lead.chatLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-400 text-xs font-medium rounded-lg px-3 py-2 transition-colors">
                <MessageCircle size={12} />
                Open in ManyChat
                <ExternalLink size={10} />
              </a>
            )}
            {lead.igUsername && (
              <a href={`https://instagram.com/${lead.igUsername}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 bg-pink-600/20 hover:bg-pink-600/30 border border-pink-500/40 text-pink-400 text-xs font-medium rounded-lg px-3 py-2 transition-colors">
                <Users size={12} />
                View on Instagram
                <ExternalLink size={10} />
              </a>
            )}
            {hasGHL && (
              <a href={`https://app.gohighlevel.com/v2/location/${process.env.NEXT_PUBLIC_GHL_LOCATION_ID ?? ''}/contacts/detail/${lead.ghlLeadId}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-400 text-xs font-medium rounded-lg px-3 py-2 transition-colors">
                <ExternalLink size={12} />
                Open in GHL
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function DMLeadRow({ lead, onClick }: { lead: ManyChatLead; onClick?: (lead: ManyChatLead) => void }) {
  const badgeColor = stageBadgeColors[lead.stage] || 'bg-gray-500/20 text-gray-400';
  return (
    <button onClick={() => onClick?.(lead)} className="flex items-center gap-2 bg-[#0f1117] rounded-lg px-3 py-2 hover:bg-gray-700/30 transition-colors w-full text-left">
      {lead.profilePic ? (
        <img src={lead.profilePic} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
          <Users size={12} className="text-gray-500" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-white font-medium truncate">{lead.name || lead.igUsername || 'Unknown'}</span>
          {lead.igUsername && <span className="text-[10px] text-gray-500">@{lead.igUsername}</span>}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {lead.optinKeyword && (
            <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">{lead.optinKeyword}</span>
          )}
          <span className={`text-[9px] px-1.5 py-0.5 rounded ${badgeColor}`}>{lead.stage}</span>
          {lead.subscribedAt && (
            <span className="text-[9px] text-gray-600">{formatDate(lead.subscribedAt)}</span>
          )}
        </div>
      </div>
      {lead.chatLink && (
        <a href={lead.chatLink} target="_blank" rel="noopener noreferrer" className="shrink-0 text-gray-500 hover:text-blue-400" onClick={e => e.stopPropagation()}>
          <ExternalLink size={12} />
        </a>
      )}
    </button>
  );
}

function DetailStat({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[9px] text-gray-500 uppercase tracking-wider font-medium">{label}</div>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}

function MetricCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="text-[9px] text-gray-500 uppercase tracking-wider font-medium">{label}</div>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}

function RankedList({
  title, icon, posts, metricFn, color, onClick,
}: {
  title: string; icon: React.ReactNode; posts: ContentPost[]; metricFn: (p: ContentPost) => string; color: string; onClick: (p: ContentPost) => void;
}) {
  return (
    <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <div className="space-y-2">
        {posts.map((post, i) => (
          <button key={post.id} onClick={() => onClick(post)} className="flex items-center gap-3 bg-[#0f1117] rounded-lg px-3 py-2.5 hover:bg-gray-700/30 transition-colors w-full text-left">
            <span className={`text-sm font-bold w-5 text-center ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : 'text-amber-700'}`}>
              {i + 1}
            </span>
            {post.thumbnailUrl && <img src={post.thumbnailUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <TypeBadge type={post.type} />
                <p className="text-xs text-white font-medium truncate">{post.title}</p>
              </div>
            </div>
            <span className={`text-sm font-bold ${color} shrink-0`}>{metricFn(post)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
