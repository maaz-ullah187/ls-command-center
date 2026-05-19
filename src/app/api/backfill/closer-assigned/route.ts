// Backfill t03_bookings.closer_assigned for rows that don't have it yet.
//
// Source priority:
//   1. Calendly scheduled_event.event_memberships[0].user_email (primary — set at booking time)
//   2. t04_call_recordings.closer_email joined by booking_id (fallback for historical rows
//      that predate the Calendly extraction in sync/bookings)
//
// Idempotent: only touches rows where closer_assigned IS NULL, so re-running costs
// at most one Calendly API call per unassigned booking. Safe to schedule daily.
//
// Historical note (2026-04-20): one-off backfill for the 129 Program C bookings
// that had no Grain recording and therefore couldn't be populated by the initial
// migration. Kept live as a safety net for future gaps.

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const maxDuration = 300;

interface CalendlyEventMembership {
  user: string;
  user_email?: string;
  user_name?: string;
}

interface CalendlyScheduledEvent {
  uri: string;
  event_memberships?: CalendlyEventMembership[];
}

async function fetchEventByUri(token: string, uri: string): Promise<CalendlyScheduledEvent | null> {
  try {
    const res = await fetch(uri, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.error(`[backfill/closer] Calendly ${uri} → HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.resource ?? null;
  } catch (err) {
    console.error(`[backfill/closer] fetch error for ${uri}:`, err);
    return null;
  }
}

export async function POST() {
  const supabase = await getServerSupabaseAsync();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const token = process.env.CALENDLY_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'CALENDLY_TOKEN not set' }, { status: 500 });
  }

  // 1. Grain-recording fallback (cheap — no external API calls).
  //    Any booking without closer_assigned but with a matching recording gets the
  //    recording's closer_email copied over. Uses plain PostgREST queries.
  //    t03_bookings.id = t04_call_recordings.booking_id.
  const { data: recordings } = await supabase
    .from('t04_call_recordings')
    .select('booking_id, closer_email')
    .not('booking_id', 'is', null)
    .not('closer_email', 'is', null);

  const closerByBookingId = new Map<string, string>();
  for (const r of recordings ?? []) {
    if (r.booking_id && r.closer_email) {
      closerByBookingId.set(r.booking_id, r.closer_email.toLowerCase().trim());
    }
  }

  const { data: unassignedForGrain } = await supabase
    .from('t03_bookings')
    .select('id')
    .is('closer_assigned', null);

  let grainHits = 0;
  for (const b of unassignedForGrain ?? []) {
    const closer = closerByBookingId.get(b.id);
    if (!closer) continue;
    const { error } = await supabase
      .from('t03_bookings')
      .update({ closer_assigned: closer, updated_at: new Date().toISOString() })
      .eq('id', b.id);
    if (!error) grainHits++;
  }

  // 2. Calendly fallback — for bookings still unassigned after Grain pass.
  //    Fetch each event_memberships list one at a time. Capped to 200 per
  //    invocation to stay under maxDuration even if Calendly slows down.
  const { data: stillUnassigned } = await supabase
    .from('t03_bookings')
    .select('id, calendly_event_url')
    .is('closer_assigned', null)
    .not('calendly_event_url', 'is', null)
    .limit(200);

  let calendlyHits = 0;
  let calendlyMisses = 0;
  let calendlyErrors = 0;

  for (const b of stillUnassigned ?? []) {
    if (!b.calendly_event_url) continue;
    const event = await fetchEventByUri(token, b.calendly_event_url);
    if (!event) {
      calendlyErrors++;
      continue;
    }
    const host = event.event_memberships?.[0]?.user_email;
    if (!host) {
      calendlyMisses++;
      continue;
    }
    const { error } = await supabase
      .from('t03_bookings')
      .update({ closer_assigned: host.toLowerCase().trim(), updated_at: new Date().toISOString() })
      .eq('id', b.id);
    if (error) {
      calendlyErrors++;
      continue;
    }
    calendlyHits++;
  }

  // Final coverage report
  const { data: coverage } = await supabase
    .from('t03_bookings')
    .select('closer_assigned');
  let assigned = 0;
  let total = 0;
  for (const row of coverage ?? []) {
    total++;
    if (row.closer_assigned) assigned++;
  }

  return NextResponse.json({
    grainHits,
    calendlyHits,
    calendlyMisses,
    calendlyErrors,
    stillUnassignedAfter: total - assigned,
    totalBookings: total,
    coveragePct: total > 0 ? Math.round((assigned / total) * 1000) / 10 : 0,
  });
}

export const GET = POST;
