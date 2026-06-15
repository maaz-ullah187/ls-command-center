import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { timeframeFromSearchParams } from '@/lib/timeframe';
import { aggregateHeadline, type HeadlineKPIs } from '@/lib/reports/main';

export const revalidate = 60;
// Route reads date params from searchParams — dynamic by definition.
export const dynamic = 'force-dynamic';

/**
 * GET /api/main/headline?preset=last-30 (or ?from=…&to=…)
 *
 * Legacy-style 6 KPIs derived from t07_income_processors. The Main Dashboard
 * UI no longer uses this — HeadlineKPIs.tsx reads sheetRevenue directly via
 * useDashboardData() to match Metabase exactly. This route is kept for
 * legacy callers / debugging.
 *
 * Supabase reads are wrapped in `unstable_cache` with a 60s TTL — the
 * `force-dynamic` route handler still runs per request, but the expensive
 * t07 query is served from cache for repeat date-window hits.
 */

type HeadlineRow = {
  amount: number | string | null;
  final_amount: number | string | null;
  status: string | null;
  payment_type: string | null;
  date: string;
};

// Module-scoped so the cache identity persists across requests.
const fetchHeadlineRows = unstable_cache(
  async (from: string, to: string): Promise<HeadlineRow[]> => {
    const supa = await getServerSupabaseAsync();
    if (!supa) return [];
    const { data, error } = await supa
      .from('t07_income_processors')
      .select('amount, final_amount, status, payment_type, date')
      .eq('review_status', 'approved')  // ← Payment Review Queue gate
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message ?? 'query_failed');
    return (data ?? []) as HeadlineRow[];
  },
  ['main:headline:t07'],
  { revalidate: 60, tags: ['t07'] },
);

/**
 * Exported response-builder so /api/main/dashboard-data can call this logic
 * directly without an HTTP round-trip (which would trip auth middleware).
 */
export async function buildHeadlineResponse(searchParams: URLSearchParams) {
  const window = timeframeFromSearchParams(searchParams);

  const supa = await getServerSupabaseAsync();
  if (!supa) {
    const empty: HeadlineKPIs = {
      totalPayments: 0,
      approved: 0,
      failed: 0,
      refunded: 0,
      totalCash: 0,
      afterFinancing: 0,
      count: 0,
    };
    return { ...empty, window, configured: false };
  }

  const rows = await fetchHeadlineRows(window.from, window.to);
  // Drop 'excluded' rows — payments marked as wrong-business via the queue's
  // Remove button. Audit trail stays in t07; revenue numbers ignore them.
  const filtered = rows.filter((r) => r.payment_type !== 'excluded');
  // aggregateHeadline coerces amount internally; the type cast just relaxes
  // the Supabase string|null → number signature so the call typechecks.
  const result = aggregateHeadline(filtered as unknown as Parameters<typeof aggregateHeadline>[0], window);
  return { ...result, window, configured: true };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const body = await buildHeadlineResponse(url.searchParams);
    return NextResponse.json(body);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'query_failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
