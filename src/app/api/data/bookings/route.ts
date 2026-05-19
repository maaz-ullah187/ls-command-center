/**
 * GET /api/data/bookings?start=2026-04-01&end=2026-04-30&limit=500
 *
 * Every row = one Calendly booking. Pulled DIRECTLY from t03_bookings.
 * Enriched with lead source + GHL contact link.
 */

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 500), 1000);
  const status = url.searchParams.get('status'); // optional filter

  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = sb
    .from('t03_bookings')
    .select('*')
    .order('date_booked_for', { ascending: false })
    .limit(limit);
  if (start) q = q.gte('date_booked_for', start);
  if (end) q = q.lte('date_booked_for', end + 'T23:59:59Z');
  if (status) q = q.eq('status', status);

  const { data: bookings, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with source from t01_leads
  const leadIds = [...new Set((bookings ?? []).map((b: { lead_id: string | null }) => b.lead_id).filter(Boolean))] as string[];
  const leadById = new Map<string, { source: string | null; contact_link: string | null }>();
  if (leadIds.length > 0) {
    for (let i = 0; i < leadIds.length; i += 200) {
      const chunk = leadIds.slice(i, i + 200);
      const { data: leads } = await sb
        .from('t01_leads')
        .select('id, source, contact_link')
        .in('id', chunk);
      for (const l of leads ?? []) leadById.set(l.id, { source: l.source, contact_link: l.contact_link });
    }
  }

  const enriched = (bookings ?? []).map((b: Record<string, unknown>) => {
    const lead = b.lead_id ? leadById.get(b.lead_id as string) : null;
    return {
      ...b,
      lead_source: lead?.source ?? null,
      // contact_link on the booking row OR fallback to the lead's link
      contact_link: (b.contact_link as string | null) ?? lead?.contact_link ?? null,
    };
  });

  const summary = {
    total: enriched.length,
    showed: enriched.filter((b: { status: string | null }) => b.status === 'Showed').length,
    no_showed: enriched.filter((b: { status: string | null }) => b.status === 'No Showed').length,
    cancelled: enriched.filter((b: { status: string | null }) => b.status === 'Cancelled').length,
    rescheduled: enriched.filter((b: { status: string | null }) => b.status === 'Rescheduled').length,
    pending: enriched.filter((b: { status: string | null }) => b.status === 'PENDING').length,
    needs_review: enriched.filter((b: { status: string | null }) => b.status === 'Needs Review').length,
  };

  return NextResponse.json({ bookings: enriched, summary });
}
