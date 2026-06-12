import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { timeframeFromSearchParams } from '@/lib/timeframe';
import { aggregateRevenueComposition } from '@/lib/reports/main';

/**
 * GET /api/main/revenue-composition?preset=…
 *
 * Donut slices for the Main Dashboard's Revenue Composition card.
 * Slices: new, renewal, upsell, refund, unknown.
 *
 * Source: t07_income_processors.revenue_category (added in migration 0019).
 * Falls back to deriving from payment_type for rows without the new column.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const window = timeframeFromSearchParams(url.searchParams);

  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ slices: [], window, configured: false });
  }

  const { data, error } = await supa
    .from('t07_income_processors')
    .select('amount, payment_type, payment_structure, offer, date')
    .eq('review_status', 'approved')  // ← Payment Review Queue gate
    .gte('date', window.from)
    .lte('date', window.to)
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: error.message ?? 'query_failed', window }, { status: 502 });
  }

  // Drop 'excluded' rows — payments your team marked as wrong-business / mis-routed.
  // Those rows keep their audit trail in t07 but never count toward revenue cards.
  const filtered = (data ?? []).filter((r: any) => r.payment_type !== 'excluded');
  const slices = aggregateRevenueComposition(filtered, window);
  return NextResponse.json({ slices, window, configured: true });
}
