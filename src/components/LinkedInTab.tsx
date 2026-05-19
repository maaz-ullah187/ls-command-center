'use client';

import { ContentPost } from '@/lib/types';
import { Lead } from '@/lib/types';
import { useState, useMemo } from 'react';
import PillSelect from './PillSelect';

interface LinkedInTabProps {
  leads: Lead[];
  posts: ContentPost[];
}

type ContentFilter = 'all' | 'post' | 'article';
type SortOption = 'date' | 'views' | 'engagement' | 'revenue';
type TimeFilter = 'all' | '7d' | '30d';

export default function LinkedInTab({ leads, posts: inputPosts }: LinkedInTabProps) {
  const [contentFilter, setContentFilter] = useState<ContentFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('date');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');

  const posts = useMemo(() => {
    let filtered = [...inputPosts];

    if (contentFilter !== 'all') {
      filtered = filtered.filter(p => p.type === contentFilter);
    }

    if (timeFilter !== 'all') {
      const now = new Date('2026-04-06');
      const days = timeFilter === '7d' ? 7 : 30;
      const cutoff = new Date(now.getTime() - days * 86400000);
      filtered = filtered.filter(p => new Date(p.date) >= cutoff);
    }

    switch (sortBy) {
      case 'views':
        return filtered.sort((a, b) => b.views - a.views);
      case 'engagement':
        return filtered.sort((a, b) => b.engagementRate - a.engagementRate);
      case 'revenue':
        return filtered.sort((a, b) => b.cashCollected - a.cashCollected);
      default:
        return filtered.sort((a, b) => b.date.localeCompare(a.date));
    }
  }, [inputPosts, contentFilter, sortBy, timeFilter]);

  // Pipeline totals
  const totals = useMemo(() => {
    return {
      conversations: inputPosts.reduce((s, p) => s + p.dmReplies, 0),
      callsScheduled: inputPosts.reduce((s, p) => s + p.booked, 0),
      leads: inputPosts.reduce((s, p) => s + p.leads, 0),
      showed: inputPosts.reduce((s, p) => s + p.showed, 0),
      closed: inputPosts.reduce((s, p) => s + p.closed, 0),
      cashCollected: inputPosts.reduce((s, p) => s + p.cashCollected, 0),
    };
  }, [inputPosts]);

  const l2bRate = totals.leads > 0
    ? ((totals.callsScheduled / totals.leads) * 100).toFixed(1)
    : '0.0';

  // Top performers by cash collected
  const topPerformers = useMemo(() =>
    [...inputPosts].sort((a, b) => b.cashCollected - a.cashCollected).slice(0, 3),
    [inputPosts]
  );

  // Early return if no posts data (integration not connected)
  if (inputPosts.length === 0) {
    return (
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-12 text-center">
        <p className="text-gray-500 text-sm">LinkedIn integration not configured yet</p>
      </div>
    );
  }

  const typeBadgeColor = (type: ContentPost['type']) => {
    switch (type) {
      case 'post': return 'bg-blue-900/50 text-blue-300';
      case 'article': return 'bg-indigo-900/50 text-indigo-300';
      default: return 'bg-gray-700 text-gray-300';
    }
  };

  return (
    <div className="space-y-6">
      {/* Pipeline Overview */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Total Conversations', value: totals.conversations.toLocaleString(), color: 'text-blue-400' },
          { label: 'Calls Scheduled', value: totals.callsScheduled.toLocaleString(), color: 'text-white' },
          { label: 'L2B%', value: `${l2bRate}%`, color: 'text-yellow-400' },
          { label: 'Showed', value: totals.showed.toLocaleString(), color: 'text-white' },
          { label: 'Closed', value: totals.closed.toLocaleString(), color: 'text-white' },
          { label: 'Cash Collected', value: `$${totals.cashCollected.toLocaleString()}`, color: 'text-emerald-400' },
        ].map((card) => (
          <div key={card.label} className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4">
            <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">{card.label}</p>
            <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Content Filters */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1 bg-[#1a1d23] rounded-lg border border-gray-700 p-1">
          {(['all', 'post', 'article'] as ContentFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setContentFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                contentFilter === f
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <PillSelect
            value={timeFilter}
            options={[
              { value: 'all', label: 'All Time', color: 'gray' },
              { value: '7d', label: 'Last 7 Days', color: 'blue' },
              { value: '30d', label: 'Last 30 Days', color: 'purple' },
            ]}
            onChange={(v) => setTimeFilter(v as TimeFilter)}
            maxLabelWidth={140}
          />
          <PillSelect
            value={sortBy}
            options={[
              { value: 'date', label: 'Sort by Date', color: 'blue' },
              { value: 'views', label: 'Sort by Views', color: 'emerald' },
              { value: 'engagement', label: 'Sort by Engagement', color: 'purple' },
              { value: 'revenue', label: 'Sort by Revenue', color: 'amber' },
            ]}
            onChange={(v) => setSortBy(v as SortOption)}
            maxLabelWidth={180}
          />
        </div>
      </div>

      {/* Post Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {posts.map((post) => (
          <div key={post.id} className="bg-[#1a1d23] rounded-xl border border-gray-700 p-5 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${typeBadgeColor(post.type)}`}>
                    {post.type}
                  </span>
                  <span className="text-[11px] text-gray-500">{post.date}</span>
                </div>
                <p className="text-sm text-white font-medium leading-snug line-clamp-2">{post.title}</p>
              </div>
              <div className="flex-shrink-0 w-2 h-2 rounded-full bg-blue-500 mt-2" />
            </div>

            {/* Engagement Metrics */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Views', value: post.views.toLocaleString() },
                { label: 'Reach', value: post.reach.toLocaleString() },
                { label: 'Follows', value: post.follows.toLocaleString() },
                { label: 'Eng%', value: `${post.engagementRate}%` },
              ].map((m) => (
                <div key={m.label}>
                  <p className="text-[10px] text-gray-500 uppercase">{m.label}</p>
                  <p className="text-sm font-semibold text-gray-200">{m.value}</p>
                </div>
              ))}
            </div>

            {/* Interactions */}
            <div className="grid grid-cols-4 gap-3 pt-3 border-t border-gray-700/50">
              {[
                { label: 'Likes', value: post.likes.toLocaleString() },
                { label: 'Comments', value: post.comments.toLocaleString() },
                { label: 'Shares', value: post.shares.toLocaleString() },
                { label: 'Saves', value: post.saves.toLocaleString() },
              ].map((m) => (
                <div key={m.label}>
                  <p className="text-[10px] text-gray-500 uppercase">{m.label}</p>
                  <p className="text-sm font-medium text-gray-300">{m.value}</p>
                </div>
              ))}
            </div>

            {/* DM Trigger */}
            {post.dmTrigger && (
              <div className="flex items-center gap-2 pt-2 border-t border-gray-700/50">
                <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-900/30 border border-blue-700/50 text-blue-300 text-xs font-medium">
                  {post.dmTrigger}
                </span>
                <span className="text-xs text-gray-400">
                  {post.dmReplies} replies
                </span>
              </div>
            )}

            {/* Downstream Impact */}
            <div className="grid grid-cols-4 gap-3 pt-3 border-t border-gray-700/50">
              {[
                { label: 'Leads', value: post.leads.toString(), color: 'text-blue-400' },
                { label: 'Booked', value: post.booked.toString(), color: 'text-white' },
                { label: 'Cash', value: `$${post.cashCollected.toLocaleString()}`, color: 'text-emerald-400' },
                { label: 'Rev', value: `$${post.contractedRevenue.toLocaleString()}`, color: 'text-emerald-400' },
              ].map((m) => (
                <div key={m.label}>
                  <p className="text-[10px] text-gray-500 uppercase">{m.label}</p>
                  <p className={`text-sm font-bold ${m.color}`}>{m.value}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {posts.length === 0 && (
        <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-12 text-center">
          <p className="text-gray-500 text-sm">No posts found for the selected filters.</p>
        </div>
      )}

      {/* Top Performers */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-white">Top Performers</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">Highest revenue-generating LinkedIn posts</p>
        </div>
        <div className="divide-y divide-gray-800">
          {topPerformers.map((post, i) => (
            <div key={post.id} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-800/50 transition-colors">
              <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                i === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                i === 1 ? 'bg-gray-500/20 text-gray-300' :
                'bg-orange-500/20 text-orange-400'
              }`}>
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{post.title}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className={`text-[10px] font-semibold uppercase ${typeBadgeColor(post.type)}`}>{post.type}</span>
                  <span className="text-[11px] text-gray-500">{post.date}</span>
                  <span className="text-[11px] text-gray-500">{post.views.toLocaleString()} views</span>
                  <span className="text-[11px] text-gray-500">{post.engagementRate}% eng</span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-emerald-400">${post.cashCollected.toLocaleString()}</p>
                <p className="text-[11px] text-gray-500">{post.leads} leads / {post.booked} booked</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
