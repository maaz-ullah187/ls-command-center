import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/eod/excuse
 * Body: { closer: string, date: string (YYYY-MM-DD), reason?: string }
 *
 * Marks a (closer, date) pair as excused so the missing-EOD detector stops
 * surfacing it in the Daily Review Queue. Used when a closer genuinely
 * didn't work that day (PTO, sick, weekend not on rota, etc).
 *
 * Idempotent — primary key on (closer, date), upsert on conflict.
 */
export async function POST(req: NextRequest) {
  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ ok: false, error: 'supabase not configured' }, { status: 500 });
  }

  let body: { closer?: string; date?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const closer = body.closer?.trim();
  const date = body.date?.trim();
  if (!closer) return NextResponse.json({ ok: false, error: 'closer required' }, { status: 400 });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: 'date required in YYYY-MM-DD format' }, { status: 400 });
  }

  const { error } = await supa
    .from('t05a_eod_excused')
    .upsert(
      {
        closer,
        date,
        excused_by: 'dashboard',
        excused_at: new Date().toISOString(),
        reason: body.reason?.trim() || null,
      },
      { onConflict: 'closer,date' }
    );

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, closer, date });
}
