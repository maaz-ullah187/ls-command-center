import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { timeframeFromSearchParams } from '@/lib/timeframe';
import { aggregateRevenueComposition } from '@/lib/reports/main';

export const revalidate = 60;
// Route reads date params from searchParams — dynamic by definition.
export const dynamic = 'force-dynamic';

/**
 * GET /api/main/revenue-composition?preset=…
 *
 * Donut slices for the Main Dashboard's Revenue Composition card.
 * Slices: new, renewal, upsell, refund, unknown.
 *
 * Source: t07_income_processors.revenue_category (added in migration 0019).
 * Falls back to deriving from payment_type for rows without the new column.
 *
 * Supabase reads are cached for 60s per (from,to) window via unstable_cache.
 */

type CompositionRow = {
  amount: number | string | null;
  payment_type: string | null;
  payment_structure: string | null;
  offer: string | null;
  date: string;
};

const fetchCompositionRows = unstable_cache(
  async (from: string, to: string): Promise<CompositionRow[]> => {
    const supa = await getServerSupabaseAsync();
    if (!supa) return [];
    const { data, error } = await supa
      .from('t07_income_processors')
      .select('amount, payment_type, payment_structure, offer, date')
      .eq('review_status', 'approved')  // ← Payment Review Queue gate
      .gte('date', from)
      .lte('date', to)
      .limit(5000);
    if (error) throw new Error(error.message ?? 'query_failed');
    return (data ?? []) as CompositionRow[];
  },
  ['main:revenue-composition:t07'],
  { revalidate: 60, tags: ['t07'] },
);

/**
 * Exported response-builder so /api/main/dashboard-data can call this logic
 * directly without an HTTP round-trip.
 */
export async function buildRevenueCompositionResponse(searchParams: URLSearchParams) {
  const window = timeframeFromSearchParams(searchParams);

  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return { slices: [], window, configured: false };
  }

  const rows = await fetchCompositionRows(window.from, window.to);
  // Drop 'excluded' rows — payments your team marked as wrong-business / mis-routed.
  // Those rows keep their audit trail in t07 but never count toward revenue cards.
  const filtered = rows.filter((r) => r.payment_type !== 'excluded');
  const slices = aggregateRevenueComposition(
    filtered as unknown as Parameters<typeof aggregateRevenueComposition>[0],
    window,
  );
  return { slices, window, configured: true };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const body = await buildRevenueCompositionResponse(url.searchParams);
    return NextResponse.json(body);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'query_failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
