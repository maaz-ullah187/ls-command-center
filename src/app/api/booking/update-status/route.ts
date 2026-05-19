import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/booking/update-status
 * Body: { id: string, status: 'Showed' | 'No Showed' | 'Rescheduled' | 'Cancelled' }
 *
 * Updates t03_bookings.status for the row clicked in the Unlogged Calls
 * (Needs Review) Daily Review Queue tab. Persists to Supabase so the row
 * drops out of the queue immediately.
 */

const ALLOWED = new Set(['Showed', 'No Showed', 'Rescheduled', 'Cancelled']);

export async function POST(req: NextRequest) {
  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ ok: false, error: 'supabase not configured' }, { status: 500 });
  }

  let body: { id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const id = body.id?.trim();
  const status = body.status?.trim();
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  if (!status || !ALLOWED.has(status)) {
    return NextResponse.json(
      { ok: false, error: `status must be one of: ${Array.from(ALLOWED).join(', ')}` },
      { status: 400 }
    );
  }

  const { data, error } = await supa
    .from('t03_bookings')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, status')
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, row: data });
}
