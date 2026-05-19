/**
 * GET /api/data/calls?limit=200&start=2026-04-01&end=2026-04-30
 *
 * Returns t04_call_recordings enriched with lead + booking context.
 * Powers the Sales Calls view — every row is clickable → shows Claude-generated
 * quality analysis (qual_score, pain points, objections, why didn't close, etc.).
 */

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 500), 1000);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');

  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = sb.from('t04_call_recordings').select('*').order('call_date', { ascending: false }).limit(limit);
  if (start) q = q.gte('call_date', start);
  if (end) q = q.lte('call_date', end);

  const { data: calls, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with lead email + name from t01_leads for any call that has a ghl_contact_id
  const contactIds = [...new Set((calls ?? []).map((c: { ghl_contact_id: string | null }) => c.ghl_contact_id).filter(Boolean))] as string[];
  const leadByContactId = new Map<string, { email: string | null; name: string | null; source: string | null; contact_link: string | null }>();
  if (contactIds.length > 0) {
    // Pull in chunks of 200 to stay safe
    for (let i = 0; i < contactIds.length; i += 200) {
      const chunk = contactIds.slice(i, i + 200);
      const { data: leads } = await sb
        .from('t01_leads')
        .select('id, email, name, source, contact_link')
        .in('id', chunk);
      for (const l of leads ?? []) {
        leadByContactId.set(l.id, { email: l.email, name: l.name, source: l.source, contact_link: l.contact_link });
      }
    }
  }

  // Enrich with booking status
  const bookingIds = [...new Set((calls ?? []).map((c: { booking_id: string | null }) => c.booking_id).filter(Boolean))] as string[];
  const bookingById = new Map<string, { status: string | null; date_booked_for: string | null }>();
  if (bookingIds.length > 0) {
    for (let i = 0; i < bookingIds.length; i += 200) {
      const chunk = bookingIds.slice(i, i + 200);
      const { data: bks } = await sb
        .from('t03_bookings')
        .select('id, status, date_booked_for')
        .in('id', chunk);
      for (const b of bks ?? []) bookingById.set(b.id, { status: b.status, date_booked_for: b.date_booked_for });
    }
  }

  // Enrich with t06 close status (did this call result in a deal?)
  const emailsSet = new Set<string>();
  for (const c of calls ?? []) {
    const lead = c.ghl_contact_id ? leadByContactId.get(c.ghl_contact_id) : null;
    if (lead?.email) emailsSet.add(lead.email.toLowerCase());
  }
  const emails = [...emailsSet];
  const closedEmails = new Set<string>();
  const closeInfoByEmail = new Map<string, { cash: number; contracted: number; offer: string | null; date_closed: string }>();
  if (emails.length > 0) {
    for (let i = 0; i < emails.length; i += 200) {
      const chunk = emails.slice(i, i + 200);
      const { data: closes } = await sb
        .from('t06_deals_closed')
        .select('email, cash_collected, contracted_revenue, offer, date_closed')
        .in('email', chunk);
      for (const d of closes ?? []) {
        if (d.email) {
          const e = d.email.toLowerCase();
          closedEmails.add(e);
          closeInfoByEmail.set(e, {
            cash: Number(d.cash_collected ?? 0),
            contracted: Number(d.contracted_revenue ?? 0),
            offer: d.offer,
            date_closed: d.date_closed,
          });
        }
      }
    }
  }

  const enriched = (calls ?? []).map((c: Record<string, unknown>) => {
    const ghl = c.ghl_contact_id as string | null;
    const lead = ghl ? leadByContactId.get(ghl) : null;
    const bk = c.booking_id ? bookingById.get(c.booking_id as string) : null;
    const emailLower = lead?.email?.toLowerCase();
    const closed = emailLower ? closedEmails.has(emailLower) : false;
    const closeInfo = emailLower ? closeInfoByEmail.get(emailLower) : null;
    return {
      ...c,
      // Enrichment fields
      lead_email: lead?.email ?? null,
      lead_name: lead?.name ?? null,
      lead_source: lead?.source ?? null,
      contact_link: lead?.contact_link ?? null,
      booking_status: bk?.status ?? null,
      booking_date: bk?.date_booked_for ?? null,
      closed,
      close_cash: closeInfo?.cash ?? null,
      close_contracted: closeInfo?.contracted ?? null,
      close_offer: closeInfo?.offer ?? null,
      close_date: closeInfo?.date_closed ?? null,
    };
  });

  return NextResponse.json({ calls: enriched, count: enriched.length });
}
