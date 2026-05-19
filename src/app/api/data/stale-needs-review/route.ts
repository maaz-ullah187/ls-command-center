// Daily alert: bookings stuck in status='Needs Review' after the call date.
// Each row represents a completed call a closer hasn't classified (Showed /
// No Showed / Cancelled / Rescheduled) yet. Anything older than
// STALE_AFTER_DAYS counts as stale; ALERT_THRESHOLD decides when the whole
// backlog is worth bugging the operator about in Slack / the daily digest.

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const STALE_AFTER_DAYS = 2; // call date must be at least N days in the past
const ALERT_THRESHOLD = 5;  // alert fires when stale count > this

export interface StaleNeedsReview {
  id: string;
  bookingDate: string;        // YYYY-MM-DD
  dayLabel: string;
  ageDays: number;
  name: string;
  email: string | null;
  calendar: string | null;
  closerAssigned: string | null;
  offer: string | null;
  contactLink: string | null;
}

export async function GET() {
  try {
    const supabase = await getServerSupabaseAsync();
    if (!supabase) {
      return NextResponse.json({ stale: [], total: 0, alert: false });
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STALE_AFTER_DAYS);
    const cutoffIso = cutoff.toISOString();

    const { data, error } = await supabase
      .from('t03_bookings')
      .select('id, date_booked_for, name, email, calendar, closer_assigned, offer, contact_link')
      .eq('status', 'Needs Review')
      .lt('date_booked_for', cutoffIso)
      .order('date_booked_for', { ascending: true });

    if (error) throw error;

    const now = Date.now();
    const stale: StaleNeedsReview[] = (data ?? []).map((r: {
      id: string;
      date_booked_for: string;
      name: string | null;
      email: string | null;
      calendar: string | null;
      closer_assigned: string | null;
      offer: string | null;
      contact_link: string | null;
    }) => {
      const d = new Date(r.date_booked_for);
      const ageDays = Math.floor((now - d.getTime()) / 86_400_000);
      return {
        id: r.id,
        bookingDate: d.toISOString().split('T')[0],
        dayLabel: d.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }),
        ageDays,
        name: (r.name ?? '').trim(),
        email: r.email,
        calendar: r.calendar,
        closerAssigned: r.closer_assigned,
        offer: r.offer,
        contactLink: r.contact_link,
      };
    });

    return NextResponse.json({
      stale,
      total: stale.length,
      alert: stale.length > ALERT_THRESHOLD,
      threshold: ALERT_THRESHOLD,
      staleAfterDays: STALE_AFTER_DAYS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[stale-needs-review]', message);
    return NextResponse.json({ stale: [], total: 0, alert: false, error: message });
  }
}
