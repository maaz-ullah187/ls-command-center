// Sync worker: YouTube → Supabase `content_posts` table.
// Called by Vercel Cron every hour. Fetches videos from YouTube Data API,
// enriches with lead attribution from GHL, and upserts to Supabase.

import { NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/runner';
import type { YouTubeVideo } from '@/lib/types';

// GHL lead enrichment + Trakyo link lookup run serially inside the sync.
// 60s default was too tight; syncs timed out and left the table stale.
export const maxDuration = 120;

/**
 * Map a YouTubeVideo to the snake_case columns in the Supabase
 * `t12_content_youtube` table. No `channel` field — the table is
 * YouTube-specific by name, so the column doesn't exist (and previously
 * caused "Could not find the 'channel' column" upsert failures).
 */
function videoToRow(video: YouTubeVideo) {
  return {
    id: video.id,
    type: video.isLive ? 'video' : (video.duration && video.duration.includes(':') && parseInt(video.duration) < 1 ? 'short' : 'video'),
    title: video.title,
    date: video.date,
    views: video.views ?? 0,
    reach: video.views ?? 0, // YouTube doesn't distinguish reach from views
    follows: video.subscribers ?? 0,
    engagement_rate: video.views > 0
      ? Number((((video.likes + video.comments) / video.views) * 100).toFixed(2))
      : 0,
    likes: video.likes ?? 0,
    comments: video.comments ?? 0,
    shares: 0, // YouTube API doesn't expose shares
    saves: 0,
    dm_trigger: null,
    dm_replies: 0,
    leads: video.leads ?? 0,
    booked: video.booked ?? 0,
    showed: video.showed ?? 0,
    closed: video.closed ?? 0,
    cash_collected: video.cashCollected ?? 0,
    contracted_revenue: video.contractedRevenue ?? 0,
    thumbnail_url: video.thumbnailUrl || null,
    duration: video.duration || null,
    updated_at: new Date().toISOString(),
  };
}

export async function POST() {
  const result = await runSync('youtube', async (sb) => {
    const ytKey = process.env.YOUTUBE_API_KEY;
    const ytChannel = process.env.YOUTUBE_CHANNEL_ID;
    if (!ytKey || !ytChannel) {
      throw new Error('YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID must be set');
    }

    const { fetchYouTubeVideos, enrichYouTubeWithLeads } = await import('@/lib/mappers/youtube');

    let videos = await fetchYouTubeVideos(ytKey, ytChannel);
    if (videos.length === 0) {
      return { rowsUpserted: 0, rowsSkipped: 0 };
    }

    // Enrich with lead attribution from GHL (if available)
    const ghlToken = process.env.GHL_API_KEY;
    const ghlLocation = process.env.GHL_LOCATION_ID;
    if (ghlToken && ghlLocation) {
      try {
        const { fetchGHLLeads } = await import('@/lib/mappers/ghl');
        const leads = await fetchGHLLeads(ghlToken, ghlLocation);
        videos = enrichYouTubeWithLeads(videos, leads);
      } catch (e) {
        console.error('[sync/youtube] GHL lead enrichment failed (non-fatal):', e);
      }
    }

    // Trakyo deep link enrichment
    const trakyoKey = process.env.TRAKYO_API_KEY;
    if (trakyoKey) {
      try {
        const { enrichYouTubeWithTrakyo } = await import('@/lib/mappers/youtube');
        videos = await enrichYouTubeWithTrakyo(videos, trakyoKey);
      } catch (e) {
        console.error('[sync/youtube] Trakyo enrichment failed (non-fatal):', e);
      }
    }

    const rows = videos.map(videoToRow);

    // Upsert in batches of 100
    let upserted = 0;
    const BATCH = 100;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await sb
        .from('t12_content_youtube')
        .upsert(batch, { onConflict: 'id' });
      if (error) throw error;
      upserted += batch.length;
    }

    console.log(`[sync/youtube] Upserted ${upserted} videos to Supabase`);
    return { rowsUpserted: upserted, rowsSkipped: 0 };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

// Vercel Cron calls GET — alias to the same handler
export { POST as GET };
