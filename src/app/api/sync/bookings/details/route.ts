// Booking detail generator — AI-powered call_outcome_details
//
// For each booking without details, gathers:
//   1. All bookings for the same contact (chronological history)
//   2. GHL contact: tags, notes, pipeline stage, custom fields
//   3. GHL conversation history (SMS/email/calls — full thread)
//   4. Grain call recordings for this contact
// Then uses Claude to synthesize a specific, evidence-based summary.
//
// Schedule: run after /api/sync/bookings/enrich completes

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { fetchGHLConversations } from '@/lib/mappers/ghl';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 300;

const GHL_V2 = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// ── GHL data fetching ────────────────────────────────────────────────────────

interface GHLContactDetail {
  tags: string[];
  dateAdded: string | null;
  notes: Array<{ body: string; dateAdded: string }>;
  assignedTo: string | null;
  pipelineStage: string | null;
  pipelineName: string | null;
  source: string | null;
  customFields: Array<{ id: string; value: string }>;
}

async function fetchGHLContact(
  token: string,
  contactId: string,
): Promise<GHLContactDetail | null> {
  try {
    const res = await fetch(`${GHL_V2}/contacts/${contactId}`, {
      headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const contact = data.contact;
    if (!contact) return null;

    return {
      tags: contact.tags ?? [],
      dateAdded: contact.dateAdded ?? null,
      notes: (contact.notes ?? []).map((n: any) => ({
        body: n.body ?? '',
        dateAdded: n.dateAdded ?? '',
      })).filter((n: any) => n.body),
      assignedTo: contact.assignedTo ?? null,
      pipelineStage: null, // filled by opportunity fetch below
      pipelineName: null,
      source: contact.source ?? null,
      customFields: (contact.customFields ?? [])
        .filter((f: any) => f.value != null && f.value !== '')
        .map((f: any) => ({ id: f.id, value: String(f.value) })),
    };
  } catch {
    return null;
  }
}

/** Search GHL by email when we only have a stub lead_id. Returns the real GHL contact ID. */
async function searchGHLContactByEmail(
  token: string,
  locationId: string,
  email: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${GHL_V2}/contacts/?locationId=${locationId}&query=${encodeURIComponent(email)}&limit=1`,
      { headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const contacts = data.contacts ?? [];
    if (contacts.length === 0) return null;
    // Verify email match (GHL search is fuzzy)
    const found = contacts.find(
      (c: any) => (c.email ?? '').toLowerCase() === email.toLowerCase(),
    );
    return found?.id ?? null;
  } catch {
    return null;
  }
}

/** Fetch the contact's pipeline stage from GHL opportunities. */
async function fetchGHLPipelineStage(
  token: string,
  locationId: string,
  contactId: string,
): Promise<{ stageName: string; pipelineName: string } | null> {
  try {
    const res = await fetch(
      `${GHL_V2}/opportunities/search?location_id=${locationId}&contact_id=${contactId}&limit=5`,
      { headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const opps = data.opportunities ?? [];
    if (opps.length === 0) return null;

    // Get the most recent opportunity
    const opp = opps[0];
    const stageName = opp.pipelineStageId ?? opp.stageName ?? null;
    const pipelineName = opp.pipelineName ?? opp.pipeline?.name ?? null;

    // Try to resolve stage name from pipeline stages
    if (opp.pipelineId) {
      try {
        const pipeRes = await fetch(
          `${GHL_V2}/opportunities/pipelines/${opp.pipelineId}`,
          { headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION } },
        );
        if (pipeRes.ok) {
          const pipeData = await pipeRes.json();
          const stages = pipeData.pipeline?.stages ?? pipeData.stages ?? [];
          const stage = stages.find((s: any) => s.id === opp.pipelineStageId);
          if (stage) {
            return {
              stageName: stage.name,
              pipelineName: pipeData.pipeline?.name ?? pipelineName ?? 'Unknown pipeline',
            };
          }
        }
      } catch { /* fall through */ }
    }

    return stageName ? { stageName, pipelineName: pipelineName ?? 'Unknown pipeline' } : null;
  } catch {
    return null;
  }
}

// ── Prompt ────────────────────────────────────────────────────────────────────

interface BookingContext {
  bookings: Array<{
    date: string;
    calendar: string | null;
    status: string | null;
  }>;
  ghlTags: string[];
  ghlDateAdded: string | null;
  ghlNotes: Array<{ body: string; dateAdded: string }>;
  ghlPipelineStage: string | null;
  ghlPipelineName: string | null;
  ghlSource: string | null;
  conversations: Array<{
    direction: string;
    body: string;
    timestamp: string;
    type: string;
  }>;
  grainRecordings: Array<{
    callDate: string | null;
    callTitle: string;
    durationMin: number | null;
    prospectName: string | null;
    closerEmail: string | null;
  }>;
}

function buildPrompt(name: string, email: string, ctx: BookingContext): string {
  let prompt = `You are analyzing a sales lead's full journey to write a specific, evidence-based summary for a dashboard.

These are DIRECT sales calls (Discovery Call, Agency Scaling Call, Agency Launch Call). NOT a two-step intro/demo process — never say "Intro" or "Demo" unless you see genuinely different call types booked.

Your job is to explain WHAT HAPPENED and WHY — not just list statuses. Read the GHL conversations, notes, tags, and pipeline stage to understand the real story.

Examples of GOOD specific summaries:
"4/8: SHOWED. 53-min call with the closer. Interested but said $4k is too much. Tagged p5 - cold."
"4/3: CANCELLED. Setter called 3x, texted 5x, no response. Not financially qualified."
"Returning lead (since 7/2024). 4/8: SHOWED. Converted. Pipeline: Closed Won."
"4/14: SHOWED. Setter moved to WhatsApp, had call, moved to Not Financially Qualified pipeline stage."
"4/9: CANCELLED. Lead replied 'no longer interested' to confirmation text. Pipeline stalled."
"4/7: NO SHOW. Team called 5x over 2 days, sent 4 texts. No response."
"NOT FOUND in GHL."

Examples of BAD generic summaries (don't do this):
"Call 4/8: CANCELLED. No response to outreach." ← too vague, what outreach?
"4/14: SHOWED. Tagged p5. No demo." ← why p5? what happened on the call?

Rules:
- 1-3 sentences max. Be specific, not generic.
- Date format: M/D (e.g., 4/8).
- Status markers: SHOWED, CANCELLED, CONFIRMED, NO SHOW.
- READ the conversation messages — they reveal WHY things happened. Include specific details like "lead said X", "setter moved to WhatsApp", "replied 'not interested'".
- Include the pipeline stage if it explains the outcome (e.g., "Moved to Not Financially Qualified").
- If there are notes from team members (closers, setters), reference what they said.
- Count outreach attempts if lead ghosted: "Called 3x, texted 5x, no response."
- If they rebooked after cancelling, show the full chain: "4/3: CANCELLED. Rebooked 4/8: SHOWED."
- Mention relevant tags but explain WHY they got that tag if you can tell from context.
- Don't include lead name or email.

Lead: ${name} (${email})

`;

  // GHL history
  if (ctx.ghlDateAdded) {
    const added = new Date(ctx.ghlDateAdded);
    const monthsAgo = Math.floor((Date.now() - added.getTime()) / (30 * 86400000));
    if (monthsAgo > 1) {
      const dateStr = `${added.getMonth() + 1}/${added.getFullYear()}`;
      prompt += `GHL contact created: ${dateStr} (${monthsAgo} months ago — returning lead)\n`;
    }
  }

  if (ctx.ghlSource) {
    prompt += `GHL source: ${ctx.ghlSource}\n`;
  }

  if (ctx.ghlPipelineStage) {
    prompt += `Current pipeline stage: "${ctx.ghlPipelineStage}" in "${ctx.ghlPipelineName}"\n`;
  }

  if (ctx.ghlTags.length > 0) {
    prompt += `GHL tags: ${ctx.ghlTags.join(', ')}\n`;
  }

  if (ctx.ghlNotes.length > 0) {
    prompt += `\nGHL notes (from team members):\n`;
    for (const n of ctx.ghlNotes.slice(0, 8)) {
      const d = n.dateAdded ? new Date(n.dateAdded) : null;
      const dateStr = d ? `${d.getMonth() + 1}/${d.getDate()}` : '?';
      prompt += `  [${dateStr}] ${n.body.slice(0, 500)}\n`;
    }
  }

  // Bookings
  prompt += `\nBooking history:\n`;
  for (const b of ctx.bookings) {
    const d = new Date(b.date);
    const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
    prompt += `  - ${dateStr}: "${b.calendar || 'Unknown calendar'}" — status: ${b.status || 'pending'}\n`;
  }

  // Grain recordings
  if (ctx.grainRecordings.length > 0) {
    prompt += `\nGrain call recordings:\n`;
    for (const r of ctx.grainRecordings) {
      const d = r.callDate ? new Date(r.callDate) : null;
      const dateStr = d ? `${d.getMonth() + 1}/${d.getDate()}` : '?';
      const closer = r.closerEmail ? r.closerEmail.split('@')[0].replace(/[._]/g, ' ') : '';
      prompt += `  - ${dateStr}: "${r.callTitle}" (${r.durationMin ?? '?'} min${closer ? `, ${closer}` : ''})\n`;
    }
  } else {
    prompt += `\nNo Grain call recordings found.\n`;
  }

  // Full conversation thread (up to 40 messages for more context)
  if (ctx.conversations.length > 0) {
    const msgs = ctx.conversations.slice(-40);
    prompt += `\nGHL conversation thread (${msgs.length} messages — read carefully for context):\n`;
    for (const m of msgs) {
      const d = m.timestamp ? new Date(m.timestamp) : null;
      const dateStr = d ? `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : '?';
      const dir = m.direction === 'inbound' ? '← LEAD' : '→ TEAM';
      prompt += `  [${dateStr}] ${dir} (${m.type}): ${m.body.slice(0, 400)}\n`;
    }
  } else {
    prompt += `\nNo GHL conversation history found.\n`;
  }

  prompt += `\nWrite the summary now. Output ONLY the summary text, nothing else.`;
  return prompt;
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const max = Number(searchParams.get('max')) || 20;

  const supabase = await getServerSupabaseAsync();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  const ghlToken = process.env.GHL_API_KEY;
  const ghlLocationId = process.env.GHL_LOCATION_ID;

  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // Fetch bookings that need details
  const { data: bookings, error: bookingsErr } = await supabase
    .from('t03_bookings')
    .select('id, name, email, lead_id, date_booked_for, calendar, status')
    .is('call_outcome_details', null)
    .not('status', 'is', null)
    .order('date_booked_for', { ascending: false })
    .limit(max);

  if (bookingsErr) {
    return NextResponse.json({ error: bookingsErr.message }, { status: 500 });
  }

  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ message: 'No bookings need details', generated: 0 });
  }

  console.log(`[details] generating details for ${bookings.length} bookings`);

  // Group by email
  const byEmail = new Map<string, typeof bookings>();
  for (const b of bookings) {
    const email = (b.email ?? '').toLowerCase();
    if (!email) continue;
    const list = byEmail.get(email) ?? [];
    list.push(b);
    byEmail.set(email, list);
  }

  // Pre-fetch all bookings for these emails
  const allEmails = [...byEmail.keys()];
  const { data: allBookingsForEmails } = await supabase
    .from('t03_bookings')
    .select('id, name, email, date_booked_for, calendar, status')
    .in('email', allEmails)
    .order('date_booked_for', { ascending: true });

  const bookingsByEmail = new Map<string, typeof bookings>();
  for (const b of allBookingsForEmails ?? []) {
    const email = (b.email ?? '').toLowerCase();
    const list = bookingsByEmail.get(email) ?? [];
    list.push(b);
    bookingsByEmail.set(email, list);
  }

  // Pre-fetch Grain recordings
  const leadIds = [...new Set(bookings.map(b => b.lead_id).filter(Boolean))];
  const { data: grainRecordings } = await supabase
    .from('t04_call_recordings')
    .select('call_date, call_title, duration_min, prospect_name, ghl_contact_id, booking_id, closer_email')
    .or(leadIds.length > 0
      ? `ghl_contact_id.in.(${leadIds.join(',')}),booking_id.in.(${bookings.map(b => b.id).join(',')})`
      : `booking_id.in.(${bookings.map(b => b.id).join(',')})`
    );

  const grainByLeadId = new Map<string, typeof grainRecordings>();
  for (const r of grainRecordings ?? []) {
    if (r.ghl_contact_id) {
      const list = grainByLeadId.get(r.ghl_contact_id) ?? [];
      list.push(r);
      grainByLeadId.set(r.ghl_contact_id, list);
    }
  }

  let generated = 0;
  let errors = 0;

  for (const [email, emailBookings] of byEmail) {
    const firstBooking = emailBookings[0];
    const leadId = firstBooking.lead_id;

    // Gather context from GHL
    let ghlContact: GHLContactDetail | null = null;
    let conversations: Awaited<ReturnType<typeof fetchGHLConversations>> = [];
    let pipelineInfo: { stageName: string; pipelineName: string } | null = null;

    // Resolve real GHL contact ID — search by email if lead_id is a stub
    let resolvedLeadId = leadId;
    if (ghlToken && ghlLocationId) {
      if (!leadId || leadId.startsWith('cal-')) {
        // Stub lead_id — search GHL by email to find the real contact
        const realId = await searchGHLContactByEmail(ghlToken, ghlLocationId, email);
        if (realId) {
          resolvedLeadId = realId;
          // Also fix the stub in the database so future runs don't need to re-search
          await supabase
            .from('t03_bookings')
            .update({ lead_id: realId })
            .eq('email', email)
            .like('lead_id', 'cal-%');
          console.log(`[details] resolved stub lead_id for ${email} → ${realId}`);
        }
      }

      if (resolvedLeadId && !resolvedLeadId.startsWith('cal-')) {
        const [contact, convos, pipeline] = await Promise.all([
          fetchGHLContact(ghlToken, resolvedLeadId),
          fetchGHLConversations(ghlToken, ghlLocationId, resolvedLeadId, 50),
          fetchGHLPipelineStage(ghlToken, ghlLocationId, resolvedLeadId),
        ]);
        ghlContact = contact;
        conversations = convos;
        pipelineInfo = pipeline;
      }
    }

    const ctx: BookingContext = {
      bookings: (bookingsByEmail.get(email) ?? []).map(b => ({
        date: b.date_booked_for ?? '',
        calendar: b.calendar,
        status: b.status,
      })),
      ghlTags: ghlContact?.tags ?? [],
      ghlDateAdded: ghlContact?.dateAdded ?? null,
      ghlNotes: ghlContact?.notes ?? [],
      ghlPipelineStage: pipelineInfo?.stageName ?? null,
      ghlPipelineName: pipelineInfo?.pipelineName ?? null,
      ghlSource: ghlContact?.source ?? null,
      conversations: conversations.map(m => ({
        direction: m.direction,
        body: m.body,
        timestamp: m.timestamp,
        type: m.type,
      })),
      grainRecordings: (grainByLeadId.get(resolvedLeadId ?? '') ?? grainByLeadId.get(leadId ?? '') ?? []).map(r => ({
        callDate: r.call_date,
        callTitle: r.call_title ?? '',
        durationMin: r.duration_min,
        prospectName: r.prospect_name,
        closerEmail: r.closer_email,
      })),
    };

    try {
      const prompt = buildPrompt(firstBooking.name ?? 'Unknown', email, ctx);
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      });

      const summary = response.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('')
        .trim();

      if (summary) {
        for (const b of emailBookings) {
          const { error } = await supabase
            .from('t03_bookings')
            .update({ call_outcome_details: summary })
            .eq('id', b.id);

          if (error) {
            console.error(`[details] error updating ${b.id}: ${error.message}`);
            errors++;
          } else {
            generated++;
          }
        }
        console.log(`[details] ${email}: ${summary.slice(0, 120)}...`);
      }
    } catch (err: any) {
      console.error(`[details] Claude error for ${email}:`, err.message);
      errors++;
    }

    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[details] done. generated=${generated} errors=${errors}`);

  return NextResponse.json({
    total: bookings.length,
    uniqueLeads: byEmail.size,
    generated,
    errors,
  });
}

export const GET = POST;
