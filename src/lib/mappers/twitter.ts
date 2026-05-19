/**
 * X (Twitter) API v2 mapper — fetches tweets with engagement metrics.
 * Uses Bearer Token (app-only auth) for public tweet data.
 */

import type { ContentPost } from '@/lib/types';

const X_USER_ID = process.env.TWITTER_USER_ID ?? '';
const X_USERNAME = process.env.TWITTER_USERNAME ?? '';

interface XTweet {
  id: string;
  text: string;
  created_at: string;
  public_metrics: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
    bookmark_count: number;
    impression_count: number;
  };
  attachments?: {
    media_keys?: string[];
  };
}

interface XMedia {
  media_key: string;
  type: string;
  url?: string;
  preview_image_url?: string;
}

export async function fetchXPosts(bearerToken: string, maxResults = 50): Promise<ContentPost[]> {
  try {
    const fields = 'created_at,public_metrics,attachments';
    const mediaFields = 'type,url,preview_image_url';
    const url = `https://api.x.com/2/users/${X_USER_ID}/tweets?max_results=${Math.min(maxResults, 100)}&tweet.fields=${fields}&expansions=attachments.media_keys&media.fields=${mediaFields}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
      next: { revalidate: 600 }, // 10 min cache
    });

    if (!res.ok) {
      console.error(`[twitter] HTTP ${res.status}: ${await res.text().catch(() => '')}`);
      return [];
    }

    const json = await res.json();
    const tweets: XTweet[] = json.data ?? [];
    const media: XMedia[] = json.includes?.media ?? [];
    const mediaMap = new Map(media.map(m => [m.media_key, m]));

    return tweets.map(t => {
      const metrics = t.public_metrics;
      const impressions = metrics.impression_count || 0;
      const engagements = metrics.like_count + metrics.retweet_count + metrics.reply_count + metrics.quote_count + metrics.bookmark_count;
      const engRate = impressions > 0 ? (engagements / impressions) * 100 : 0;

      // Get thumbnail from first media attachment
      let thumbnailUrl = '';
      if (t.attachments?.media_keys?.length) {
        const firstMedia = mediaMap.get(t.attachments.media_keys[0]);
        thumbnailUrl = firstMedia?.preview_image_url || firstMedia?.url || '';
      }

      const date = t.created_at ? t.created_at.slice(0, 10) : '';

      return {
        id: t.id,
        channel: 'X' as const,
        type: 'post' as const,
        title: t.text.slice(0, 200),
        date,
        views: impressions,
        reach: impressions,
        follows: 0,
        engagementRate: Math.round(engRate * 100) / 100,
        likes: metrics.like_count,
        comments: metrics.reply_count,
        shares: metrics.retweet_count + metrics.quote_count,
        saves: metrics.bookmark_count,
        dmTrigger: null,
        dmReplies: 0,
        leads: 0,
        booked: 0,
        showed: 0,
        closed: 0,
        cashCollected: 0,
        contractedRevenue: 0,
        permalink: `https://x.com/${X_USERNAME}/status/${t.id}`,
        thumbnailUrl,
      };
    });
  } catch (e) {
    console.error('[twitter] fetchXPosts failed:', e);
    return [];
  }
}
