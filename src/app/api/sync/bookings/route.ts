// Sync worker: unified bookings table (t03_bookings)
// Source: Calendly API → all events (active + cancelled) into t03_bookings
// Only pulls from sales call calendars — excludes fulfillment/client success.
// Schedule: every 3 hours via Vercel Cron

import { NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/runner';
import { buildLeadIndex, matchLead } from '@/lib/sync/lead-matcher';
import { tieredSearchGHLContact, mapGHLContactToLeadRow, isJunkPerson } from '@/lib/mappers/ghl';

export const maxDuration = 300;

const ORG_URI = process.env.CALENDLY_ORG_URI
  ?? `https://api.calendly.com/organizations/${process.env.CALENDLY_ORG_ID ?? ''}`;

// Only sync from these sales call calendars. Everything else is filtered out.
// Calendar name → offer mapping. Includes historical name variants.
const SALES_CALENDARS: Record<string, string> = {
  'Discovery Call (Strategy Call)': 'Program C',
  '*Agency Systems Call [ORG]': 'ProgB',
  '$100k/mo Agency Scaling Call': 'ProgB',
  '*Agency Launch Call [NEW-ORG]': 'ProgB',
};

// Hard floor: only sync bookings from April 1 2026 onward
const DATE_FLOOR = '2026-04-01T00:00:00Z';

interface CalendlyEventMembership {
  user: string;       // user URI
  user_email?: string;
  user_name?: string;
}

interface CalendlyEvent {
  uri: string;
  name: string;
  start_time: string;
  end_time: string;
  status: string; // active | canceled
  created_at: string;
  event_type: string;
  // The Calendly v2 /scheduled_events list already returns this on every event —
  // no extra API call needed. First membership = the host / closer assigned.
  event_memberships?: CalendlyEventMembership[];
}

/** Extract the host/closer email from a Calendly event. First membership wins. */
function extractCloserFromEvent(event: CalendlyEvent): string | null {
  const host = event.event_memberships?.[0]?.user_email;
  return host ? host.toLowerCase().trim() : null;
}

interface CalendlyInvitee {
  uri: string;
  email: string;
  name: string;
  status: string; // active | canceled
  cancel_reason?: string;
  text_reminder_number?: string;
  questions_and_answers?: { question: string; answer: string }[];
  created_at: string;
}

async function fetchCalendlyEvents(token: string, status: 'active' | 'canceled'): Promise<CalendlyEvent[]> {
  const allEvents: CalendlyEvent[] = [];
  const finalMax = new Date(Date.now() + 30 * 86400000); // 30 days ahead
  const floorDate = new Date(DATE_FLOOR);

  // Split into 5-day chunks to avoid pagination limits from non-sales events
  const chunkMs = 5 * 86400000;
  let chunkStart = floorDate;

  while (chunkStart < finalMax) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + chunkMs, finalMax.getTime()));
    let nextPage: string | null = null;

    for (let page = 0; page < 50; page++) {
      const url = nextPage || (
        `https://api.calendly.com/scheduled_events` +
        `?organization=${encodeURIComponent(ORG_URI)}` +
        `&status=${status}` +
        `&min_start_time=${chunkStart.toISOString()}` +
        `&max_start_time=${chunkEnd.toISOString()}` +
        `&count=100&sort=start_time:asc`
      );

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        console.error(`[sync/bookings] Calendly events HTTP ${res.status}`);
        break;
      }

      const data = await res.json();
      allEvents.push(...(data.collection ?? []));

      nextPage = data.pagination?.next_page_token
        ? `https://api.calendly.com/scheduled_events?organization=${encodeURIComponent(ORG_URI)}&status=${status}&page_token=${data.pagination.next_page_token}&count=100`
        : null;

      if (!nextPage || (data.collection ?? []).length < 100) break;
    }

    chunkStart = chunkEnd;
  }

  return allEvents;
}

async function fetchInvitees(token: string, eventUri: string): Promise<CalendlyInvitee[]> {
  const res = await fetch(`${eventUri}/invitees`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.collection ?? [];
}

/** Extract phone number from Calendly's questions_and_answers. */
function extractPhone(qas: { question: string; answer: string }[] | undefined): string | null {
  if (!qas || qas.length === 0) return null;
  for (const qa of qas) {
    const q = qa.question.toLowerCase();
    if (q.includes('phone') || q.includes('number') || q.includes('cell') || q.includes('mobile')) {
      const cleaned = (qa.answer || '').trim();
      if (cleaned) return cleaned;
    }
  }
  return null;
}

/** Returns the offer string if the calendar is a sales calendar, null otherwise. */
function salesCalendarOffer(eventName: string): string | null {
  return SALES_CALENDARS[eventName] ?? null;
}

export async function POST() {
  const result = await runSync('bookings', async (sb) => {
    const token = process.env.CALENDLY_TOKEN;
    if (!token) throw new Error('CALENDLY_TOKEN not set');

    // Fetch active and canceled events in parallel
    const [activeEvents, canceledEvents] = await Promise.all([
      fetchCalendlyEvents(token, 'active'),
      fetchCalendlyEvents(token, 'canceled'),
    ]);

    // Filter to sales calendars only
    const salesActive = activeEvents.filter(e => salesCalendarOffer(e.name) !== null);
    const salesCanceled = canceledEvents.filter(e => salesCalendarOffer(e.name) !== null);

    const skippedActive = activeEvents.length - salesActive.length;
    const skippedCanceled = canceledEvents.length - salesCanceled.length;
    console.log(`[sync/bookings] Fetched ${activeEvents.length} active (${skippedActive} non-sales skipped), ${canceledEvents.length} canceled (${skippedCanceled} non-sales skipped)`);

    const bookingRows: any[] = [];

    // Process all events (active + cancelled) → unified t03_bookings
    const allSalesEvents = [
      ...salesActive.map(e => ({ ...e, _calendlyStatus: 'active' as const })),
      ...salesCanceled.map(e => ({ ...e, _calendlyStatus: 'canceled' as const })),
    ];

    const BATCH = 10;
    for (let i = 0; i < allSalesEvents.length; i += BATCH) {
      const batch = allSalesEvents.slice(i, i + BATCH);
      const inviteeResults = await Promise.allSettled(
        batch.map(e => fetchInvitees(token, e.uri))
      );

      for (let j = 0; j < batch.length; j++) {
        const event = batch[j];
        const result = inviteeResults[j];
        if (result.status !== 'fulfilled') continue;
        const invitees = result.value;
        const offer = salesCalendarOffer(event.name);

        for (const inv of invitees) {
          if (!inv.email) continue;
          const email = inv.email.toLowerCase().trim();
          const name = (inv.name || '').toLowerCase().trim();

          // Skip junk/test bookings — use the shared isJunkPerson filter so
          // booking sync and the GHL mapper agree on what counts as junk.
          // Covers internal @yourcompany emails, slurs, placeholder
          // identities / disposable mail / "test" anywhere / etc.
          if (isJunkPerson({ name: inv.name, email: inv.email, phone: extractPhone(inv.questions_and_answers) })) continue;

          const invId = inv.uri.split('/').pop()!;

          // Future-dated bookings get a PENDING marker on all three columns so
          // the dashboard clearly shows the call hasn't happened yet (the operator
          // 2026-04-19). Past-dated bookings fall through to enrich as normal.
          const isFuture = new Date(event.start_time).getTime() > Date.now();
          const isCancelled = event._calendlyStatus === 'canceled';
          let initialStatus: string | null = null;
          let initialExplanation: string | null = null;
          let initialDetails: string | null = null;
          if (isCancelled) {
            initialStatus = 'Cancelled';
            initialExplanation = inv.cancel_reason || null;
          } else if (isFuture) {
            initialStatus = 'PENDING';
            initialExplanation = 'PENDING — CALL NOT TAKEN';
            initialDetails = 'PENDING — CALL NOT TAKEN';
          }

          bookingRows.push({
            id: invId,
            date_created: inv.created_at,
            date_booked_for: event.start_time,
            name: inv.name || 'Unknown',
            email: inv.email.toLowerCase().trim(),
            phone: extractPhone(inv.questions_and_answers),
            calendar: event.name,
            offer,
            status: initialStatus,
            call_outcome_explanation: initialExplanation,
            call_outcome_details: initialDetails,
            calendly_event_url: event.uri,
            // Closer assigned at booking time — extracted from Calendly event host.
            // Enrich later falls back to t04_call_recordings.closer_email for
            // historical rows that predate this field.
            closer_assigned: extractCloserFromEvent(event),
            updated_at: new Date().toISOString(),
          });
        }
      }
    }

    // Before upserting, check which bookings already exist so we don't overwrite
    // status/details set by the enrich/QA pipelines
    const existingEmails = new Map<string, { id: string; date_booked_for: string }>();
    const existingWithStatus = new Set<string>();
    const { data: existingBookings } = await sb
      .from('t03_bookings')
      .select('id, email, date_booked_for, status');
    for (const b of existingBookings ?? []) {
      if (b.email) existingEmails.set(b.email.toLowerCase(), { id: b.id, date_booked_for: b.date_booked_for });
      if (b.status) existingWithStatus.add(b.id);
    }

    // Strip status/explanation/details from rows that already have enriched
    // status — prevents overwriting 'Showed' back to 'Cancelled' on re-sync
    // AND prevents blanking call_outcome_details that the details route
    // generated. call_outcome_details is owned by the details pipeline, not
    // the Calendly sync.
    for (const row of bookingRows) {
      if (existingWithStatus.has(row.id)) {
        delete row.status;
        delete row.call_outcome_explanation;
        delete row.call_outcome_details;
      }
      // Never null out a previously-populated closer_assigned. Only overwrite
      // when Calendly returned a concrete host. If the event has no host in the
      // list response (rare), leave whatever's in the DB (Grain-backfilled etc).
      if (!row.closer_assigned) delete row.closer_assigned;
    }

    // Upsert all bookings into t03_bookings
    let upserted = 0;
    for (let i = 0; i < bookingRows.length; i += 100) {
      const { error } = await sb
        .from('t03_bookings')
        .upsert(bookingRows.slice(i, i + 100), { onConflict: 'id' });
      if (error) throw error;
      upserted += bookingRows.slice(i, i + 100).length;
    }

    // If a booking's date changed (rebook), clear status/details so they get regenerated
    let dateChanges = 0;
    for (const row of bookingRows) {
      const existing = existingEmails.get(row.email);
      if (existing && existing.id !== row.id && existing.date_booked_for !== row.date_booked_for) {
        // This is a new Calendly event for an existing email — date changed
        // The dedup step below will handle which one to keep
        dateChanges++;
      }
    }
    if (dateChanges > 0) {
      console.log(`[sync/bookings] Detected ${dateChanges} rebooks (date changed for existing emails)`);
    }

    // --- Link bookings to leads via tiered matching ---
    // If no lead exists, create a stub lead so every booking has a lead_id.
    // Also pull contact_link from the matched lead for easy GHL access.
    const leadIndex = await buildLeadIndex(sb);

    // Build a lead_id → contact_link lookup
    const { data: leadsWithLinks } = await sb
      .from('t01_leads')
      .select('id, contact_link')
      .not('contact_link', 'is', null);
    const contactLinkByLeadId = new Map<string, string>();
    for (const l of leadsWithLinks ?? []) {
      if (l.contact_link) contactLinkByLeadId.set(l.id, l.contact_link);
    }

    let linked = 0;
    let stubsCreated = 0;
    let liveResolved = 0;

    const ghlToken = process.env.GHL_API_KEY;
    const ghlLocationId = process.env.GHL_LOCATION_ID;
    const ghlAvailable = !!(ghlToken && ghlLocationId);

    for (const row of bookingRows) {
      let leadId = matchLead(leadIndex, row.email, row.phone, row.name);

      // Tier 2: local index missed — ask GHL directly by phone → email → name.
      // This catches contacts that aren't yet in t01_leads (fresh opt-ins, email
      // drift like jennifer@x vs ryanchute@x, or past the pagination horizon).
      if (!leadId && ghlAvailable) {
        const ghlContact = await tieredSearchGHLContact(ghlToken!, ghlLocationId!, {
          phone: row.phone,
          email: row.email,
          name: row.name,
        });
        if (ghlContact) {
          const leadRow = mapGHLContactToLeadRow(ghlContact, ghlLocationId!);
          if (leadRow) {
            const { error: upErr } = await sb
              .from('t01_leads')
              .upsert(leadRow, { onConflict: 'id' });
            if (!upErr) {
              leadId = leadRow.id;
              // Refresh local index so later rows in this batch see it
              if (leadRow.email) leadIndex.byEmail.set(leadRow.email, leadRow.id);
              if (leadRow.phone) {
                const d = leadRow.phone.replace(/[^\d]/g, '');
                if (d.length >= 7) leadIndex.byPhone.set(d, leadRow.id);
              }
              const nm = (leadRow.name ?? '').toLowerCase().trim();
              if (nm.length >= 3) leadIndex.byName.set(nm, leadRow.id);
              if (leadRow.contact_link) contactLinkByLeadId.set(leadRow.id, leadRow.contact_link);
              liveResolved++;
            }
          }
        }
      }

      // Last resort: create a stub so the booking row has a lead_id.
      // Only used when email/phone/name all fail to find a GHL contact.
      if (!leadId && row.email) {
        const stubId = `cal-${row.email.replace(/[^a-z0-9]/gi, '-')}`;
        const { error: stubErr } = await sb
          .from('t01_leads')
          .upsert({
            id: stubId,
            date: row.date_created ? new Date(row.date_created).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
            name: row.name || 'Unknown',
            email: row.email,
            phone: row.phone || null,
            source: 'Unknown',
            campaign_name: null,
            ad_set_name: null,
            ad_name: null,
            contact_link: null,
            offer: row.offer || null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'id' });

        if (!stubErr) {
          leadId = stubId;
          leadIndex.byEmail.set(row.email.toLowerCase().trim(), stubId);
          stubsCreated++;
        }
      }

      if (leadId) {
        const contactLink = contactLinkByLeadId.get(leadId) ?? null;
        await sb.from('t03_bookings').update({ lead_id: leadId, contact_link: contactLink }).eq('id', row.id);
        linked++;
      }
    }

    console.log(`[sync/bookings] Upserted ${upserted} bookings. Linked ${linked}/${upserted}. Live-resolved ${liveResolved} from GHL. Created ${stubsCreated} stubs.`);

    // --- DISABLED: destructive dedup (rebook chains) ---
    // This previously DELETED older booking rows per email chain, preferring
    // NULL-status (future) bookings over classified past ones. It destroyed
    // ~75 enriched classifications between its cron runs on 2026-04-18.
    // Rebook chains are now handled non-destructively in enrich v2: the
    // earlier booking gets status='Rescheduled', both rows are preserved for
    // audit. No rows should be deleted here.
    const deduped = 0;

    return { rowsUpserted: upserted, rowsSkipped: skippedActive + skippedCanceled, deduped };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = POST;
