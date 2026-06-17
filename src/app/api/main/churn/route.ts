// GET /api/main/churn?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns the count of churned clients in the window. Source is t09_churn,
// which the /api/sync/churn worker hydrates from the offboarding Slack
// channel. Used by the Churn KPI card on the main dashboard.

import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const revalidate = 60;
export const dynamic = 'force-dynamic';

const fetchChurnCount = unstable_cache(
  async (from: string, to: string): Promise<number> => {
    const supa = await getServerSupabaseAsync();
    if (!supa) return 0;
    const { count, error } = await supa
      .from('t09_churn')
      .select('id', { count: 'exact', head: true })
      .gte('date', from)
      .lte('date', to);
    if (error) throw new Error(error.message ?? 'query_failed');
    return count ?? 0;
  },
  ['main:churn:t09'],
  { revalidate: 60, tags: ['t09_churn'] },
);

export async function buildChurnResponse(searchParams: URLSearchParams) {
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { error: 'missing_or_invalid_from_to', count: 0, configured: false };
  }
  const supa = await getServerSupabaseAsync();
  if (!supa) return { count: 0, configured: false, window: { from, to } };
  const count = await fetchChurnCount(from, to);
  return { count, configured: true, window: { from, to } };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const body = await buildChurnResponse(url.searchParams);
    return NextResponse.json(body);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'query_failed';
    return NextResponse.json({ error: message, count: 0 }, { status: 502 });
  }
}
