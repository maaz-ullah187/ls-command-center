import { NextResponse } from 'next/server';
import { getManyChatData } from '@/lib/dataSources';

export const maxDuration = 60;

// In-memory cache: ManyChat lookups are rate-limited
let cache: { data: unknown; ts: number } | null = null;
const TTL = 10 * 60 * 1000; // 10 minutes

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < TTL) {
      return NextResponse.json(cache.data);
    }
    const data = await getManyChatData();
    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (e) {
    console.error('[api/data/manychat] Failed:', e);
    return NextResponse.json({ leads: [], keywords: [], stages: [], overview: {} });
  }
}
