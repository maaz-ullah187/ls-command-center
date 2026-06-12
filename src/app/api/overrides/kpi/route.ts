// API: Manual KPI overrides for the Main Dashboard headline cards.
// GET  ?month=YYYY-MM   → { overrides: Record<metric_key, value> }
// POST { metric_key, month, value }
//   → upserts a single override row, idempotent on (metric_key, month).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

function rowId(metric_key: string, month: string): string {
  return `${metric_key}:${month}`;
}

export async function GET(req: NextRequest) {
  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ overrides: {}, configured: false });

  const url = new URL(req.url);
  const month = url.searchParams.get('month');
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'invalid_month_format', expected: 'YYYY-MM' }, { status: 400 });
  }

  const { data, error } = await sb
    .from('manual_kpi_overrides')
    .select('metric_key, value')
    .eq('month', month);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const overrides: Record<string, number> = {};
  for (const row of data ?? []) {
    overrides[row.metric_key] = Number(row.value);
  }
  return NextResponse.json({ overrides, month, configured: true });
}

export async function POST(req: NextRequest) {
  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 });

  let body: { metric_key?: string; month?: string; value?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { metric_key, month, value } = body;
  if (!metric_key || typeof metric_key !== 'string') {
    return NextResponse.json({ error: 'missing_metric_key' }, { status: 400 });
  }
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'invalid_month_format', expected: 'YYYY-MM' }, { status: 400 });
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return NextResponse.json({ error: 'invalid_value' }, { status: 400 });
  }

  const { error } = await sb
    .from('manual_kpi_overrides')
    .upsert(
      {
        id: rowId(metric_key, month),
        metric_key,
        month,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true, metric_key, month, value });
}
