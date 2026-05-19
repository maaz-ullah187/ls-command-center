import { NextResponse } from 'next/server';
import { getLeads } from '@/lib/dataSources';

export const maxDuration = 120; // Allow up to 2 min for full GHL pull

// In-memory cache: GHL fetches 5000 contacts + enrichments take ~30s on first load
let cache: { data: unknown; ts: number } | null = null;
const TTL = 10 * 60 * 1000; // 10 minutes — GHL data changes slowly

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < TTL) {
      return NextResponse.json(cache.data);
    }
    const leads = await getLeads();
    cache = { data: leads, ts: Date.now() };
    return NextResponse.json(leads);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to load leads' }, { status: 500 });
  }
}
