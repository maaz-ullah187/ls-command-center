// Instagram Graph API mapper (Pillar 8 — Social).
//
// Routes all IG API calls through the local meta-proxy (Flask on port 5100)
// so that requests originate from the operator's home IP (not Vercel data center IPs).
//
// Proxy endpoints:
//   GET /api/instagram/media          — list recent media (up to 50)
//   GET /api/instagram/media/:id/insights — per-post insights (reach, saved, shares, etc.)
//
// The proxy handles IG auth internally — we only pass our PROXY_API_KEY.

import 'server-only';
import type { ContentPost, Lead } from '../types';

// Direct Instagram Graph API. Requires INSTAGRAM_ACCESS_TOKEN (page/system
// user token with instagram_basic + instagram_manage_insights + pages_show_list)
// and INSTAGRAM_BUSINESS_ACCOUNT_ID. No proxy — Meta ads call Graph API
// directly from Vercel fine, so IG works the same way.
const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || '';
const IG_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '';
const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

// ---------------------------------------------------------------------------
// Raw IG types (from proxy responses)
// ---------------------------------------------------------------------------

interface IGMedia {
  id: string;
  caption?: string;
  media_type?: 'VIDEO' | 'IMAGE' | 'CAROUSEL_ALBUM';
  timestamp?: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  like_count?: number;
  comments_count?: number;
}

interface IGMediaResponse {
  data?: IGMedia[];
  error?: { message: string; type: string; code: number };
}

interface IGInsightValue {
  value: number;
}

interface IGInsight {
  name: string;
  values?: IGInsightValue[];
}

interface IGInsightsResponse {
  data?: IGInsight[];
  error?: { message: string; type: string; code: number };
}

// Extended ContentPost with Instagram-specific display fields
export type InstagramPost = ContentPost & {
  permalink: string | null;
  thumbnailUrl: string | null;
};

// ---------------------------------------------------------------------------
// DM trigger extraction
// ---------------------------------------------------------------------------

/**
 * Extracts DM trigger keywords from an Instagram caption.
 *
 * Matches patterns like:
 *   - DM "SCALE"
 *   - DM 'AI'
 *   - DM me "LEAK"
 *   - DM me the word "SCALE"
 *   - Comment "INFO" below
 */
function extractDmTrigger(caption: string | undefined): string | null {
  if (!caption) return null;

  // Match: DM (me)? (the word)? ["']KEYWORD["']
  const dmPattern = /\bDM\s+(?:me\s+)?(?:the\s+word\s+)?["\u201C\u201D\u2018\u2019']([^"\u201C\u201D\u2018\u2019']+)["\u201C\u201D\u2018\u2019']/i;
  const match = caption.match(dmPattern);
  if (match) {
    return `DM "${match[1].trim()}"`;
  }

  // Fallback: Comment "KEYWORD"
  const commentPattern = /\b(?:comment|type)\s+["\u201C\u201D\u2018\u2019']([^"\u201C\u201D\u2018\u2019']+)["\u201C\u201D\u2018\u2019']/i;
  const commentMatch = caption.match(commentPattern);
  if (commentMatch) {
    return `DM "${commentMatch[1].trim()}"`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Media type mapping
// ---------------------------------------------------------------------------

function mapMediaType(
  mediaType: string | undefined
): 'reel' | 'carousel' | 'static' {
  switch (mediaType) {
    case 'VIDEO':
      return 'reel';
    case 'CAROUSEL_ALBUM':
      return 'carousel';
    case 'IMAGE':
    default:
      return 'static';
  }
}

// ---------------------------------------------------------------------------
// Title extraction
// ---------------------------------------------------------------------------

function extractTitle(caption: string | undefined): string {
  if (!caption) return '(no caption)';
  const firstLine = caption.split('\n')[0].trim();
  if (firstLine.length <= 120) return firstLine;
  return firstLine.slice(0, 117) + '...';
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchMedia(): Promise<IGMedia[]> {
  if (!IG_TOKEN || !IG_ACCOUNT_ID) {
    console.error('[ig] INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_BUSINESS_ACCOUNT_ID must be set');
    return [];
  }
  try {
    const fields = 'id,caption,media_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count';
    const url = `${GRAPH_BASE}/${IG_ACCOUNT_ID}/media?fields=${fields}&limit=50&access_token=${IG_TOKEN}`;
    const res = await fetch(url, { next: { revalidate: 300 } });

    if (!res.ok) {
      console.error(`[ig] fetchMedia HTTP ${res.status}: ${await res.text().catch(() => '')}`);
      return [];
    }

    const json = (await res.json()) as IGMediaResponse;
    if (json.error) {
      console.error(`[ig] fetchMedia error: ${json.error.message}`);
      return [];
    }

    return json.data ?? [];
  } catch (e) {
    console.error('[ig] fetchMedia threw:', e);
    return [];
  }
}

interface PostInsights {
  reach: number;
  saved: number;
  shares: number;
  totalInteractions: number;
}

async function fetchPostInsights(mediaId: string): Promise<PostInsights> {
  const defaults: PostInsights = {
    reach: 0,
    saved: 0,
    shares: 0,
    totalInteractions: 0,
  };

  try {
    const metrics = 'reach,saved,shares,total_interactions';
    const url = `${GRAPH_BASE}/${mediaId}/insights?metric=${metrics}&access_token=${IG_TOKEN}`;
    const res = await fetch(url, { next: { revalidate: 300 } });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[ig] insights HTTP ${res.status} for ${mediaId}: ${body.slice(0, 300)}`);
      return defaults;
    }

    const json = (await res.json()) as IGInsightsResponse;
    if (json.error) {
      console.error(`[ig] insights error for ${mediaId}: ${json.error.message}`);
      return defaults;
    }

    const result = { ...defaults };
    for (const insight of json.data ?? []) {
      const val = insight.values?.[0]?.value ?? 0;
      switch (insight.name) {
        case 'reach':
          result.reach = val;
          break;
        case 'saved':
          result.saved = val;
          break;
        case 'shares':
          result.shares = val;
          break;
        case 'total_interactions':
          result.totalInteractions = val;
          break;
      }
    }
    return result;
  } catch (e) {
    console.error(`[ig] fetchPostInsights threw for ${mediaId}:`, e);
    return defaults;
  }
}

/**
 * Fetch insights for a batch of media IDs, respecting concurrency limits.
 * Processes in batches of 5 to avoid overwhelming the proxy / IG rate limits.
 */
async function fetchInsightsBatched(
  mediaIds: string[]
): Promise<Map<string, PostInsights>> {
  const map = new Map<string, PostInsights>();
  const BATCH_SIZE = 10;

  for (let i = 0; i < mediaIds.length; i += BATCH_SIZE) {
    const batch = mediaIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (id) => ({
        id,
        insights: await fetchPostInsights(id),
      }))
    );
    for (const { id, insights } of results) {
      map.set(id, insights);
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

export async function fetchInstagramPosts(): Promise<InstagramPost[]> {
  const media = await fetchMedia();
  if (media.length === 0) return [];

  // Fetch insights for all media in batches of 5
  const mediaIds = media.map((m) => m.id);
  const insightsMap = await fetchInsightsBatched(mediaIds);

  return media.map((m) => {
    const insights = insightsMap.get(m.id) ?? {
      reach: 0,
      saved: 0,
      shares: 0,
      totalInteractions: 0,
    };
    const likes = m.like_count ?? 0;
    const comments = m.comments_count ?? 0;
    const saves = insights.saved;
    const shares = insights.shares;
    const reach = insights.reach;

    const engagementRate =
      reach > 0 ? ((likes + comments + saves + shares) / reach) * 100 : 0;

    return {
      id: m.id,
      channel: 'Instagram' as const,
      type: mapMediaType(m.media_type),
      title: extractTitle(m.caption),
      date: m.timestamp ? m.timestamp.slice(0, 10) : '',
      views: insights.totalInteractions,
      reach,
      follows: 0, // IG media-level API does not expose follows per post
      engagementRate: Math.round(engagementRate * 100) / 100,
      likes,
      comments,
      shares,
      saves,
      dmTrigger: extractDmTrigger(m.caption),
      dmReplies: 0, // Not available from IG API; populated via manual override
      leads: 0,
      booked: 0,
      showed: 0,
      closed: 0,
      cashCollected: 0,
      contractedRevenue: 0,
      // Extra display fields
      permalink: m.permalink ?? null,
      thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Lead enrichment
// ---------------------------------------------------------------------------

/**
 * Distributes Instagram/IG-sourced GHL leads across posts proportionally by
 * reach. Posts with higher reach get a larger share of attributed leads.
 *
 * This is a best-effort heuristic: we don't know which specific post drove
 * a given lead, so we allocate proportionally.
 */
export function enrichInstagramWithLeads(
  posts: InstagramPost[],
  leads: Lead[]
): InstagramPost[] {
  // Filter to Instagram-sourced leads
  const igLeads = leads.filter(
    (l) =>
      l.source === 'Instagram' ||
      (l.source as string) === 'IG'
  );

  if (igLeads.length === 0 || posts.length === 0) return posts;

  // Tally downstream funnel metrics from the leads
  const totalLeads = igLeads.length;
  const totalBooked = igLeads.filter((l) => l.demoBooked).length;
  const totalShowed = igLeads.filter(
    (l) => l.showStatus === 'Showed'
  ).length;
  const totalClosed = igLeads.filter(
    (l) => l.stage === 'Closed Won'
  ).length;
  const totalCash = igLeads.reduce((s, l) => s + l.cashCollected, 0);
  const totalContracted = igLeads.reduce(
    (s, l) => s + l.contractedRevenue,
    0
  );

  // Total reach across all posts (for proportional distribution)
  const totalReach = posts.reduce((s, p) => s + p.reach, 0);

  if (totalReach === 0) {
    // Even distribution if no reach data
    const evenShare = 1 / posts.length;
    return posts.map((p) => ({
      ...p,
      leads: Math.round(totalLeads * evenShare),
      booked: Math.round(totalBooked * evenShare),
      showed: Math.round(totalShowed * evenShare),
      closed: Math.round(totalClosed * evenShare),
      cashCollected: Math.round(totalCash * evenShare * 100) / 100,
      contractedRevenue:
        Math.round(totalContracted * evenShare * 100) / 100,
    }));
  }

  return posts.map((p) => {
    const share = p.reach / totalReach;
    return {
      ...p,
      leads: Math.round(totalLeads * share),
      booked: Math.round(totalBooked * share),
      showed: Math.round(totalShowed * share),
      closed: Math.round(totalClosed * share),
      cashCollected: Math.round(totalCash * share * 100) / 100,
      contractedRevenue:
        Math.round(totalContracted * share * 100) / 100,
    };
  });
}
