import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { timeframeFromSearchParams } from '@/lib/timeframe';
import { aggregateHeadline, type HeadlineKPIs } from '@/lib/reports/main';

/**
 * GET /api/main/headline?preset=last-30 (or ?from=…&to=…)
 *
 * Legacy-style 6 KPIs derived from t07_income_processors. The Main Dashboard
 * UI no longer uses this — HeadlineKPIs.tsx reads sheetRevenue directly via
 * useDashboardData() to match Metabase exactly. This route is kept for
 * legacy callers / debugging.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const window = timeframeFromSearchParams(url.searchParams);

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
    return NextResponse.json({ ...empty, window, configured: false });
  }

  const { data, error } = await supa
    .from('t07_income_processors')
    .select('amount, final_amount, status, payment_type, date')
    .gte('date', window.from)
    .lte('date', window.to)
    .order('date', { ascending: false })
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: error.message ?? 'query_failed', window }, { status: 502 });
  }

  // Drop 'excluded' rows — payments marked as wrong-business via the queue's
  // Remove button. Audit trail stays in t07; revenue numbers ignore them.
  const filtered = (data ?? []).filter((r: any) => r.payment_type !== 'excluded');
  const result = aggregateHeadline(filtered, window);
  return NextResponse.json({ ...result, window, configured: true });
}
