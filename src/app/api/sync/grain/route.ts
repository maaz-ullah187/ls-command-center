// Grain → t04_call_recordings sync worker
//
// Fetches workspace recordings from Grain, filters to CLOSER SALES calls only
// (controlled by t90_team_roster), extracts prospect names, cross-references
// against t01_leads + t03_bookings, and upserts into t04_call_recordings.
//
// Filtering:
//   1. Only recordings where the owner is a closer (role='closer' in t90_team_roster)
//   2. Internal meetings are excluded (All Hands, team syncs, the operator & Closer Two, etc.)
//
// Matching priority for lead linkage:
//   1. Exact full name match → t01_leads
//   2. First-name match (only if unique across all leads)
//   3. GHL email search fallback for unmatched prospects
//
// Matching priority for booking linkage:
//   1. Lead email → t03_bookings email
//   2. Lead ID → t03_bookings lead_id
//   3. Booking date ±1 day of call date
//
// To add a new closer: INSERT INTO t90_team_roster (email, name, role) VALUES (..., 'closer');
//
// Schedule: 0 20 * * * (8 PM UTC daily — after calls are done for the day)

import { NextResponse } from 'next/server';
import { fetchGrainRecordings, extractProspectName } from '@/lib/mappers/grain';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const maxDuration = 300;

export async function POST(request: Request) {
  const token = process.env.GRAIN_API_KEY;
  if (!token) {
    return NextResponse.json({ error: 'GRAIN_API_KEY not configured' }, { status: 500 });
  }

  const supabase = await getServerSupabaseAsync();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // maxPages override lets us do historical backfills without changing the
  // scheduled cron's default (50 pages = 1000 recordings ≈ 6 weeks of sales
  // calls at current volume). Pass ?max_pages=200 to reach further back.
  const { searchParams } = new URL(request.url);
  const maxPagesParam = Number(searchParams.get('max_pages'));
  const maxPages = Number.isFinite(maxPagesParam) && maxPagesParam > 0 ? Math.min(maxPagesParam, 500) : 50;

  // Load closer emails from team roster — only closers' recordings get synced
  const { data: closers } = await supabase
    .from('t90_team_roster')
    .select('email')
    .eq('role', 'closer')
    .eq('active', true);

  const closerEmails = new Set(
    (closers ?? []).map((c: { email: string }) => c.email.toLowerCase())
  );

  if (closerEmails.size === 0) {
    return NextResponse.json({ error: 'No active closers in t90_team_roster' }, { status: 500 });
  }

  console.log(`[grain-sync] active closers: ${[...closerEmails].join(', ')}`);

  // Fetch all Grain recordings (default 50 pages = ~1000 recordings).
  // Override via ?max_pages=N — used for backfills.
  const recordings = await fetchGrainRecordings(token, maxPages);
  console.log(`[grain-sync] fetched ${recordings.length} recordings from Grain (maxPages=${maxPages})`);

  // Filter to closer recordings only, then exclude internal meetings
  const closerRecordings = recordings.filter(rec =>
    rec.owners.some(o => closerEmails.has(o.toLowerCase()))
  );
  const salesRecordings = closerRecordings.filter(rec => rec.callType !== 'internal');
  const internalSkipped = closerRecordings.length - salesRecordings.length;
  const nonCloserSkipped = recordings.length - closerRecordings.length;
  console.log(`[grain-sync] ${salesRecordings.length} sales recordings, ${internalSkipped} internal skipped, ${nonCloserSkipped} non-closer skipped`);

  // Build a prospect-name → lead lookup from t01_leads
  const { data: leads } = await supabase
    .from('t01_leads')
    .select('id, name, email');

  const leadByNameLower = new Map<string, { id: string; email: string }>();
  const leadByEmail = new Map<string, { id: string; name: string }>();
  // First-name index: first_name → lead (only stored if unique, null if ambiguous)
  const leadByFirstName = new Map<string, { id: string; email: string } | null>();
  for (const l of leads ?? []) {
    if (l.email) leadByEmail.set(l.email.toLowerCase().trim(), { id: l.id, name: l.name });
    if (l.name) {
      leadByNameLower.set(l.name.toLowerCase().trim(), { id: l.id, email: l.email });
      const first = l.name.toLowerCase().trim().split(/\s+/)[0];
      if (first && first.length >= 3) {
        if (leadByFirstName.has(first)) {
          leadByFirstName.set(first, null); // ambiguous — multiple leads share this first name
        } else {
          leadByFirstName.set(first, { id: l.id, email: l.email });
        }
      }
    }
  }

  // Build booking lookups from t03_bookings (include offer so we can stamp it on t04)
  const { data: bookings } = await supabase
    .from('t03_bookings')
    .select('id, email, lead_id, date_booked_for, offer');

  const bookingByEmail = new Map<string, string>();
  const bookingByLeadId = new Map<string, string>();
  const bookingDateByEmail = new Map<string, string>(); // email → date (YYYY-MM-DD)
  const bookingOfferById = new Map<string, string>(); // booking_id → offer
  for (const b of bookings ?? []) {
    if (b.email) {
      bookingByEmail.set(b.email.toLowerCase(), b.id);
      if (b.date_booked_for) {
        bookingDateByEmail.set(b.email.toLowerCase(), b.date_booked_for.slice(0, 10));
      }
    }
    if (b.lead_id) bookingByLeadId.set(b.lead_id, b.id);
    if (b.offer) bookingOfferById.set(b.id, b.offer);
  }

  // Build lead → offer lookup for tier-2 fallback
  const { data: leadsWithOffer } = await supabase
    .from('t01_leads')
    .select('id, offer')
    .not('offer', 'is', null);
  const leadOfferById = new Map<string, string>();
  for (const l of leadsWithOffer ?? []) {
    if (l.offer) leadOfferById.set(l.id, l.offer);
  }

  // Tier-3 fallback: parse Grain title for offer keywords.
  // Customize these patterns to match the Calendly event-name conventions
  // you use for each program. Each regex is matched against a Grain title.
  function offerFromTitle(title: string | null | undefined): string | null {
    if (!title) return null;
    const t = title.toLowerCase();
    if (/(ai[-\s]?roi|program c|ai implementation|programc|ai agent|ai.*audit|ai integration|ai assessment)/.test(t)) return 'Program C';
    if (/program b/.test(t)) return 'ProgB';
    if (/program a/.test(t)) return 'ProgA';
    return null;
  }

  let upserted = 0;
  let errors = 0;
  let internalDeleted = 0;

  for (const rec of salesRecordings) {
    try {
      // Extract prospect name from title using shared mapper logic
      const prospectName = extractProspectName(rec.title, rec.owners);

      // Match prospect to a lead: exact name → first-name (if unique)
      let ghlContactId: string | null = null;
      let leadEmail: string | null = null;
      if (prospectName) {
        const nameKey = prospectName.toLowerCase().trim();
        let match = leadByNameLower.get(nameKey);

        // Fallback: first-name match when only one lead has that first name
        if (!match) {
          const firstName = nameKey.split(/\s+/)[0];
          if (firstName && firstName.length >= 3) {
            const firstMatch = leadByFirstName.get(firstName);
            if (firstMatch) match = firstMatch; // null means ambiguous, skip
          }
        }

        if (match) {
          ghlContactId = match.id;
          leadEmail = match.email;
        }
      }

      // Match to a booking — multiple strategies
      let bookingId: string | null = null;

      // Strategy 1: lead email → booking email
      if (leadEmail) {
        bookingId = bookingByEmail.get(leadEmail.toLowerCase()) ?? null;
      }

      // Strategy 2: lead ID → booking lead_id
      if (!bookingId && ghlContactId) {
        bookingId = bookingByLeadId.get(ghlContactId) ?? null;
      }

      // Strategy 3: date-based matching — find bookings within ±1 day of call date
      if (!bookingId && leadEmail && rec.startDatetime) {
        const callDate = rec.startDatetime.slice(0, 10);
        const bookingDate = bookingDateByEmail.get(leadEmail.toLowerCase());
        if (bookingDate) {
          const callD = new Date(callDate).getTime();
          const bookD = new Date(bookingDate).getTime();
          if (Math.abs(callD - bookD) <= 86400000) { // ±1 day
            bookingId = bookingByEmail.get(leadEmail.toLowerCase()) ?? null;
          }
        }
      }

      // Derive offer: booking.offer > lead.offer > title-parse
      const offer =
        (bookingId && bookingOfferById.get(bookingId)) ||
        (ghlContactId && leadOfferById.get(ghlContactId)) ||
        offerFromTitle(rec.title) ||
        null;

      const row = {
        id: rec.id,
        call_date: rec.startDatetime ? rec.startDatetime.slice(0, 10) : null,
        call_title: rec.title,
        duration_min: Math.round(rec.durationMs / 60000),
        closer_email: rec.owners[0] ?? null,
        grain_url: rec.url,
        transcript_txt_url: rec.transcriptTxtUrl ?? null,
        prospect_name: prospectName,
        ghl_contact_id: ghlContactId,
        booking_id: bookingId,
        offer,
      };

      const { error } = await supabase
        .from('t04_call_recordings')
        .upsert(row, { onConflict: 'id' });

      if (error) {
        console.error(`[grain-sync] upsert error for ${rec.id}: ${error.message}`);
        errors++;
      } else {
        upserted++;
      }
    } catch (err) {
      console.error(`[grain-sync] error processing ${rec.id}:`, err);
      errors++;
    }
  }

  // Clean up: delete any internal meetings that were previously synced (match by title)
  const { data: allExisting } = await supabase
    .from('t04_call_recordings')
    .select('id, call_title');

  const internalPatterns = [
    /all hands/i, /entire team/i, /internal sync/i,
    /^program b$/i, /team meeting/i,
    /sales team sync/i, /sales team training/i,
    /team sync/i, /team training/i,
    /\b1:1\b.*sync/i, /\bsync\b.*1:1/i,
    /standup/i, /stand-up/i, /huddle/i,
    /check-?in/i, /one on one/i,
  ];
  const teamOnlyPattern = /^AI Integration™?\s*[-–—]\s*the operator\b/i;

  const idsToDelete = new Set<string>();
  for (const r of allExisting ?? []) {
    if (internalPatterns.some(p => p.test(r.call_title)) || teamOnlyPattern.test(r.call_title)) {
      idsToDelete.add(r.id);
    }
  }

  if (idsToDelete.size > 0) {
    const { error } = await supabase
      .from('t04_call_recordings')
      .delete()
      .in('id', [...idsToDelete]);
    if (!error) {
      internalDeleted = idsToDelete.size;
      console.log(`[grain-sync] deleted ${internalDeleted} internal/fulfillment recordings`);
    }
  }

  console.log(`[grain-sync] done. upserted=${upserted} errors=${errors} internalDeleted=${internalDeleted}`);

  return NextResponse.json({
    total: recordings.length,
    salesRecordings: salesRecordings.length,
    nonCloserSkipped,
    internalSkipped,
    internalDeleted,
    upserted,
    errors,
  });
}

// Vercel Cron sends GET requests
export const GET = POST;
