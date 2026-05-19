// YouTube Data API v3 → dashboard YouTubeVideo type mapper (Pillar 7).
//
// Fetches videos from the channel's uploads playlist, enriches with view/like
// stats, then cross-references GHL leads with source='YouTube' to compute
// downstream funnel metrics (leads, booked, showed, closed, cash).

import 'server-only';
import type { YouTubeVideo, Lead } from '../types';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

interface YTVideoRaw {
  id: string;
  snippet: {
    title: string;
    description: string;
    publishedAt: string;
    thumbnails: {
      high?: { url: string };
      medium?: { url: string };
      default?: { url: string };
    };
  };
  statistics: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  contentDetails: {
    duration?: string; // ISO 8601 e.g. "PT17M49S"
  };
  status?: {
    privacyStatus?: string; // public, unlisted, private
  };
}

/**
 * Parse ISO 8601 duration (PT17M49S) to human-readable (17:49)
 */
function parseDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '0:00';
  const h = parseInt(match[1] || '0');
  const m = parseInt(match[2] || '0');
  const s = parseInt(match[3] || '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Parse ISO 8601 duration to total seconds (for watch time calculation)
 */
function durationSeconds(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || '0') * 3600) +
         (parseInt(match[2] || '0') * 60) +
         (parseInt(match[3] || '0'));
}

/**
 * Fetch all videos from the channel. Paginates through the uploads playlist
 * (up to 200 videos), then batch-fetches stats for each.
 */
export async function fetchYouTubeVideos(
  apiKey: string,
  channelId: string,
): Promise<YouTubeVideo[]> {
  // Step 1: Get uploads playlist ID
  const chRes = await fetch(
    `${API_BASE}/channels?part=contentDetails&id=${channelId}&key=${apiKey}`,
    { next: { revalidate: 3600 } },
  );
  if (!chRes.ok) {
    console.error(`[youtube] channels HTTP ${chRes.status}`);
    return [];
  }
  const chData = await chRes.json();
  const uploadsId = chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return [];

  // Step 2: Paginate uploads playlist (up to 4 pages × 50 = 200 videos)
  const videoIds: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 4; page++) {
    const url = `${API_BASE}/playlistItems?part=contentDetails&playlistId=${uploadsId}&maxResults=50&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) break;
    const data = await res.json();
    for (const item of data.items ?? []) {
      if (item.contentDetails?.videoId) videoIds.push(item.contentDetails.videoId);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  if (videoIds.length === 0) return [];

  // Step 3: Batch fetch video stats (50 at a time)
  const allRaw: YTVideoRaw[] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50).join(',');
    const res = await fetch(
      `${API_BASE}/videos?part=snippet,statistics,contentDetails,status&id=${batch}&key=${apiKey}`,
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) continue;
    const data = await res.json();
    allRaw.push(...(data.items ?? []));
  }

  // Step 4: Filter out Shorts and short videos (under 3 minutes)
  const longForm = allRaw.filter(v => durationSeconds(v.contentDetails.duration ?? 'PT0S') >= 180);

  // Step 5: Map to YouTubeVideo type (without lead attribution — that's done in dataSources)
  return longForm.map(v => {
    const views = parseInt(v.statistics.viewCount ?? '0');
    const secs = durationSeconds(v.contentDetails.duration ?? 'PT0S');
    const isLive = v.snippet.title.toLowerCase().includes('live') ||
                   (v.contentDetails.duration ?? '').includes('H') && secs > 7200;

    return {
      id: v.id,
      title: v.snippet.title,
      date: v.snippet.publishedAt?.slice(0, 10) ?? '',
      views,
      likes: parseInt(v.statistics.likeCount ?? '0'),
      comments: parseInt(v.statistics.commentCount ?? '0'),
      subscribers: 0, // Not available from YouTube Data API v3 — needs Analytics API
      watchTimeHours: Math.round((views * secs * 0.4) / 3600), // Estimate: 40% avg view duration
      avgViewDuration: parseDuration(v.contentDetails.duration ?? 'PT0S'),
      ctr: 0, // Enriched by Trakyo deep link data when available
      deepLinkClicks: 0,
      description: v.snippet.description ?? '',
      // Downstream funnel — populated by enrichYouTubeWithLeads()
      leads: 0,
      booked: 0,
      showed: 0,
      closed: 0,
      cashCollected: 0,
      contractedRevenue: 0,
      source: 'video' as const,
      thumbnailUrl: v.snippet.thumbnails.high?.url ?? v.snippet.thumbnails.medium?.url ?? '',
      duration: parseDuration(v.contentDetails.duration ?? 'PT0S'),
      visibility: (v.status?.privacyStatus ?? 'public') as 'public' | 'unlisted' | 'private',
      isLive,
    };
  });
}

/**
 * Enrich YouTube videos with downstream funnel metrics from GHL leads.
 *
 * Attribution strategy:
 * - "youtube_channel_bio" campaign → bio entry
 * - Video-specific slugs (theointerview, hugointerview, etc) → match to video by title
 * - Generic "freecourse-googledoc" → distribute proportionally by video views
 */
export function enrichYouTubeWithLeads(
  videos: YouTubeVideo[],
  leads: Lead[],
): YouTubeVideo[] {
  const ytLeads = leads.filter(l => l.source === 'YouTube');
  if (ytLeads.length === 0) return videos;

  type Funnel = { leads: number; booked: number; showed: number; closed: number; cash: number; contracted: number };
  const empty = (): Funnel => ({ leads: 0, booked: 0, showed: 0, closed: 0, cash: 0, contracted: 0 });
  const add = (f: Funnel, lead: Lead) => {
    f.leads++;
    if (lead.demoBooked) f.booked++;
    if (lead.showStatus === 'Showed') f.showed++;
    if (lead.callOutcome === 'Closed Won' || lead.stage === 'Closed Won' || lead.cashCollected > 1) { f.closed++; f.cash += lead.cashCollected; f.contracted += lead.contractedRevenue; }
  };

  const bioFunnel = empty();
  const directMatch = new Map<number, Funnel>(); // video index → funnel
  const genericLeads: Lead[] = []; // leads to distribute by views

  for (const lead of ytLeads) {
    const campaign = (lead.campaignName || '').toLowerCase();
    const adSet = (lead.adSetName || '').toLowerCase();

    // Bio leads
    if (campaign.includes('bio') || adSet === 'bio') {
      add(bioFunnel, lead);
      continue;
    }

    // Try video-specific slug match (theointerview, hugointerview, csmexitcall, etc)
    const slug = campaign.replace(/[^a-z0-9]/g, '');
    // Normalize "freecourse-googledoc" and "freecourse" into a single generic pool
    const normalizedSlug = (slug === 'freecoursegoogledoc') ? 'freecourse' : slug;
    let matched = false;
    if (normalizedSlug && normalizedSlug !== 'freecourse') {
      for (let i = 0; i < videos.length; i++) {
        const titleLower = videos[i].title.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (titleLower.includes(normalizedSlug) || normalizedSlug.includes(titleLower.slice(0, 10))) {
          const f = directMatch.get(i) ?? empty();
          add(f, lead);
          directMatch.set(i, f);
          matched = true;
          break;
        }
      }
    }

    // Generic leads (freecourse-googledoc, etc) → distribute by views
    if (!matched) {
      genericLeads.push(lead);
    }
  }

  // Distribute generic leads proportionally by video views
  const totalViews = videos.reduce((s, v) => s + v.views, 0);
  const genericFunnelByVideo = new Map<number, Funnel>();
  if (totalViews > 0 && genericLeads.length > 0) {
    // Aggregate generic leads into a single funnel first
    const genericTotal = empty();
    for (const lead of genericLeads) add(genericTotal, lead);

    // Distribute proportionally by views
    for (let i = 0; i < videos.length; i++) {
      const weight = videos[i].views / totalViews;
      genericFunnelByVideo.set(i, {
        leads: Math.round(genericTotal.leads * weight),
        booked: Math.round(genericTotal.booked * weight),
        showed: Math.round(genericTotal.showed * weight),
        closed: Math.round(genericTotal.closed * weight),
        cash: Math.round(genericTotal.cash * weight),
        contracted: Math.round(genericTotal.contracted * weight),
      });
    }
  }

  // Merge all attribution onto videos
  const enriched = videos.map((v, i) => {
    const direct = directMatch.get(i);
    const generic = genericFunnelByVideo.get(i);
    if (!direct && !generic) return v;
    return {
      ...v,
      leads: (direct?.leads ?? 0) + (generic?.leads ?? 0),
      booked: (direct?.booked ?? 0) + (generic?.booked ?? 0),
      showed: (direct?.showed ?? 0) + (generic?.showed ?? 0),
      closed: (direct?.closed ?? 0) + (generic?.closed ?? 0),
      cashCollected: (direct?.cash ?? 0) + (generic?.cash ?? 0),
      contractedRevenue: (direct?.contracted ?? 0) + (generic?.contracted ?? 0),
    };
  });

  // Add bio aggregate entry
  enriched.push({
    id: 'yt-bio',
    title: 'Channel Bio Link',
    date: new Date().toISOString().slice(0, 10),
    views: 0,
    likes: 0,
    comments: 0,
    subscribers: 0,
    watchTimeHours: 0,
    avgViewDuration: '0:00',
    ctr: 0,
    leads: bioFunnel.leads,
    booked: bioFunnel.booked,
    showed: bioFunnel.showed,
    closed: bioFunnel.closed,
    cashCollected: bioFunnel.cash,
    contractedRevenue: bioFunnel.contracted,
    source: 'bio',
    visibility: 'public',
  });

  return enriched;
}

// ---------------------------------------------------------------------------
// Trakyo deep link click enrichment
// ---------------------------------------------------------------------------

interface TrakyoLink {
  key: string;
  url: string;
  shortLink: string;
  contentItemId: string;
  clicks: number;
}

/**
 * Fetch deep link click data from Trakyo and merge onto YouTube videos.
 * Matches by extracting your-redirect-domain.com/SLUG from video descriptions
 * and looking up the corresponding Trakyo link's click count.
 */
export async function enrichYouTubeWithTrakyo(
  videos: YouTubeVideo[],
  trakyoApiKey: string,
): Promise<YouTubeVideo[]> {
  try {
    const res = await fetch('https://api.trakyo.io/v1/links', {
      headers: { Authorization: `Bearer ${trakyoApiKey}` },
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      console.error(`[trakyo] HTTP ${res.status}`);
      return videos;
    }
    const data = await res.json();
    const links: TrakyoLink[] = data.links ?? [];
    if (links.length === 0) return videos;

    // Build map: slug → total clicks (aggregate across all links with same contentItemId)
    const clicksByContentItem = new Map<string, number>();
    for (const link of links) {
      const existing = clicksByContentItem.get(link.contentItemId) ?? 0;
      clicksByContentItem.set(link.contentItemId, existing + link.clicks);
    }

    // Build map: slug key → contentItemId
    const slugToContentItem = new Map<string, string>();
    for (const link of links) {
      slugToContentItem.set(link.key, link.contentItemId);
    }

    // For each video, extract <REDIRECT_DOMAIN>/SLUG from description.
    // The redirect domain is configured via YOUTUBE_REDIRECT_DOMAIN env var.
    const redirectDomain = (process.env.YOUTUBE_REDIRECT_DOMAIN ?? '').replace(/^https?:\/\//, '');
    if (!redirectDomain) return videos;
    const escaped = redirectDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const slugRegex = new RegExp(`${escaped}\\/([a-zA-Z0-9_-]+)`, 'g');
    return videos.map(v => {
      if (!v.description) return v;
      const slugMatches = v.description.match(slugRegex);
      if (!slugMatches || slugMatches.length === 0) return v;

      let totalClicks = 0;
      const seenContentItems = new Set<string>();
      for (const match of slugMatches) {
        const slug = match.replace('your-redirect-domain.com/', '');
        const contentItemId = slugToContentItem.get(slug);
        if (contentItemId && !seenContentItems.has(contentItemId)) {
          seenContentItems.add(contentItemId);
          totalClicks += clicksByContentItem.get(contentItemId) ?? 0;
        }
      }

      if (totalClicks === 0) return v;
      return {
        ...v,
        deepLinkClicks: totalClicks,
        ctr: v.views > 0 ? Math.round((totalClicks / v.views) * 10000) / 100 : 0,
      };
    });
  } catch (e) {
    console.error('[trakyo] enrichment failed:', e);
    return videos;
  }
}

// ---------------------------------------------------------------------------
// YouTube Comments fetcher
// ---------------------------------------------------------------------------

export interface YouTubeComment {
  author: string;
  text: string;
  likes: number;
  publishedAt: string;
}

/**
 * Fetch top comments for a video (by relevance). Returns up to `max` comments.
 */
export async function fetchVideoComments(
  apiKey: string,
  videoId: string,
  max = 50,
): Promise<YouTubeComment[]> {
  const comments: YouTubeComment[] = [];
  let pageToken: string | undefined;

  while (comments.length < max) {
    const remaining = max - comments.length;
    const url = `${API_BASE}/commentThreads?part=snippet&videoId=${videoId}&maxResults=${Math.min(remaining, 50)}&order=relevance&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) {
      // Comments might be disabled
      if (res.status === 403) return comments;
      console.error(`[youtube] comments HTTP ${res.status} for ${videoId}`);
      break;
    }
    const data = await res.json();
    for (const item of data.items ?? []) {
      const s = item.snippet?.topLevelComment?.snippet;
      if (!s) continue;
      comments.push({
        author: s.authorDisplayName ?? '',
        text: (s.textDisplay ?? '').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ''),
        likes: parseInt(s.likeCount ?? '0'),
        publishedAt: s.publishedAt ?? '',
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return comments;
}
