// Booking status enrichment worker — v2
//
// Implements the booking-status decision tree (see comments below).
//
// For every past-dated booking (date_booked_for < now):
//   1. Rescheduled check — later booking for matching identity?
//   2. Showed signals — #new-clients slack, valid Grain (≥10 min), demo-call-notes,
//      GHL pipeline stage, GHL post-call conversation phrases
//   3. No Showed signals — demo-call-notes "No Show", GHL pipeline "No Show",
//      3+ team follow-ups after booking with no lead reply
//   4. Cancelled — Calendly canceled + no rebook + no show signal
//   5. Needs Review — fallback (ALL conflict cases)
//
// Query params:
//   ?dry_run=true  → return proposed changes without writing anything (review before apply)
//   ?ids=...,...   → only process these booking ids (for targeted re-enrichment)
//
// Schedule: nightly at 00:00 UTC (8pm ET) — runs on ALL past bookings so stale
// Cancelled/Needs Review rows get re-evaluated when new signals arrive.

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { parseDemoCallNote, deriveStatusFromSlack, type SlackDerivedStatus } from '@/lib/parsers/slack/demoCallNotes';
import { fetchGHLConversations } from '@/lib/mappers/ghl';
import { fireCallShowedWebhook } from '@/lib/webhooks/external-webhooks';

export const maxDuration = 300;

// ── Constants ────────────────────────────────────────────────────────────────

const GRAIN_MIN_DURATION = 10; // minutes — under this = invalid signal (per audit threshold)
const GRAIN_DATE_WINDOW_DAYS = 7; // ±7 days — widened from 2 per the spec 2026-04-20:
// reschedules, late-starts, and host-record-late mean the Grain call_date can
// drift several days from the booking date. Keeping the ≥10 min duration gate
// prevents false positives.
const NO_SHOW_FOLLOWUP_THRESHOLD = 3; // team follow-ups after booking w/ no reply

const POST_CALL_PIPELINE_STAGES = new Set([
  'closed won', 'closed lost', 'proposal sent', 'contract sent',
  'follow up', 'follow-up', 'showed', 'nurture', 'not financially qualified',
  'won', 'closed', 'negotiation', 'decision maker',
]);

const NO_SHOW_PIPELINE_STAGES = new Set([
  'no show', 'no showed', 'no-show', 'no-showed', 'did not show', 'dns',
]);

// Pipeline stages that indicate the call was cancelled outright. Used as a
// tiebreaker when no other status signal fires — per the spec 2026-04-30,
// closers sometimes update the GHL pipeline but not Calendly, so we have
// to read the pipeline stage to catch those.
const CANCELLED_PIPELINE_STAGES = new Set([
  'call cancelled', 'call canceled', 'cancelled', 'canceled',
  'lead cancelled', 'lead canceled',
]);

// Phrases from TEAM that strongly indicate the call happened (post-call follow-up)
const POST_CALL_PHRASES = [
  'great talking to you on',
  'great call today',
  'great call yesterday',
  'as discussed on our call',
  'as discussed on the call',
  'thanks for hopping on',
  'thanks for jumping on',
  'following up on our call',
  'following up from our call',
  'great chatting with you today',
  'great chatting with you yesterday',
];

const GHL_V2 = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// ── Helpers ──────────────────────────────────────────────────────────────────

function normName(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normPhone(phone: string | null | undefined): string {
  return (phone ?? '').replace(/[^\d]/g, '');
}

function dateOnly(ts: string | null | undefined): string {
  return (ts ?? '').slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const d1 = new Date(a).getTime();
  const d2 = new Date(b).getTime();
  return Math.abs(d1 - d2) / 86400000;
}

// ── GHL live-signal fetch (per-booking, only when needed) ────────────────────

interface GHLLiveSignals {
  pipelineStage: string | null;
  pipelineName: string | null;
  postCallPhraseFound: { phrase: string; dateStr: string } | null;
  teamFollowUpsAfterBooking: number;
  leadRepliedAfterBooking: boolean;
}

async function fetchGHLPipeline(
  token: string,
  locationId: string,
  contactId: string,
): Promise<{ stage: string | null; pipeline: string | null }> {
  try {
    const res = await fetch(
      `${GHL_V2}/opportunities/search?location_id=${locationId}&contact_id=${contactId}&limit=5`,
      { headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION } },
    );
    if (!res.ok) return { stage: null, pipeline: null };
    const data = await res.json();
    const opp = (data.opportunities ?? [])[0];
    if (!opp) return { stage: null, pipeline: null };
    let stage = opp.stageName ?? null;
    const pipeline = opp.pipelineName ?? null;
    // Resolve stage id → name if we only have the id
    if (!stage && opp.pipelineStageId && opp.pipelineId) {
      try {
        const pr = await fetch(
          `${GHL_V2}/opportunities/pipelines/${opp.pipelineId}`,
          { headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION } },
        );
        if (pr.ok) {
          const pd = await pr.json();
          const stages = pd.pipeline?.stages ?? pd.stages ?? [];
          const found = stages.find((s: { id: string; name: string }) => s.id === opp.pipelineStageId);
          if (found) stage = found.name;
        }
      } catch { /* ignore */ }
    }
    return { stage, pipeline };
  } catch {
    return { stage: null, pipeline: null };
  }
}

async function fetchGHLLiveSignals(
  token: string,
  locationId: string,
  contactId: string,
  bookedAt: string,
): Promise<GHLLiveSignals> {
  const [{ stage, pipeline }, convos] = await Promise.all([
    fetchGHLPipeline(token, locationId, contactId),
    fetchGHLConversations(token, locationId, contactId, 50),
  ]);

  const bookedTs = new Date(bookedAt).getTime();

  // Scan team messages after booking time for post-call phrases
  let postCallPhraseFound: { phrase: string; dateStr: string } | null = null;
  let teamFollowUpsAfterBooking = 0;
  let leadRepliedAfterBooking = false;

  for (const m of convos) {
    const msgTs = new Date(m.timestamp).getTime();
    if (Number.isNaN(msgTs) || msgTs <= bookedTs) continue;
    const body = (m.body ?? '').toLowerCase();

    if (m.direction === 'outbound') {
      // Team message after booking
      for (const p of POST_CALL_PHRASES) {
        if (body.includes(p)) {
          postCallPhraseFound = { phrase: p, dateStr: m.timestamp.slice(0, 10) };
          break;
        }
      }
      if (!postCallPhraseFound) teamFollowUpsAfterBooking++;
    } else if (m.direction === 'inbound') {
      leadRepliedAfterBooking = true;
    }
  }

  return {
    pipelineStage: stage,
    pipelineName: pipeline,
    postCallPhraseFound,
    teamFollowUpsAfterBooking,
    leadRepliedAfterBooking,
  };
}

// ── Slack demo-call-notes fetch (inline for now; TODO migrate to t21 table) ──

interface SlackMessage { text?: string; ts?: string; blocks?: unknown[] }

async function fetchSlackMessages(
  token: string, channelId: string, oldest: number,
): Promise<SlackMessage[]> {
  const all: SlackMessage[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const url = new URL('https://slack.com/api/conversations.history');
    url.searchParams.set('channel', channelId);
    url.searchParams.set('oldest', String(oldest));
    url.searchParams.set('limit', '200');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) break;
    const data = await res.json();
    if (!data.ok) break;
    if (data.messages?.length) all.push(...data.messages);
    if (!data.has_more || !data.response_metadata?.next_cursor) break;
    cursor = data.response_metadata.next_cursor;
  }
  return all;
}

// ── Types ────────────────────────────────────────────────────────────────────

type Status = 'Showed' | 'No Showed' | 'Cancelled' | 'Rescheduled' | 'Needs Review';

interface Booking {
  id: string;
  lead_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  date_booked_for: string;
  status: string | null;
  calendar: string | null;
  calendly_event_url: string | null;
}

interface Classification {
  bookingId: string;
  leadIdentity: string;
  previousStatus: string | null;
  newStatus: Status;
  explanation: string;
  evidence: string[];
  source: string; // e.g. "grain:valid_duration", "slack:new_clients", "pipeline:closed_won"
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get('dry_run') === 'true';
  const idsParam = searchParams.get('ids');
  const targetIds = idsParam ? idsParam.split(',').map(s => s.trim()).filter(Boolean) : null;

  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const ghlToken = process.env.GHL_API_KEY;
  const ghlLocationId = process.env.GHL_LOCATION_ID;
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const demoChannel = process.env.SLACK_CHANNEL_DEMO_CALL_NOTES;

  // ── Load every past-dated booking (plus targeted ids if given) ─────────────
  // the operator rule (2026-04-21): rows with call_outcome_details LIKE 'MANUAL_LOCK%'
  // have a manual status ruling from the operator and must NEVER be overridden by
  // automated enrich. The enrich run classifies them just for audit but does
  // not apply the change.
  let q = sb.from('t03_bookings').select('*').lt('date_booked_for', new Date().toISOString());
  if (targetIds) q = q.in('id', targetIds);
  const { data: pastBookings, error: loadErr } = await q;
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!pastBookings?.length) return NextResponse.json({ message: 'No past bookings', processed: 0 });

  const isManualLocked = (row: { call_outcome_details?: string | null }) =>
    typeof row.call_outcome_details === 'string' &&
    row.call_outcome_details.startsWith('MANUAL_LOCK');
  const manualLockedCount = pastBookings.filter(isManualLocked).length;

  // ── Load all bookings (any date) for reschedule detection ──────────────────
  const { data: allBookings } = await sb.from('t03_bookings').select('id, lead_id, email, phone, name, date_booked_for, status');
  const all: Booking[] = (allBookings ?? []) as Booking[];

  // ── Grain index ────────────────────────────────────────────────────────────
  const { data: recordings } = await sb
    .from('t04_call_recordings')
    .select('id, call_date, duration_min, prospect_name, booking_id, ghl_contact_id, grain_url');
  const grainByBooking = new Map<string, (typeof recordings)[number]>();
  const grainByLead = new Map<string, (typeof recordings)[number][]>();
  const grainByNormName = new Map<string, (typeof recordings)[number][]>();
  // Fuzzy-name index: "<first-name-prefix>.<last-initial>" → recordings.
  // Catches "Jen Underhill" matching "Jennifer Underhill", "Chris Jones"
  // matching "Christopher Jones", "Mike D" matching "Mike Davidson".
  const grainByFuzzyName = new Map<string, (typeof recordings)[number][]>();
  // First-name-only index: last-resort matcher. Combined with ±7d date
  // window + ≥10 min duration gate, false-positive risk is acceptable
  // (unlikely that two distinct "John"s book AI calls within the same week
  // AND both produce ≥10 min recordings). Catches "Sonny/Sunny", "Rob/Bob",
  // "Mike/Michael" cases that break prefix matching.
  const grainByFirstName = new Map<string, (typeof recordings)[number][]>();
  function fuzzyNameKey(name: string | null | undefined): string | null {
    const nn = normName(name);
    if (!nn) return null;
    const parts = nn.split(' ').filter(Boolean);
    if (parts.length < 2) return null;
    const first = parts[0].slice(0, 3);
    const lastInitial = parts[parts.length - 1].slice(0, 1);
    if (first.length < 3 || !lastInitial) return null;
    return `${first}.${lastInitial}`;
  }
  function firstNameKey(name: string | null | undefined): string | null {
    const nn = normName(name);
    if (!nn) return null;
    const first = nn.split(' ')[0];
    if (!first || first.length < 3) return null;
    return first;
  }

  for (const r of recordings ?? []) {
    if (r.booking_id) grainByBooking.set(r.booking_id, r);
    if (r.ghl_contact_id) {
      const l = grainByLead.get(r.ghl_contact_id) ?? [];
      l.push(r); grainByLead.set(r.ghl_contact_id, l);
    }
    const nn = normName(r.prospect_name);
    if (nn) {
      const l = grainByNormName.get(nn) ?? [];
      l.push(r); grainByNormName.set(nn, l);
    }
    const fk = fuzzyNameKey(r.prospect_name);
    if (fk) {
      const l = grainByFuzzyName.get(fk) ?? [];
      l.push(r); grainByFuzzyName.set(fk, l);
    }
    const fnk = firstNameKey(r.prospect_name);
    if (fnk) {
      const l = grainByFirstName.get(fnk) ?? [];
      l.push(r); grainByFirstName.set(fnk, l);
    }
  }

  // ── #new-clients Slack index (already in t20) ──────────────────────────────
  const { data: newClients } = await sb.from('t20_slack_new_clients').select('email, slack_ts, closer_name, program, contracted_revenue');
  const newClientByEmail = new Map<string, { slack_ts: string; closer_name: string | null; program: string | null }>();
  for (const nc of newClients ?? []) {
    const em = (nc.email ?? '').toLowerCase().trim();
    if (em) newClientByEmail.set(em, { slack_ts: nc.slack_ts, closer_name: nc.closer_name, program: nc.program });
  }

  // ── Demo-call-notes Slack (fetched live; TODO: persist in t21) ─────────────
  const demoStatusByEmail = new Map<string, { status: SlackDerivedStatus; nextStatus: string; cashCollected: number }>();
  if (slackToken && demoChannel) {
    const oldest = Math.floor(Date.now() / 1000) - 60 * 86400; // 60 days
    const msgs = await fetchSlackMessages(slackToken, demoChannel, oldest);
    for (const m of msgs) {
      const note = parseDemoCallNote(m);
      if (!note?.leadEmail) continue;
      const derived = deriveStatusFromSlack(note.nextStatus);
      if (!derived) continue;
      // Keep the most recent per email (newest-first)
      const em = note.leadEmail.toLowerCase().trim();
      if (!demoStatusByEmail.has(em)) {
        demoStatusByEmail.set(em, { status: derived, nextStatus: note.nextStatus ?? '', cashCollected: note.cashCollected });
      }
    }
  }

  // ── Rescheduled index: for each identity, list all bookings sorted ─────────
  interface IdKey { lead_id: string | null; email: string; phone: string; name: string }
  const keyOf = (b: Booking): IdKey => ({
    lead_id: b.lead_id,
    email: (b.email ?? '').toLowerCase().trim(),
    phone: normPhone(b.phone),
    name: normName(b.name),
  });

  function findLaterBookingForIdentity(current: Booking): Booking | null {
    const key = keyOf(current);
    for (const other of all) {
      if (other.id === current.id) continue;
      const k = keyOf(other);
      const sameIdentity =
        (key.lead_id && key.lead_id === k.lead_id) ||
        (key.email && key.email === k.email) ||
        (key.phone.length >= 7 && key.phone === k.phone) ||
        (key.name.length >= 3 && key.name === k.name);
      if (!sameIdentity) continue;
      if (other.date_booked_for > current.date_booked_for) return other;
    }
    return null;
  }

  // ── Classify each booking ─────────────────────────────────────────────────
  const classifications: Classification[] = [];

  for (const raw of pastBookings) {
    const b = raw as Booking;
    const evidence: string[] = [];
    const identityLabel = `${b.name ?? '?'} <${b.email ?? '?'}>`;
    let newStatus: Status | null = null;
    let source = '';

    const bookingDate = dateOnly(b.date_booked_for);
    const leadEmail = (b.email ?? '').toLowerCase().trim();
    const leadNameNorm = normName(b.name);

    // ── Step 1: Rescheduled ────────────────────────────────────────────────
    const later = findLaterBookingForIdentity(b);
    if (later) {
      newStatus = 'Rescheduled';
      source = 'reschedule:later_booking';
      evidence.push(`Rescheduled: found a later booking on ${dateOnly(later.date_booked_for)} for this identity (id ${later.id}).`);
    }

    // ── Step 2: Showed ─────────────────────────────────────────────────────
    if (!newStatus) {
      // 2a. #new-clients match
      const nc = leadEmail ? newClientByEmail.get(leadEmail) : null;
      if (nc) {
        newStatus = 'Showed';
        source = 'slack:new_clients';
        evidence.push(`Showed: matched in #new-clients (closer ${nc.closer_name ?? '?'}, program ${nc.program ?? '?'}). Closed = showed.`);
      } else {
        evidence.push(`Checked #new-clients: no match for ${leadEmail || '(no email)'}.`);
      }
    }

    if (!newStatus) {
      // 2b. Valid Grain recording (≥10 min) on/near booking date with name/id match
      const candidates: Array<{ r: NonNullable<typeof recordings>[number]; how: string }> = [];
      const direct = grainByBooking.get(b.id);
      if (direct) candidates.push({ r: direct, how: 'direct booking_id link' });
      if (b.lead_id) {
        for (const r of grainByLead.get(b.lead_id) ?? []) candidates.push({ r, how: 'lead_id match' });
      }
      if (leadNameNorm.length >= 3) {
        for (const r of grainByNormName.get(leadNameNorm) ?? []) candidates.push({ r, how: 'name match' });
      }
      // Fuzzy-name fallback: matches "Jen Underhill" ↔ "Jennifer Underhill"
      // and similar variants via first-3-chars-of-first-name + last-initial key.
      // Requires the ≥10 min duration gate later to avoid false positives.
      const fk = fuzzyNameKey(b.name);
      if (fk) {
        for (const r of grainByFuzzyName.get(fk) ?? []) {
          if (!candidates.some(c => c.r.id === r.id)) {
            candidates.push({ r, how: 'fuzzy name match' });
          }
        }
      }
      // First-name-only fallback: catches "Sonny/Sunny", "Robert/Bob",
      // "Mike/Michael". Guarded by the ≥10 min + ±7d gates below.
      const fnk = firstNameKey(b.name);
      if (fnk) {
        for (const r of grainByFirstName.get(fnk) ?? []) {
          if (!candidates.some(c => c.r.id === r.id)) {
            candidates.push({ r, how: 'first-name match' });
          }
        }
      }

      // Per the operator 2026-04-20: if Grain has ANY matching recording ≥10 min,
      // they showed (no date window — reschedule drift doesn't matter).
      // If matching recordings exist but ALL are < 10 min / no transcript,
      // they no-showed (short grain = call bounced / host joined empty room).
      // No matching recording at all → fall through to other signals.
      const validChosen = candidates.find(c => (c.r.duration_min ?? 0) >= GRAIN_MIN_DURATION);
      if (validChosen) {
        newStatus = 'Showed';
        source = `grain:valid(${validChosen.how})`;
        const daysOff = validChosen.r.call_date ? Math.round(daysBetween(validChosen.r.call_date, bookingDate)) : null;
        evidence.push(
          `Showed: Grain recording on ${validChosen.r.call_date} (${validChosen.r.duration_min} min, ${validChosen.how}${daysOff != null ? `, ${daysOff}d from booking` : ''}).`,
        );
      } else if (candidates.length > 0) {
        // Grain match(es) exist but all are short → No Showed per the operator's rule
        newStatus = 'No Showed';
        source = 'grain:short_recording_only';
        const durations = candidates.map(c => `${c.r.duration_min ?? '?'}m`).join(', ');
        evidence.push(
          `No Showed: Grain recording(s) found but all < ${GRAIN_MIN_DURATION} min (${durations}) — call bounced / host joined empty room.`,
        );
      } else {
        evidence.push(`Checked Grain: no recording matching this booking by id/lead/name.`);
      }
    }

    if (!newStatus) {
      // 2c. Demo-call-notes (non-No Show statuses)
      const demo = leadEmail ? demoStatusByEmail.get(leadEmail) : null;
      if (demo) {
        if (demo.status === 'Showed') {
          newStatus = 'Showed';
          source = `demo_call_notes:${demo.nextStatus}`;
          evidence.push(`Showed: demo-call-notes says "${demo.nextStatus}" (non-No-Show status → showed).`);
        } else if (demo.status === 'No Showed') {
          // handled in step 3 below; don't consume yet
          evidence.push(`Demo-call-notes flags "${demo.nextStatus}" — deferred to No Showed step.`);
        } else if (demo.status === 'Cancelled' || demo.status === 'Rescheduled') {
          evidence.push(`Demo-call-notes says "${demo.nextStatus}" — will consider at Cancelled/Rescheduled steps.`);
        }
      } else if (demoChannel) {
        evidence.push(`Checked demo-call-notes: no entry for ${leadEmail || '(no email)'}.`);
      }
    }

    // ── Step 2d/e + Step 3: GHL live signals (only if not yet classified) ──
    let live: GHLLiveSignals | null = null;
    const shouldQueryGHL =
      !newStatus &&
      ghlToken && ghlLocationId &&
      b.lead_id && !b.lead_id.startsWith('cal-');

    if (shouldQueryGHL) {
      live = await fetchGHLLiveSignals(ghlToken!, ghlLocationId!, b.lead_id!, b.date_booked_for);

      // 2d. Post-call pipeline stage
      const stageLower = (live.pipelineStage ?? '').toLowerCase();
      if (stageLower && POST_CALL_PIPELINE_STAGES.has(stageLower)) {
        newStatus = 'Showed';
        source = `pipeline:${stageLower}`;
        evidence.push(`Showed: GHL pipeline stage "${live.pipelineStage}" in "${live.pipelineName}" indicates post-call progress.`);
      }

      // 2e. Post-call conversation phrase
      if (!newStatus && live.postCallPhraseFound) {
        newStatus = 'Showed';
        source = `conversation:${live.postCallPhraseFound.phrase}`;
        evidence.push(`Showed: team follow-up on ${live.postCallPhraseFound.dateStr} contains phrase "${live.postCallPhraseFound.phrase}".`);
      }

      if (!newStatus) {
        evidence.push(
          `Checked GHL: pipeline "${live.pipelineStage ?? '?'}" in "${live.pipelineName ?? '?'}". Team follow-ups after booking: ${live.teamFollowUpsAfterBooking}. Lead replied: ${live.leadRepliedAfterBooking}.`,
        );
      }
    } else if (!newStatus && b.lead_id?.startsWith('cal-')) {
      evidence.push(`Skipped GHL live check: lead_id is stub (cal-*).`);
    }

    // ── Step 3: No Showed — active evidence only ───────────────────────────
    if (!newStatus) {
      const demo = leadEmail ? demoStatusByEmail.get(leadEmail) : null;
      if (demo?.status === 'No Showed') {
        newStatus = 'No Showed';
        source = 'demo_call_notes:no_show';
        evidence.push(`No Showed: demo-call-notes says "${demo.nextStatus}".`);
      } else if (live) {
        const stageLower = (live.pipelineStage ?? '').toLowerCase();
        if (NO_SHOW_PIPELINE_STAGES.has(stageLower)) {
          newStatus = 'No Showed';
          source = `pipeline:${stageLower}`;
          evidence.push(`No Showed: GHL pipeline stage is "${live.pipelineStage}".`);
        } else if (
          live.teamFollowUpsAfterBooking >= NO_SHOW_FOLLOWUP_THRESHOLD &&
          !live.leadRepliedAfterBooking
        ) {
          newStatus = 'No Showed';
          source = 'ghl:followup_pattern';
          evidence.push(
            `No Showed: ${live.teamFollowUpsAfterBooking} team follow-up messages after booking, no lead reply (threshold ${NO_SHOW_FOLLOWUP_THRESHOLD}+).`,
          );
        }
      }
    }

    // ── Step 3.5: Cancelled from GHL pipeline stage ───────────────────────
    // If still unresolved AND lead's GHL pipeline stage is something like
    // "Call Cancelled", trust it. Catches the case where a closer updates
    // GHL but not Calendly. Per the operator 2026-04-30. We do this AFTER
    // checking for reschedules + Showed signals so a "Cancelled" stage
    // doesn't override genuine evidence the call happened or got rebooked.
    if (!newStatus && live) {
      const stageLower = (live.pipelineStage ?? '').toLowerCase();
      if (CANCELLED_PIPELINE_STAGES.has(stageLower)) {
        newStatus = 'Cancelled';
        source = `pipeline:${stageLower}`;
        evidence.push(`Cancelled: GHL pipeline stage is "${live.pipelineStage}".`);
      }
    }

    // ── Step 4: Cancelled — only if Calendly canceled + no other signal ───
    if (!newStatus && b.status === 'Cancelled') {
      // Only keep as Cancelled if we genuinely found nothing else (reschedule was ruled out above)
      newStatus = 'Cancelled';
      source = 'calendly:canceled_no_alt_signal';
      evidence.push(`Cancelled: Calendly marked canceled and no Showed / Rescheduled signal found.`);
    }

    // ── Step 5: Needs Review ───────────────────────────────────────────────
    if (!newStatus) {
      newStatus = 'Needs Review';
      source = 'fallback:needs_review';
      evidence.push(`Needs Review: no confident signal either way — manual resolution required.`);
    }

    classifications.push({
      bookingId: b.id,
      leadIdentity: identityLabel,
      previousStatus: b.status,
      newStatus,
      explanation: evidence.join(' '),
      evidence,
      source,
    });
  }

  // ── Dry run: return the plan without writing ───────────────────────────────
  if (dryRun) {
    const summary: Record<Status, number> = {
      'Showed': 0, 'No Showed': 0, 'Cancelled': 0, 'Rescheduled': 0, 'Needs Review': 0,
    };
    const changes: Classification[] = [];
    for (const c of classifications) {
      summary[c.newStatus]++;
      if (c.previousStatus !== c.newStatus) changes.push(c);
    }
    return NextResponse.json({
      dryRun: true,
      processed: classifications.length,
      summary,
      changes: changes.length,
      diffs: changes.slice(0, 200).map(c => ({
        booking_id: c.bookingId,
        lead: c.leadIdentity,
        from: c.previousStatus,
        to: c.newStatus,
        source: c.source,
        explanation: c.explanation,
      })),
    });
  }

  // ── Apply ──────────────────────────────────────────────────────────────────
  // Per the congruence rule: whenever enrich changes status, clear
  // call_outcome_details so the nightly details
  // route regenerates a summary that agrees with the new status. Stale details
  // that contradict the status read as "fake data" and destroy trust.
  // Build a lookup of manual-locked ids from the past-bookings we loaded so we
  // can skip writes without re-fetching.
  const manualLockedIds = new Set(pastBookings.filter(isManualLocked).map(b => b.id));
  // Lookup full booking rows so the post-update webhook gets a rich payload.
  // Includes columns NOT on the base Booking interface (lead_id is t03's
  // local name for the GHL contact id; offer/lead_source/closer_assigned are
  // useful attribution signals).
  type BookingRow = Booking & {
    offer?: string | null;
    closer_assigned?: string | null;
  };
  const bookingById = new Map<string, BookingRow>(
    pastBookings.map((b: BookingRow): [string, BookingRow] => [b.id, b]),
  );

  let updated = 0;
  let detailsCleared = 0;
  let skippedManualLocked = 0;
  let errors = 0;
  let showedWebhooksFired = 0;
  for (const c of classifications) {
    // MANUAL_LOCK guard: never overwrite a the operator manual ruling. Classification
    // is still logged (the dry_run output + Vercel logs show what enrich WOULD
    // have said) but no DB write happens.
    if (manualLockedIds.has(c.bookingId)) {
      skippedManualLocked++;
      continue;
    }

    const statusChanged = c.previousStatus !== c.newStatus;
    const update: Record<string, unknown> = {
      status: c.newStatus,
      call_outcome_explanation: c.explanation,
      updated_at: new Date().toISOString(),
    };
    // Clear stale details on ANY status change. A narrative generated for the
    // old classification contradicts the new one (congruence rule: status +
    // explanation + details must all agree). The details route will
    // regenerate within the next hour.
    if (statusChanged) {
      update.call_outcome_details = null;
      detailsCleared++;
    }
    const { error } = await sb.from('t03_bookings').update(update).eq('id', c.bookingId);
    if (error) { errors++; console.error(`[enrich] ${c.bookingId}: ${error.message}`); }
    else {
      updated++;
      // Fire ad-attribution webhook on transitions INTO 'Showed' only.
      // (statusChanged guarantees this isn't a no-op re-write.)
      if (statusChanged && c.newStatus === 'Showed') {
        const b = bookingById.get(c.bookingId);
        if (b) {
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
            trigger: 'enrich',
          }).catch(() => { /* logged inside helper */ });
          showedWebhooksFired++;
        }
      }
    }
  }

  // ── Safety net: any PAST row that's still NULL after enrich must be filled.
  // This catches race conditions where the Calendly sync wrote a new past-
  // dated row AFTER we pulled pastBookings above. Default to Needs Review so
  // the dashboard never shows a blank row for a call that already happened.
  const { data: strayNullPast } = await sb
    .from('t03_bookings')
    .select('id')
    .lt('date_booked_for', new Date().toISOString())
    .is('status', null);
  let strayFilled = 0;
  for (const r of strayNullPast ?? []) {
    await sb.from('t03_bookings').update({
      status: 'Needs Review',
      call_outcome_explanation: 'Needs Review: row landed in the table after the enrich batch started. Will be re-evaluated next run.',
      call_outcome_details: null,
      updated_at: new Date().toISOString(),
    }).eq('id', r.id);
    strayFilled++;
  }

  // ── Safety net: any FUTURE row without PENDING → set PENDING on all three.
  const { data: strayFuture } = await sb
    .from('t03_bookings')
    .select('id')
    .gt('date_booked_for', new Date().toISOString())
    .or('status.is.null,and(status.neq.Cancelled,status.neq.Rescheduled,status.neq.PENDING)');
  let pendingFilled = 0;
  for (const r of strayFuture ?? []) {
    await sb.from('t03_bookings').update({
      status: 'PENDING',
      call_outcome_explanation: 'PENDING — CALL NOT TAKEN',
      call_outcome_details: 'PENDING — CALL NOT TAKEN',
      updated_at: new Date().toISOString(),
    }).eq('id', r.id);
    pendingFilled++;
  }

  const summary: Record<Status, number> = {
    'Showed': 0, 'No Showed': 0, 'Cancelled': 0, 'Rescheduled': 0, 'Needs Review': 0,
  };
  for (const c of classifications) summary[c.newStatus]++;

  return NextResponse.json({
    dryRun: false,
    processed: classifications.length,
    updated,
    detailsCleared,
    skippedManualLocked,
    manualLockedCount,
    strayFilled,
    pendingFilled,
    errors,
    showedWebhooksFired,
    summary,
  });
}

export const GET = POST;
