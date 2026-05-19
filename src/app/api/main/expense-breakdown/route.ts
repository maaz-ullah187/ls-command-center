import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { timeframeFromSearchParams } from '@/lib/timeframe';
import { aggregateExpenseBreakdown, aggregateVendors } from '@/lib/reports/main';

/**
 * GET /api/main/expense-breakdown
 *
 * Returns:
 *   rows    — donut by expense_type (Labour, Marketing, Overhead, …)
 *   vendors — top N expense recipients aggregated across the timeframe
 *             (e.g. "Anthropic" billed 47x = $4,800 total)
 *
 * Source: t08_expenses (Mercury banking-derived).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const window = timeframeFromSearchParams(url.searchParams);
  const topN = Math.min(20, Math.max(1, Number(url.searchParams.get('topVendors') ?? 10)));

  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ rows: [], vendors: [], window, configured: false });
  }

  const { data, error } = await supa
    .from('t08_expenses')
    .select('expense_type, transaction_name, amount, date')
    .gte('date', window.from)
    .lte('date', window.to)
    .limit(10000);

  if (error) {
    return NextResponse.json({ error: error.message ?? 'query_failed', window }, { status: 502 });
  }

  const rows = aggregateExpenseBreakdown(data ?? [], window);
  const vendors = aggregateVendors(data ?? [], window, topN);
  return NextResponse.json({ rows, vendors, window, configured: true });
}
