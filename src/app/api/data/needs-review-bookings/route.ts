import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/data/needs-review-bookings
 *
 * Returns t03_bookings rows where status='Needs Review' for the Daily Review
 * Queue. These are PAST bookings whose call status is genuinely unresolved —
 * the team needs to manually mark them as Showed / No Showed / Rescheduled /
 * Cancelled. Replaces the older lead-level "Unlogged Calls" bucket.
 *
 * Per the operator 2026-04-28: "We shouldn't have anybody under needs review //
 * we should have a status for every appointment that's in the past."
 *
 * Per the operator 2026-04-30: future bookings excluded — call hasn't happened
 * yet, so "Needs Review" isn't actionable until after the booking time.
 *
 * Constraints:
 *   - status = 'Needs Review'
 *   - date_booked_for >= 2026-04-01 (backlog floor)
 *   - date_booked_for <= now() (only past bookings — call already happened)
 */

interface NeedsReviewBooking {
  id: string;
  dateBookedFor: string;
  name: string | null;
  email: string | null;
  closer: string | null;
  offer: string | null;
  contactLink: string | null;
}

const BACKLOG_FLOOR = '2026-04-01';

export async function GET(_req: NextRequest) {
  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ rows: [], configured: false });
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supa
    .from('t03_bookings')
    .select('id, date_booked_for, name, email, closer_assigned, offer, contact_link, status')
    .eq('status', 'Needs Review')
    .gte('date_booked_for', BACKLOG_FLOOR)
    .lte('date_booked_for', nowIso)
    .order('date_booked_for', { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ rows: [], error: error.message ?? 'query_failed' }, { status: 502 });
  }

  const rows: NeedsReviewBooking[] = (data ?? []).map((r: any) => ({
    id: r.id,
    dateBookedFor: r.date_booked_for,
    name: r.name ?? null,
    email: r.email ?? null,
    closer: r.closer_assigned ?? null,
    offer: r.offer ?? null,
    contactLink: r.contact_link ?? null,
  }));

  return NextResponse.json({ rows, configured: true, count: rows.length });
}
