/**
 * GET /api/data/t01-leads?start=2026-04-01&end=2026-04-30&limit=1000
 *
 * Direct mirror of t01_leads. No GHL live calls, no enrichment layer —
 * exactly what's in Supabase at query time. the operator rule (2026-04-23):
 * dashboard = mirror of Supabase.
 */

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const source = url.searchParams.get('source');
  const offer = url.searchParams.get('offer');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 1000), 5000);

  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = sb.from('t01_leads').select('*').order('date', { ascending: false }).limit(limit);
  if (start) q = q.gte('date', start);
  if (end) q = q.lte('date', end);
  if (source) q = q.eq('source', source);
  if (offer) q = q.eq('offer', offer);

  const { data: leads, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Summary: counts by source + offer
  const counts = {
    total: leads?.length ?? 0,
    by_source: {} as Record<string, number>,
    by_offer: {} as Record<string, number>,
  };
  for (const l of leads ?? []) {
    const s = l.source ?? 'Unknown';
    const o = l.offer ?? 'Unknown';
    counts.by_source[s] = (counts.by_source[s] ?? 0) + 1;
    counts.by_offer[o] = (counts.by_offer[o] ?? 0) + 1;
  }

  return NextResponse.json({ leads: leads ?? [], summary: counts });
}
