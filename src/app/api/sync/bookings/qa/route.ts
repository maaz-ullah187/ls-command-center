// Booking QA audit — second daily pass
//
// Catches and fixes issues that slip through the primary sync:
//   1. Stub lead_ids (cal-*) → resolves via GHL email search
//   2. Status vs call_outcome_details mismatches → updates status to match evidence
//   3. Grain recordings proving a show on any booking in the email chain
//   4. Stale details (stub leads that now have real GHL contact IDs) → clears for regen
//   5. Duplicate bookings for same email (rebook chains) → deletes older ones
//
// Schedule: run daily AFTER the primary sync + enrich + details pipeline

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { fireCallShowedWebhook } from '@/lib/webhooks/external-webhooks';

export const maxDuration = 120;

const GHL_V2 = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

interface QAReport {
  stubsResolved: number;
  stubsFailed: number;
  statusFixed: number;
  grainChainFixed: number;
  detailsCleared: number;
  duplicatesRemoved: number;
  junkRemoved: number;
}

// Known junk email patterns
const JUNK_PATTERNS = [
  /@example\.com$/i,
  /^test/i,
  /^fake/i,
  /john\.?doe/i,
  /jane\.?doe/i,
  /penis/i,
  /^asdf/i,
];

function isJunkEmail(email: string): boolean {
  return JUNK_PATTERNS.some(p => p.test(email));
}

function isJunkName(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return [
    'test', 'test test', 'john doe', 'jane doe', 'asdf', 'asd',
    'jone doe', 'fake', 'blakepenis', 'jonny sins', 'john pork',
  ].includes(lower);
}

export async function POST() {
  const supabase = await getServerSupabaseAsync();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const ghlToken = process.env.GHL_API_KEY;
  const ghlLocationId = process.env.GHL_LOCATION_ID;

  const report: QAReport = {
    stubsResolved: 0,
    stubsFailed: 0,
    statusFixed: 0,
    grainChainFixed: 0,
    detailsCleared: 0,
    duplicatesRemoved: 0,
    junkRemoved: 0,
  };

  // ── 1. Remove junk/test bookings ──────────────────────────────────────────
  const { data: allBookings } = await supabase
    .from('t03_bookings')
    .select('id, name, email');

  for (const b of allBookings ?? []) {
    if (isJunkEmail(b.email ?? '') || isJunkName(b.name ?? '')) {
      await supabase.from('t03_bookings').delete().eq('id', b.id);
      report.junkRemoved++;
      console.log(`[qa] removed junk: ${b.name} (${b.email})`);
    }
  }

  // ── 2. Resolve stub lead_ids via GHL email search ─────────────────────────
  if (ghlToken && ghlLocationId) {
    const { data: stubs } = await supabase
      .from('t03_bookings')
      .select('id, email, lead_id')
      .like('lead_id', 'cal-%');

    const emailsToResolve = [...new Set((stubs ?? []).map(s => s.email?.toLowerCase()).filter(Boolean))];

    for (const email of emailsToResolve) {
      try {
        const res = await fetch(
          `${GHL_V2}/contacts/?locationId=${ghlLocationId}&query=${encodeURIComponent(email!)}&limit=1`,
          { headers: { Authorization: `Bearer ${ghlToken}`, Version: GHL_VERSION } },
        );
        if (!res.ok) { report.stubsFailed++; continue; }
        const data = await res.json();
        const found = (data.contacts ?? []).find(
          (c: any) => (c.email ?? '').toLowerCase() === email,
        );
        if (found?.id) {
          const { count } = await supabase
            .from('t03_bookings')
            .update({ lead_id: found.id })
            .eq('email', email)
            .like('lead_id', 'cal-%');
          report.stubsResolved += (count ?? 0);
          console.log(`[qa] resolved stub for ${email} → ${found.id}`);
        } else {
          report.stubsFailed++;
        }
        await new Promise(r => setTimeout(r, 100)); // rate limit
      } catch {
        report.stubsFailed++;
      }
    }
  }

  // ── 3. DISABLED: "Grain chain fix" ─────────────────────────────────────────
  // This previously flipped any cancelled/needs-review row → 'show' if ANY
  // booking in the email chain had a Grain recording. That over-triggered on
  // rebook chains (only one of N bookings was the actual call). Per-booking
  // Grain matching now lives in the enrich route v2; the chain-wide flip is
  // removed. Keeping the key in the report for schema stability.
  // report.grainChainFixed stays 0.

  // ── 4. Status vs details mismatch ─────────────────────────────────────────
  // If details clearly say SHOWED/NO SHOW/CANCELLED but status disagrees, fix it
  const { data: withDetails } = await supabase
    .from('t03_bookings')
    .select('id, email, status, call_outcome_details, name, phone, date_booked_for, lead_id, calendly_event_url, calendar, offer, closer_assigned')
    .in('status', ['Needs Review'])
    .not('call_outcome_details', 'is', null);

  for (const b of withDetails ?? []) {
    const details = b.call_outcome_details ?? '';
    // Extract the status from the details (format: "M/D: STATUS.")
    const statusMatch = details.match(/^\d+\/\d+:\s*(SHOWED|NO SHOW|CANCELLED)\./);
    if (!statusMatch) continue;

    const detailedStatus = statusMatch[1];
    let newStatus: string | null = null;

    if (detailedStatus === 'SHOWED' && b.status !== 'Showed') newStatus = 'Showed';
    if (detailedStatus === 'NO SHOW' && b.status !== 'No Showed') newStatus = 'No Showed';
    if (detailedStatus === 'CANCELLED' && b.status !== 'Cancelled') newStatus = 'Cancelled';

    if (newStatus) {
      const { error: updErr } = await supabase
        .from('t03_bookings')
        .update({
          status: newStatus,
          call_outcome_explanation: `QA audit: details say ${detailedStatus}, status updated to match.`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', b.id);
      if (!updErr) {
        report.statusFixed++;
        console.log(`[qa] status fix: ${b.email} ${b.status} → ${newStatus} (details: ${detailedStatus})`);
        if (newStatus === 'Showed') {
          fireCallShowedWebhook({
            booking_id: b.id,
            email: b.email ?? '',
            name: b.name ?? null,
            phone: b.phone ?? null,
            date_booked_for: b.date_booked_for ?? null,
            ghl_contact_id: b.lead_id ?? null,
            calendly_event_url: b.calendly_event_url ?? null,
            calendar: b.calendar ?? null,
            offer: b.offer ?? null,
            closer_assigned: b.closer_assigned ?? null,
            trigger: 'qa',
          }).catch(() => { /* logged inside helper */ });
        }
      }
    }
  }

  // ── 5. Clear stale details for bookings that just got real lead_ids ───────
  const { data: newlyResolved } = await supabase
    .from('t03_bookings')
    .select('id')
    .not('lead_id', 'like', 'cal-%')
    .not('call_outcome_details', 'is', null)
    .or('call_outcome_details.ilike.%no ghl%,call_outcome_details.ilike.%not found%');

  for (const b of newlyResolved ?? []) {
    await supabase
      .from('t03_bookings')
      .update({ call_outcome_details: null })
      .eq('id', b.id);
    report.detailsCleared++;
  }

  // ── 6. DISABLED: "Remove duplicate bookings" ──────────────────────────────
  // This previously DELETED older booking rows whenever the same email had
  // multiple bookings. That destroyed rebook chains — the earlier booking
  // often held the actual showed/cancelled evidence. Rebook chains are now
  // handled in enrich v2: the earlier row is marked 'Rescheduled' with a
  // pointer to the newer row, and both rows are preserved for audit.
  // report.duplicatesRemoved stays 0.

  console.log(`[qa] audit complete:`, report);

  return NextResponse.json(report);
}

export const GET = POST;
