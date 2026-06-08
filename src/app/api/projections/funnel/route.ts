// API: Funnel projections (Sales Funnel Financial Model)
// GET  ?month=YYYY-MM   → { projections: Record<metric_key, projected_value> }
// POST { month: 'YYYY-MM', metric_key: string, projected_value: number }
//   → upserts a single projection row. Mirrors the inline-edit save pattern
//     used by the Overrides / EditableValue components elsewhere.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

function monthFirstDay(monthYYYYMM: string): string {
  // 'YYYY-MM' → 'YYYY-MM-01'
  return `${monthYYYYMM}-01`;
}

export async function GET(req: NextRequest) {
  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ projections: {}, configured: false });

  const url = new URL(req.url);
  const month = url.searchParams.get('month');
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'invalid_month_format', expected: 'YYYY-MM' }, { status: 400 });
  }

  const { data, error } = await sb
    .from('funnel_projections')
    .select('metric_key, projected_value')
    .eq('month', monthFirstDay(month));

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const projections: Record<string, number> = {};
  for (const row of data ?? []) {
    projections[row.metric_key] = Number(row.projected_value);
  }
  return NextResponse.json({ projections, month, configured: true });
}

export async function POST(req: NextRequest) {
  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 });

  let body: { month?: string; metric_key?: string; projected_value?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { month, metric_key, projected_value } = body;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'invalid_month_format', expected: 'YYYY-MM' }, { status: 400 });
  }
  if (!metric_key || typeof metric_key !== 'string') {
    return NextResponse.json({ error: 'missing_metric_key' }, { status: 400 });
  }
  if (typeof projected_value !== 'number' || !Number.isFinite(projected_value)) {
    return NextResponse.json({ error: 'invalid_projected_value' }, { status: 400 });
  }

  const operator = process.env.OPERATOR_EMAIL ?? null;

  const { error } = await sb
    .from('funnel_projections')
    .upsert(
      {
        month: monthFirstDay(month),
        metric_key,
        projected_value,
        updated_by: operator,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'month,metric_key' },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true, month, metric_key, projected_value });
}
