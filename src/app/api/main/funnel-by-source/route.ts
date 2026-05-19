import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { timeframeFromSearchParams } from '@/lib/timeframe';

/**
 * GET /api/main/funnel-by-source — Lead → Booked → Showed → Closed funnel,
 * grouped by source channel.
 *
 * Sources:
 *   leads      ← t01_leads.source (canonSource'd; counted by created date)
 *   bookings   ← t03_bookings (joined to lead by email — denormalized in t03)
 *   showed     ← t03_bookings.showed = true
 *   closed/cash ← t06_deals_closed.source (canonSource'd) — the operator 2026-04-30:
 *                 cash column MUST match the Cash by Source donut, so we use
 *                 t06.source ONLY (no t01 fallback) and run the same
 *                 canonSource() pipeline. Result: Sales Funnel cash totals
 *                 reconcile to the cent against Cash by Source.
 */

// Same canonicalisation pipeline as /api/main/cash-breakdown so source
// labels match exactly across the two cards.
function canonSource(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return 'Unknown';
  const k = s.toLowerCase();
  if (k === 'unknown') return 'Unknown';
  if (k === 'twitter' || k === 'x' || k === 'x.com' || k === 'twitter/x') return 'X';
  if (k === 'fb' || k === 'facebook' || k === 'meta' || k === 'facebook ads' || k === 'facebook ad' || k === 'paid' || k === 'paid ads') return 'Facebook Ads';
  if (k === 'yt' || k === 'youtube' || k === 'youtube ads') return 'YouTube';
  if (k === 'ig' || k === 'instagram') return 'Instagram';
  if (k === 'li' || k === 'linkedin') return 'LinkedIn';
  if (k === 'organic' || k === 'seo') return 'Organic';
  if (k === 'referral' || k === 'ref' || k === 'referred') return 'Referral';
  if (k === 'webinar' || k === 'webinars') return 'Webinar';
  if (/^[a-z]+$/i.test(s) && !['email','sms','dm','outbound','inbound','website','direct','affiliate','partner'].includes(k)) {
    return 'Referral';
  }
  return s;
}
interface Row {
  source: string;
  leads: number;
  bookings: number;
  showed: number;
  closed: number;
  cash: number;
  leadToBookPct: number;
  closePct: number;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const window = timeframeFromSearchParams(url.searchParams);

  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ rows: [], window, configured: false });
  }

  // Pull leads in window
  const { data: leadsData, error: leadsErr } = await supa
    .from('t01_leads')
    .select('id, source, email, date')
    .gte('date', window.from)
    .lte('date', window.to)
    .limit(20000);
  if (leadsErr) {
    return NextResponse.json({ error: leadsErr.message, window }, { status: 502 });
  }

  // Pull bookings in window (joined by email). t03_bookings.status carries
  // 'Showed' / 'No Showed' / 'Cancelled' / 'Rescheduled' / 'Needs Review'.
  const { data: bookingsData, error: bkErr } = await supa
    .from('t03_bookings')
    .select('email, status, date_booked_for')
    .gte('date_booked_for', window.from)
    .lte('date_booked_for', window.to + 'T23:59:59')
    .limit(20000);
  if (bkErr) {
    return NextResponse.json({ error: bkErr.message, window }, { status: 502 });
  }

  // Pull deals in window
  const { data: dealsData, error: dlErr } = await supa
    .from('t06_deals_closed')
    .select('lead_id, source, cash_collected, date_closed')
    .gte('date_closed', window.from)
    .lte('date_closed', window.to)
    .limit(5000);
  if (dlErr) {
    return NextResponse.json({ error: dlErr.message, window }, { status: 502 });
  }

  // Build helpers
  const sourceByEmail = new Map<string, string>();
  const byKey = new Map<string, Row>();
  const ensure = (src: string): Row => {
    let r = byKey.get(src);
    if (!r) {
      r = { source: src, leads: 0, bookings: 0, showed: 0, closed: 0, cash: 0, leadToBookPct: 0, closePct: 0 };
      byKey.set(src, r);
    }
    return r;
  };

  for (const l of leadsData ?? []) {
    const canonical = canonSource(l.source);
    if (l.email) sourceByEmail.set(l.email.toLowerCase(), canonical);
    ensure(canonical).leads += 1;
  }

  for (const b of bookingsData ?? []) {
    const email = (b.email ?? '').toLowerCase();
    const src = sourceByEmail.get(email) ?? 'Unknown';
    const row = ensure(src);
    row.bookings += 1;
    if ((b.status ?? '').toLowerCase() === 'showed') row.showed += 1;
  }

  // Cash + closed: from t06_deals_closed.source ONLY, canonSource'd.
  // the operator 2026-04-30: must match Cash by Source exactly. No t01 fallback,
  // no fancy resolution chain — same source the donut uses.
  for (const d of dealsData ?? []) {
    const src = canonSource(d.source);
    const row = ensure(src);
    row.closed += 1;
    row.cash += Number(d.cash_collected ?? 0);
  }

  for (const r of byKey.values()) {
    r.leadToBookPct = r.leads > 0 ? (r.bookings / r.leads) * 100 : 0;
    r.closePct = r.showed > 0 ? (r.closed / r.showed) * 100 : 0;
  }

  const rows = Array.from(byKey.values()).sort((a, b) => b.cash - a.cash);
  return NextResponse.json({ rows, window, configured: true });
}
