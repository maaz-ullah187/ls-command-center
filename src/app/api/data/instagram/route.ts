import { NextResponse } from 'next/server';
import { getContent } from '@/lib/dataSources';

// In-memory cache: avoids re-fetching 50 IG posts + insights on every page load
let cache: { data: unknown; ts: number } | null = null;
const TTL = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < TTL) {
      return NextResponse.json(cache.data);
    }
    const posts = await getContent('instagram');
    cache = { data: posts, ts: Date.now() };
    return NextResponse.json(posts);
  } catch (e) {
    console.error('[api/data/instagram] Failed:', e);
    return NextResponse.json([]);
  }
}
