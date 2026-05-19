import { NextRequest, NextResponse } from 'next/server';
import { fetchMercuryExpenses } from '@/lib/mappers/mercury';

export const maxDuration = 30;

// Cache for 10 minutes
let cache: { data: any; ts: number } | null = null;
const TTL = 10 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const apiKey = process.env.MERCURY_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Mercury API key not configured' }, { status: 503 });
    }

    // Check cache
    if (cache && Date.now() - cache.ts < TTL) {
      return NextResponse.json(cache.data);
    }

    const start = request.nextUrl.searchParams.get('start') || undefined;
    const end = request.nextUrl.searchParams.get('end') || undefined;

    const data = await fetchMercuryExpenses(apiKey, start, end);
    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (e) {
    console.error('[expenses-mercury] Failed:', e);
    return NextResponse.json({ totalExpenses: 0, byCategory: {}, transactions: [] });
  }
}
