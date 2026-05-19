'use client';

import { useState, useMemo, useEffect } from 'react';
import { Lead, YouTubeVideo } from '@/lib/types';
import { AlertTriangle, Play, RefreshCw, X, ExternalLink } from 'lucide-react';
import Select from './Select';

interface YouTubeTabProps {
  leads: Lead[];
  videos?: YouTubeVideo[];
}

type FilterMode = 'all' | 'top-cash' | 'top-views' | 'top-leads' | 'missing';
type SortField = 'date' | 'views' | 'leads' | 'cashCollected' | 'contractedRevenue' | 'ctr';

const fmt = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace('.0', '') + 'K';
  return n.toLocaleString();
};
const fmtMoney = (n: number) =>
  '$' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 60) return '1 month ago';
  return `${Math.floor(diffDays / 30)} months ago`;
}

function gradientFor(id: string): string {
  const palette = [
    'from-red-900 via-red-800 to-orange-800',
    'from-purple-900 via-indigo-900 to-blue-900',
    'from-emerald-900 via-teal-900 to-cyan-900',
    'from-amber-900 via-orange-900 to-red-900',
    'from-pink-900 via-rose-900 to-red-900',
    'from-slate-900 via-gray-900 to-zinc-900',
    'from-blue-900 via-sky-900 to-cyan-900',
    'from-violet-900 via-purple-900 to-fuchsia-900',
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

export default function YouTubeTab({ leads: _leads, videos: externalVideos }: YouTubeTabProps) {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public'>('all');
  const [detailVideo, setDetailVideo] = useState<YouTubeVideo | null>(null);

  const videos: YouTubeVideo[] = useMemo(
    () => (externalVideos ?? []).filter((v) => v.source === 'video'),
    [externalVideos]
  );
  const bioEntry = useMemo(() => (externalVideos ?? []).find((v) => v.source === 'bio'), [externalVideos]);

  const totals = useMemo(() => {
    return {
      totalVideos: videos.length,
      totalViews: videos.reduce((s, v) => s + v.views, 0),
      totalClicks: videos.reduce((s, v) => s + (v.deepLinkClicks ?? 0), 0),
      totalLeads: videos.reduce((s, v) => s + v.leads, 0),
      totalBooked: videos.reduce((s, v) => s + v.booked, 0),
      totalCash: videos.reduce((s, v) => s + v.cashCollected, 0),
      totalRevenue: videos.reduce((s, v) => s + v.contractedRevenue, 0),
      missing: videos.filter((v) => v.leads === 0).length,
    };
  }, [videos]);

  const displayedVideos = useMemo(() => {
    let list = [...videos];

    // visibilityFilter removed per the spec — not needed

    if (filter === 'top-cash') {
      list.sort((a, b) => b.cashCollected - a.cashCollected);
      list = list.slice(0, 10);
    } else if (filter === 'top-views') {
      list.sort((a, b) => b.views - a.views);
      list = list.slice(0, 10);
    } else if (filter === 'top-leads') {
      list.sort((a, b) => b.leads - a.leads);
      list = list.slice(0, 10);
    } else if (filter === 'missing') {
      list = list.filter((v) => v.leads === 0);
    }

    list.sort((a, b) => {
      if (sortField === 'date') {
        return sortAsc ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
      }
      const aVal = a[sortField] as number;
      const bVal = b[sortField] as number;
      return sortAsc ? aVal - bVal : bVal - aVal;
    });

    return list;
  }, [videos, filter, sortField, sortAsc, visibilityFilter]);

  const filterButtons: { label: string; value: FilterMode }[] = [
    { label: 'All', value: 'all' },
    { label: 'Top by Cash', value: 'top-cash' },
    { label: 'Top by Views', value: 'top-views' },
    { label: 'Top by Leads', value: 'top-leads' },
    { label: `Missing Links (${totals.missing})`, value: 'missing' },
  ];

  return (
    <div className="space-y-6">
      {/* Summary Bar */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
          <SummaryCell label="Total Videos" value={fmt(totals.totalVideos)} />
          <SummaryCell label="Total Views" value={fmt(totals.totalViews)} className="text-blue-400" />
          <SummaryCell label="Total Clicks" value={fmt(totals.totalClicks)} className="text-cyan-400" />
          <SummaryCell label="Total Leads" value={fmt(totals.totalLeads)} />
          <SummaryCell label="Booked Calls" value={fmt(totals.totalBooked)} />
          <SummaryCell label="Cash Collected" value={fmtMoney(totals.totalCash)} className="text-emerald-400" />
          <SummaryCell label="Contracted Rev" value={fmtMoney(totals.totalRevenue)} className="text-emerald-400" />
        </div>
        {/* Bio link stats included in totals summary above */}
      </div>

      {/* Header Controls Row */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Your YouTube Videos</h2>
            <button className="mt-1 flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              <Play size={11} fill="currentColor" />
              <span>Watch: How YouTube Tracking works</span>
            </button>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors"
            >
              <RefreshCw size={12} />
              Refresh Videos
            </button>
          </div>
        </div>

        {/* Filter + Sort */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2 flex-wrap">
            {filterButtons.map((fb) => (
              <button
                key={fb.value}
                onClick={() => setFilter(fb.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === fb.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 border border-gray-600 hover:text-white hover:border-gray-500'
                }`}
              >
                {fb.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-500">Sort:</span>
            <Select
              size="sm"
              value={sortField}
              onChange={(v) => setSortField(v as SortField)}
              options={[
                { value: 'date', label: 'Date' },
                { value: 'views', label: 'Views' },
                { value: 'leads', label: 'Leads' },
                { value: 'cashCollected', label: 'Cash Collected' },
                { value: 'contractedRevenue', label: 'Revenue' },
                { value: 'ctr', label: 'CTR' },
              ]}
            />
            <button
              onClick={() => setSortAsc(!sortAsc)}
              className="bg-gray-800 border border-gray-600 text-gray-400 hover:text-white text-xs rounded-lg px-2 py-1.5 transition-colors"
              title={sortAsc ? 'Ascending' : 'Descending'}
            >
              {sortAsc ? '\u2191' : '\u2193'}
            </button>
          </div>
        </div>
      </div>

      {/* Bio Link Section */}
      {bioEntry && bioEntry.leads > 0 && (
        <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center">
              <ExternalLink size={14} className="text-white" />
            </div>
            <div>
              <h3 className="text-white font-semibold text-sm">Channel Bio Link</h3>
              <p className="text-[11px] text-gray-500">
                Leads from the link in your YouTube channel bio — not attributed to any specific video.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-center">
            <div className="bg-gray-800/50 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase mb-1">Leads</p>
              <p className="text-lg font-bold text-white">{fmt(bioEntry.leads)}</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase mb-1">Booked</p>
              <p className="text-lg font-bold text-white">{fmt(bioEntry.booked)}</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase mb-1">Showed</p>
              <p className="text-lg font-bold text-white">{fmt(bioEntry.showed)}</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase mb-1">Closed</p>
              <p className="text-lg font-bold text-white">{fmt(bioEntry.closed)}</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase mb-1">Cash</p>
              <p className="text-lg font-bold text-emerald-400">{fmtMoney(bioEntry.cashCollected)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Video Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {displayedVideos.map((video) => (
          <VideoCard key={video.id} video={video} onClick={() => setDetailVideo(video)} />
        ))}
      </div>

      {displayedVideos.length === 0 && (
        <div className="text-center py-12 text-gray-500 bg-[#1a1d23] rounded-xl border border-gray-700">
          No videos match this filter.
        </div>
      )}

      {detailVideo && <VideoDetailModal video={detailVideo} leads={externalVideos ? _leads : []} onClose={() => setDetailVideo(null)} />}
    </div>
  );
}

/* ---------- Video Card ---------- */

function VideoCard({ video, onClick }: { video: YouTubeVideo; onClick: () => void }) {
  const hasMissingLinks = video.leads === 0;
  const gradient = gradientFor(video.id);

  return (
    <button
      onClick={onClick}
      className="group text-left bg-[#1a1d23] rounded-xl border border-gray-700 hover:border-gray-500 overflow-hidden transition-all"
    >
      {/* Thumbnail */}
      <div className={`relative aspect-video bg-gradient-to-br ${gradient} flex items-center justify-center overflow-hidden`}>
        {video.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video.thumbnailUrl} alt={video.title} className="w-full h-full object-cover" />
        ) : (
          <div className="text-center px-4">
            <Play size={40} className="text-white/30 mx-auto mb-2" fill="currentColor" />
            <p className="text-white/60 text-[10px] font-medium line-clamp-2">{video.title}</p>
          </div>
        )}

        {hasMissingLinks && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-600/90 backdrop-blur-sm rounded-full px-2 py-0.5">
            <AlertTriangle size={10} className="text-white" />
            <span className="text-[9px] font-semibold text-white uppercase tracking-wide">Missing links</span>
          </div>
        )}

        {video.isLive && (
          <div className="absolute top-2 right-2 flex items-center gap-1 bg-red-600 rounded px-1.5 py-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            <span className="text-[9px] font-bold text-white uppercase">Live</span>
          </div>
        )}

        {video.duration && !video.isLive && (
          <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-sm rounded px-1.5 py-0.5">
            <span className="text-[10px] font-semibold text-white">{video.duration}</span>
          </div>
        )}

        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
          <Play
            size={48}
            className="text-white/0 group-hover:text-white/90 transition-colors"
            fill="currentColor"
          />
        </div>
      </div>

      {/* Title & Meta */}
      <div className="p-3">
        <h4 className="text-white font-semibold text-sm leading-snug line-clamp-2 mb-1 min-h-[2.5rem]">
          {video.title}
        </h4>
        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-2">
          <span>
            {fmt(video.views)} views · {timeAgo(video.date)}
          </span>
          {!hasMissingLinks && (
            <span className="text-emerald-400 font-medium">{fmtMoney(video.cashCollected)}</span>
          )}
        </div>

        {hasMissingLinks ? (
          <div className="bg-red-950/40 border border-red-900/40 rounded-lg px-2 py-1.5 flex items-center justify-between">
            <span className="text-[10px] text-red-400">Missing deeplinks</span>
            <span className="text-[10px] text-red-300 font-semibold">Add links now!</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-1 text-center mb-1">
              <MiniStat label="Clicks" value={fmt(video.deepLinkClicks ?? 0)} />
              <MiniStat label="Leads" value={fmt(video.leads)} />
              <MiniStat label="Booked" value={fmt(video.booked)} />
              <MiniStat label="Showed" value={fmt(video.showed)} />
              <MiniStat label="Closed" value={fmt(video.closed)} />
            </div>
            <div className="grid grid-cols-3 gap-1 text-center">
              <MiniStat label="CTR" value={video.views > 0 ? `${((video.deepLinkClicks ?? 0) / video.views * 100).toFixed(1)}%` : '—'} />
              <MiniStat label="Opt-in%" value={(video.deepLinkClicks ?? 0) > 0 ? `${(video.leads / (video.deepLinkClicks ?? 1) * 100).toFixed(1)}%` : '—'} />
              <MiniStat label="Book%" value={video.leads > 0 ? `${(video.booked / video.leads * 100).toFixed(1)}%` : '—'} />
            </div>
          </>
        )}
      </div>
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800/50 rounded px-1 py-1">
      <p className="text-[8px] text-gray-500 uppercase">{label}</p>
      <p className="text-[11px] text-white font-semibold">{value}</p>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  className = 'text-white',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-bold ${className}`}>{value}</p>
    </div>
  );
}

/* ---------- Detail Modal ---------- */

interface CommentAnalysis {
  summary?: string;
  whatWorked?: string[];
  whatDidntWork?: string[];
  contentIdeas?: string[];
  sentiment?: string;
  topQuote?: string;
  commentCount?: number;
}

function useCommentAnalysis(videoId: string, title: string, commentCount: number) {
  const [analysis, setAnalysis] = useState<CommentAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (commentCount === 0) return;
    setLoading(true);
    fetch(`/api/youtube/comments?videoId=${encodeURIComponent(videoId)}&title=${encodeURIComponent(title)}`)
      .then(r => r.json())
      .then(data => setAnalysis(data))
      .catch(() => setAnalysis(null))
      .finally(() => setLoading(false));
  }, [videoId, title, commentCount]);

  return { analysis, loading };
}

function VideoDetailModal({ video, leads = [], onClose }: { video: YouTubeVideo; leads?: Lead[]; onClose: () => void }) {
  const gradient = gradientFor(video.id);
  const { analysis, loading: commentLoading } = useCommentAnalysis(video.id, video.title, video.comments);
  const [showLeadList, setShowLeadList] = useState<string | null>(null); // 'leads'|'booked'|'showed'|'closed'|null

  // Get leads attributed to this video (by campaign slug match)
  const videoSlug = video.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  const videoLeads = useMemo(() => {
    return leads.filter(l => {
      if (l.source !== 'YouTube') return false;
      const cn = (l.campaignName || l.adSetName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return cn.includes(videoSlug) || videoSlug.includes(cn.slice(0, 10));
    });
  }, [leads, videoSlug]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#1a1d23] rounded-2xl border border-gray-700 w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-700">
          <div className="flex-1 pr-3">
            <h3 className="text-white font-bold text-base leading-snug">{video.title}</h3>
            <p className="text-xs text-gray-500 mt-1">
              {fmt(video.views)} views · {timeAgo(video.date)} · {video.duration || '-'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <div className={`relative aspect-video bg-gradient-to-br ${gradient} flex items-center justify-center`}>
          {video.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={video.thumbnailUrl} alt={video.title} className="w-full h-full object-cover" />
          ) : (
            <Play size={64} className="text-white/40" fill="currentColor" />
          )}
        </div>

        <div className="px-5 py-4 border-b border-gray-700">
          <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wider mb-3">
            Engagement
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-3 text-center">
            <DetailStat label="Views" value={fmt(video.views)} color="text-blue-400" />
            <DetailStat label="Likes" value={fmt(video.likes)} />
            <DetailStat label="Comments" value={fmt(video.comments)} />
            <DetailStat label="Subs" value={`+${fmt(video.subscribers)}`} color="text-orange-400" />
            <DetailStat label="Watch Hrs" value={fmt(video.watchTimeHours)} />
            <DetailStat label="Avg Dur" value={video.avgViewDuration} />
            <DetailStat label="CTR" value={`${video.ctr.toFixed(1)}%`} color="text-yellow-400" />
          </div>
        </div>

        <div className="px-5 py-4">
          <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wider mb-3">
            Downstream Funnel Impact
          </p>
          {video.leads === 0 ? (
            <div className="bg-red-950/40 border border-red-900/40 rounded-lg p-4 flex items-center gap-3">
              <AlertTriangle size={18} className="text-red-400 shrink-0" />
              <div>
                <p className="text-red-400 text-sm font-semibold">No attribution data</p>
                <p className="text-red-300/80 text-xs mt-0.5">
                  This video has no tracked deeplinks. Add UTM-tagged links in the description to attribute leads.
                </p>
              </div>
            </div>
          ) : (
            <>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
              <button onClick={() => setShowLeadList('leads')} className="hover:bg-gray-700/30 rounded-lg p-1 transition-colors">
                <DetailStat label="Leads" value={fmt(video.leads)} />
              </button>
              <button onClick={() => setShowLeadList('booked')} className="hover:bg-gray-700/30 rounded-lg p-1 transition-colors">
                <DetailStat label="Booked" value={fmt(video.booked)} />
              </button>
              <button onClick={() => setShowLeadList('showed')} className="hover:bg-gray-700/30 rounded-lg p-1 transition-colors">
                <DetailStat label="Showed" value={fmt(video.showed)} />
              </button>
              <button onClick={() => setShowLeadList('closed')} className="hover:bg-gray-700/30 rounded-lg p-1 transition-colors">
                <DetailStat label="Closed" value={fmt(video.closed)} />
              </button>
              <DetailStat label="Cash" value={fmtMoney(video.cashCollected)} color="text-emerald-400" />
              <DetailStat label="Contract Rev" value={fmtMoney(video.contractedRevenue)} color="text-emerald-400" />
            </div>
            {showLeadList && videoLeads.length > 0 && (
              <div className="mt-3 bg-black/20 rounded-lg p-3 border border-gray-800">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">
                    {showLeadList === 'leads' ? 'All Leads' : showLeadList === 'booked' ? 'Booked Leads' : showLeadList === 'showed' ? 'Showed Leads' : 'Closed Leads'} ({
                      showLeadList === 'leads' ? videoLeads.length :
                      showLeadList === 'booked' ? videoLeads.filter(l => l.demoBooked).length :
                      showLeadList === 'showed' ? videoLeads.filter(l => l.showStatus === 'Showed').length :
                      videoLeads.filter(l => l.callOutcome === 'Closed Won' || l.stage === 'Closed Won' || l.cashCollected > 1).length
                    })
                  </p>
                  <button onClick={() => setShowLeadList(null)} className="text-gray-500 hover:text-white text-xs">Close</button>
                </div>
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {(showLeadList === 'leads' ? videoLeads :
                    showLeadList === 'booked' ? videoLeads.filter(l => l.demoBooked) :
                    showLeadList === 'showed' ? videoLeads.filter(l => l.showStatus === 'Showed') :
                    videoLeads.filter(l => l.callOutcome === 'Closed Won' || l.stage === 'Closed Won' || l.cashCollected > 1)
                  ).map(l => (
                    <div key={l.id} className="flex items-center justify-between bg-gray-800/50 rounded px-3 py-1.5 text-xs">
                      <span className="text-white font-medium">{l.name}</span>
                      <span className="text-gray-400">{l.email}</span>
                      <span className={`font-medium ${l.cashCollected > 0 ? 'text-emerald-400' : 'text-gray-500'}`}>
                        {l.cashCollected > 0 ? `$${l.cashCollected.toLocaleString()}` : l.stage}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </>
          )}
        </div>

        {/* Comment Analysis */}
        {video.comments > 0 && (
          <div className="px-5 py-4 border-t border-gray-700">
            <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wider mb-3">
              Comment Analysis ({video.comments} comments)
            </p>
            {commentLoading ? (
              <div className="flex items-center gap-2 text-gray-400 text-xs py-4">
                <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                Analyzing comments with AI...
              </div>
            ) : analysis ? (
              <div className="space-y-3">
                {/* Summary */}
                <p className="text-gray-300 text-xs leading-relaxed">{analysis.summary}</p>

                {/* Sentiment badge */}
                {analysis.sentiment && (
                  <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    analysis.sentiment === 'positive' ? 'bg-emerald-900/40 text-emerald-400' :
                    analysis.sentiment === 'negative' ? 'bg-red-900/40 text-red-400' :
                    'bg-yellow-900/40 text-yellow-400'
                  }`}>
                    {analysis.sentiment.toUpperCase()}
                  </span>
                )}

                {/* Top quote */}
                {analysis.topQuote && (
                  <div className="bg-gray-800/50 border-l-2 border-purple-500 px-3 py-2 rounded-r">
                    <p className="text-gray-400 text-[10px] italic">&ldquo;{analysis.topQuote}&rdquo;</p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* What worked */}
                  {analysis.whatWorked && analysis.whatWorked.length > 0 && (
                    <div>
                      <p className="text-[10px] text-emerald-400 font-semibold mb-1">What Worked</p>
                      <ul className="space-y-0.5">
                        {analysis.whatWorked.map((w, i) => (
                          <li key={i} className="text-gray-400 text-[10px] flex gap-1">
                            <span className="text-emerald-500 shrink-0">+</span> {w}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* What didn't work */}
                  {analysis.whatDidntWork && analysis.whatDidntWork.length > 0 && (
                    <div>
                      <p className="text-[10px] text-red-400 font-semibold mb-1">Improvements</p>
                      <ul className="space-y-0.5">
                        {analysis.whatDidntWork.map((w, i) => (
                          <li key={i} className="text-gray-400 text-[10px] flex gap-1">
                            <span className="text-red-500 shrink-0">-</span> {w}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Content ideas */}
                  {analysis.contentIdeas && analysis.contentIdeas.length > 0 && (
                    <div>
                      <p className="text-[10px] text-blue-400 font-semibold mb-1">Content Ideas</p>
                      <ul className="space-y-0.5">
                        {analysis.contentIdeas.map((w, i) => (
                          <li key={i} className="text-gray-400 text-[10px] flex gap-1">
                            <span className="text-blue-500 shrink-0">→</span> {w}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-gray-500 text-xs">Comment analysis unavailable.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailStat({
  label,
  value,
  color = 'text-white',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <p className="text-[10px] text-gray-500 uppercase mb-1">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{value}</p>
    </div>
  );
}
