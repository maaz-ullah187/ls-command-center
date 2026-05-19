import { NextResponse } from 'next/server';
import { getContent } from '@/lib/dataSources';

// In-memory cache: YouTube fetches 200 videos + enrichments
let cache: { data: unknown; ts: number } | null = null;
const TTL = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < TTL) {
      return NextResponse.json(cache.data);
    }
    const videos = await getContent('youtube');
    cache = { data: videos, ts: Date.now() };
    return NextResponse.json(videos);
  } catch (e) {
    console.error('[api/data/youtube] Failed:', e);
    return NextResponse.json([]);
  }
}
