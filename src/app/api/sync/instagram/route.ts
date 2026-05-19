// Sync worker: Instagram → Supabase `t13_content_instagram` table.
// Called by Vercel Cron daily. Fetches posts via Meta proxy, upserts to Supabase.

import { NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/runner';

export const maxDuration = 120;

export async function POST() {
  const result = await runSync('instagram', async (sb) => {
    const { fetchInstagramPosts } = await import('@/lib/mappers/instagram');
    const posts = await fetchInstagramPosts();
    if (posts.length === 0) {
      return { rowsUpserted: 0, rowsSkipped: 0 };
    }

    const rows = posts.map((p) => ({
      id: p.id,
      type: p.type,
      title: p.title,
      date: p.date || null,
      views: p.views ?? 0,
      reach: p.reach ?? 0,
      follows: p.follows ?? 0,
      engagement_rate: p.engagementRate ?? 0,
      likes: p.likes ?? 0,
      comments: p.comments ?? 0,
      shares: p.shares ?? 0,
      saves: p.saves ?? 0,
      dm_trigger: p.dmTrigger ?? null,
      dm_replies: p.dmReplies ?? 0,
      leads: p.leads ?? 0,
      booked: p.booked ?? 0,
      showed: p.showed ?? 0,
      closed: p.closed ?? 0,
      cash_collected: p.cashCollected ?? 0,
      contracted_revenue: p.contractedRevenue ?? 0,
      thumbnail_url: p.thumbnailUrl || null,
      updated_at: new Date().toISOString(),
    }));

    let upserted = 0;
    const BATCH = 100;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await sb
        .from('t13_content_instagram')
        .upsert(batch, { onConflict: 'id' });
      if (error) throw error;
      upserted += batch.length;
    }

    console.log(`[sync/instagram] Upserted ${upserted} posts to Supabase`);
    return { rowsUpserted: upserted, rowsSkipped: 0 };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export { POST as GET };
