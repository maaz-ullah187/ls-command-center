import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/eod/excuse-anomaly
 * Body: { id: string, field: string, reason?: string }
 *
 * Marks a (eod_id, field) pair as excused so the EOD anomaly detector stops
 * surfacing it in the Daily Review Queue. Used when an anomalous-looking
 * value is actually legitimate (e.g. one big deal closed, genuine spike).
 *
 * Idempotent — primary key on (eod_id, field), upsert on conflict.
 */
export async function POST(req: NextRequest) {
  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ ok: false, error: 'supabase not configured' }, { status: 500 });
  }

  let body: { id?: string; field?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const eodId = body.id?.trim();
  const field = body.field?.trim();
  if (!eodId) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  if (!field) return NextResponse.json({ ok: false, error: 'field required' }, { status: 400 });

  const { error } = await supa
    .from('t05b_eod_anomaly_excused')
    .upsert(
      {
        eod_id: eodId,
        field,
        excused_by: 'dashboard',
        excused_at: new Date().toISOString(),
        reason: body.reason?.trim() || null,
      },
      { onConflict: 'eod_id,field' }
    );

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: eodId, field });
}
