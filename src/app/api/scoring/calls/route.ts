// Call recording analysis pipeline
//
// Reads Grain transcripts for unanalyzed recordings in t04_call_recordings,
// sends each to Claude for deep analysis, and writes structured insights back.
//
// Extracts per recording:
//   - motivation_to_show: why the lead took action to book/show
//   - pain_points: bullet list with exact quotes
//   - desires_goals: bullet list with exact quotes
//   - pitch_summary: what was pitched (deliverables, price, offer)
//   - objections: specific objections with exact quotes
//   - buying_questions: questions asked on the call (for pre-call assets)
//   - ai_use_cases: specific AI implementations they wanted + why
//   - qual_score: 1-10 quality score + explanation
//   - qual_summary: explanation of the score
//   - why_didnt_close: if they didn't buy, why not
//
// Schedule: run after Grain sync (part of evening pipeline)

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { fireQualifiedShowedWebhook } from '@/lib/webhooks/external-webhooks';

export const maxDuration = 300;

const SYSTEM_PROMPT = `You are a senior sales analyst for a B2B AI agency that builds custom AI agents and automations for businesses. The agency sells three programs:
- **Program C** (DFY agency offer — $10-15K, done-for-you AI agent builds)
- **Program B** (ProgB — licensing/white-label model for agencies)
- **Program A** (ProgA — community/course for new agency owners)

Closers: Closer One, Closer Two.

You are analyzing a sales call transcript to extract deep, actionable intelligence. Your analysis serves three purposes:
1. **Sales asset creation** — what content/pre-call videos should we make to handle common objections and buying questions before the call?
2. **AI demo preparation** — what AI agents/demos should we build to show on future calls?
3. **Sales training** — what patterns help closers improve?

Return ONLY valid JSON — no markdown fences, no commentary outside the JSON.

## Response format

{
  "motivation_to_show": "<1-2 sentences on what motivated this person to book and show up. What pain or desire drove them to take action?>",
  "pain_points": "<Bullet list of their biggest pain points, each with an EXACT QUOTE from the transcript in quotation marks. Format: '- Pain point description: \\"exact quote from prospect\\"'. Include 3-5 bullets.>",
  "desires_goals": "<Bullet list of their desires/goals, each with an EXACT QUOTE. Format: '- Goal description: \\"exact quote\\". Include 3-5 bullets.>",
  "pitch_summary": "<What exactly was pitched: which offer/program, specific deliverables discussed, price point mentioned, payment structure if discussed. Be specific.>",
  "objections": ["<Specific objection with exact quote>", "..."],
  "buying_questions": ["<Question the prospect asked about the offer/service>", "..."],
  "ai_use_cases": "<Bullet list of specific AI implementations they wanted and why. Format: '- Use case: reason/context'. Include all mentioned.>",
  "qual_score": <number 1-10, one decimal>,
  "qual_summary": "<2-3 sentences explaining the score. Reference revenue, business maturity, call engagement, and financial readiness.>",
  "why_didnt_close": "<If they didn't buy on the call, explain why. If they DID close, say 'CLOSED on call' and note the deal terms. If unclear, say 'Outcome unclear from transcript'.>",
  "prospect_context": "<Full business rundown: what business/niche they're in, how long they've been operating, team size, current monthly revenue, what services they offer, who their clients are, what tools/systems they currently use. Paint the full picture of where this person is at.>",
  "red_flags": ["<concern or negative signal>", "..."],
  "green_flags": ["<positive signal>", "..."]
}

## Scoring scale (same as lead scoring)
- 1-3: Unqualified — can't afford it, no real pain, wrong fit
- 4-5: Some potential but major gaps
- 6: Borderline — in ICP but financially tight
- 7-8: Solid lead — good business, clear pain, can afford it
- 9-10: Home run — high revenue, obvious pain, financially ready

## Important
- Use EXACT QUOTES from the transcript wherever possible — this data is used for training
- If the transcript is too short or unclear for a field, say "Not discussed on call"
- For buying_questions, include even small clarifying questions — these reveal what prospects care about
- For objections, include both explicit objections AND implied hesitations`;

interface CallAnalysis {
  motivation_to_show: string;
  pain_points: string;
  desires_goals: string;
  pitch_summary: string;
  objections: string[];
  buying_questions: string[];
  ai_use_cases: string;
  qual_score: number;
  qual_summary: string;
  why_didnt_close: string;
  prospect_context: string;
  red_flags: string[];
  green_flags: string[];
}

function stripCodeFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

function parseAnalysis(raw: string): CallAnalysis {
  const cleaned = stripCodeFences(raw);
  const parsed = JSON.parse(cleaned);

  return {
    motivation_to_show: parsed.motivation_to_show ?? 'Not discussed on call',
    pain_points: parsed.pain_points ?? 'Not discussed on call',
    desires_goals: parsed.desires_goals ?? 'Not discussed on call',
    pitch_summary: parsed.pitch_summary ?? 'Not discussed on call',
    objections: Array.isArray(parsed.objections) ? parsed.objections.filter((o: unknown) => typeof o === 'string') : [],
    buying_questions: Array.isArray(parsed.buying_questions) ? parsed.buying_questions.filter((q: unknown) => typeof q === 'string') : [],
    ai_use_cases: parsed.ai_use_cases ?? 'Not discussed on call',
    qual_score: Math.round(Math.min(10, Math.max(0, parseFloat(parsed.qual_score) || 0)) * 10) / 10,
    qual_summary: parsed.qual_summary ?? '',
    why_didnt_close: parsed.why_didnt_close ?? 'Outcome unclear',
    prospect_context: parsed.prospect_context ?? 'Not discussed on call',
    red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags.filter((f: unknown) => typeof f === 'string') : [],
    green_flags: Array.isArray(parsed.green_flags) ? parsed.green_flags.filter((f: unknown) => typeof f === 'string') : [],
  };
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const max = Math.max(1, parseInt(searchParams.get('max') ?? '10', 10) || 10);

  const grainToken = process.env.GRAIN_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!grainToken) return NextResponse.json({ error: 'GRAIN_API_KEY not configured' }, { status: 500 });
  if (!anthropicKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });

  const supabase = await getServerSupabaseAsync();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const client = new Anthropic({ apiKey: anthropicKey });

  // Auto-fill short calls (< 5 min) that will never be sent to Claude.
  // the operator rule (2026-04-23): "if a call is less than 5 minutes, more than
  // likely they no-showed. No point trying to do a summary." So we hard-code
  // qual_score=0 and write explicit no-show messaging.
  const NA_FIELDS = {
    motivation_to_show: 'N/A', pain_points: 'N/A', desires_goals: 'N/A',
    pitch_summary: 'N/A', ai_use_cases: 'N/A', prospect_context: 'N/A',
    objections: [] as string[], buying_questions: [] as string[],
  };

  // No-shows (0-1 min) — prospect never joined
  await supabase.from('t04_call_recordings').update({
    qual_score: 0, qual_summary: 'No show — prospect did not join or call ended immediately.',
    why_didnt_close: 'N/A — no show', ...NA_FIELDS,
  }).is('qual_score', null).lte('duration_min', 1);

  // Likely no-show (2-4 min) — per the spec rule: <5min almost always = no-show
  await supabase.from('t04_call_recordings').update({
    qual_score: 0,
    qual_summary: 'Likely no-show — call under 5 minutes, prospect disconnected before pitch or never engaged.',
    why_didnt_close: 'N/A — likely no-show (sub-5min call)', ...NA_FIELDS,
  }).is('qual_score', null).lte('duration_min', 4).gte('duration_min', 2);

  // Find unanalyzed recordings with transcripts (5+ min → send to Claude)
  // qual_score IS NULL = not yet analyzed
  const { data: recordings, error: fetchErr } = await supabase
    .from('t04_call_recordings')
    .select('id, call_title, call_date, duration_min, closer_email, prospect_name, transcript_txt_url, ghl_contact_id, booking_id')
    .is('qual_score', null)
    .not('transcript_txt_url', 'is', null)
    .gte('duration_min', 5)
    .order('call_date', { ascending: false })
    .limit(max);

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!recordings || recordings.length === 0) {
    return NextResponse.json({ message: 'No unanalyzed recordings found', analyzed: 0 });
  }

  console.log(`[call-analysis] ${recordings.length} recordings to analyze`);

  let analyzed = 0;
  let errors = 0;
  const results: { id: string; title: string; score: number }[] = [];

  for (const rec of recordings) {
    try {
      // Fetch transcript text from Grain
      let transcript: string | null = null;
      if (rec.transcript_txt_url) {
        const res = await fetch(rec.transcript_txt_url, {
          headers: { Authorization: `Bearer ${grainToken}` },
        });
        if (res.ok) transcript = await res.text();
      }

      if (!transcript || transcript.length < 100) {
        console.log(`[call-analysis] skipping ${rec.id} — no/short transcript`);
        continue;
      }

      // the operator rule (2026-04-23): 5-10 min call + only ONE speaker in the
      // transcript = prospect didn't really engage / got disqualified early.
      // No point asking Claude to summarize — just flag it and move on.
      // Detection heuristic:
      //   Count distinct speaker prefixes across transcript lines. Grain
      //   transcripts use "Name (00:01): ..." or "Speaker 1 (00:01): ..."
      //   formats. If <2 distinct speakers appear, only one person talked.
      if (rec.duration_min != null && rec.duration_min >= 5 && rec.duration_min <= 10) {
        const speakerSet = new Set<string>();
        // Match "<speaker>: " at start of line (ignoring optional timestamps)
        const speakerLine = /^([A-Z][A-Za-z .'-]{1,40}?)(?:\s*\(\d[\d:]*\))?\s*:/gm;
        let m: RegExpExecArray | null;
        while ((m = speakerLine.exec(transcript)) !== null) {
          speakerSet.add(m[1].trim().toLowerCase());
          if (speakerSet.size >= 2) break; // early exit — we have enough
        }
        if (speakerSet.size < 2) {
          await supabase.from('t04_call_recordings').update({
            qual_score: 0,
            qual_summary: `Disqualified early — ${rec.duration_min}min call with only one speaker in transcript. Closer was talking solo; prospect either no-showed audio or was disqualified before meaningful pitch.`,
            why_didnt_close: 'Prospect did not engage — single-speaker transcript',
            ...NA_FIELDS,
          }).eq('id', rec.id);
          console.log(`[call-analysis] ${rec.id} → single-speaker auto-DQ (${rec.duration_min}min)`);
          continue;
        }
      }

      // Truncate transcript to fit context (keep first 50k chars)
      const maxLen = 50_000;
      const truncatedTranscript = transcript.length > maxLen
        ? transcript.slice(0, maxLen) + '\n\n[...transcript truncated]'
        : transcript;

      // Build user message with all available context
      const userMsg = [
        `## Call: ${rec.call_title}`,
        `Date: ${rec.call_date}`,
        `Duration: ${rec.duration_min} minutes`,
        `Closer: ${rec.closer_email}`,
        rec.prospect_name ? `Prospect: ${rec.prospect_name}` : '',
        `\n## Full Transcript\n${truncatedTranscript}`,
      ].filter(Boolean).join('\n');

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
      });

      const textBlock = response.content.find(b => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text content in Claude response');
      }

      const analysis = parseAnalysis(textBlock.text);

      // Derive offer from pitch_summary — the most authoritative signal for
      // "what offer was actually pitched on this call". Per the operator 2026-04-20:
      // if it mentions Program C → Program C, anything else about
      // agency-building (ProgB / ProgA) → ProgB. Only derive if we have a real pitch.
      let derivedOffer: string | null = null;
      const pitch = analysis.pitch_summary?.toLowerCase() ?? '';
      if (pitch && !/^(n\/a|no pitch|no specific|no coherent)/i.test(pitch)) {
        // Customize these patterns for your offers — match against the call's
        // pitch_summary so an Program A pitch gets attributed correctly even
        // when the booking source is ambiguous.
        if (/(program c|ai implementation|ai integration|ai[-\s]?roi|programc|ai agent.*build|dfy.*ai|custom ai agent)/.test(pitch)) {
          derivedOffer = 'Program C';
        } else if (/program b/.test(pitch)) {
          derivedOffer = 'ProgB';
        } else if (/program a/.test(pitch)) {
          derivedOffer = 'ProgA';
        }
      }

      // Write analysis back to t04_call_recordings
      const updatePayload: Record<string, unknown> = {
        motivation_to_show: analysis.motivation_to_show,
        pain_points: analysis.pain_points,
        desires_goals: analysis.desires_goals,
        pitch_summary: analysis.pitch_summary,
        objections: analysis.objections,
        buying_questions: analysis.buying_questions,
        ai_use_cases: analysis.ai_use_cases,
        qual_score: analysis.qual_score,
        qual_summary: analysis.qual_summary,
        why_didnt_close: analysis.why_didnt_close,
        prospect_context: analysis.prospect_context,
      };
      // pitch_summary is the most specific signal — overwrite offer when present.
      if (derivedOffer) updatePayload.offer = derivedOffer;

      const { error: updateErr } = await supabase
        .from('t04_call_recordings')
        .update(updatePayload)
        .eq('id', rec.id);

      if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);

      // NOTE (2026-04-23): Removed dual-write to t10_lead_scores — that table
      // was redundant with t04.qual_score and has been dropped. All call
      // quality scoring lives in t04_call_recordings from here forward.

      // Ad-attribution webhook: a call with qual_score > 5 is a qualified show.
      // Fires once per recording (this loop only picks rows where qual_score IS NULL).
      if (typeof analysis.qual_score === 'number' && analysis.qual_score > 5) {
        fireQualifiedShowedWebhook({
          recording_id: rec.id,
          qual_score: analysis.qual_score,
          qual_summary: analysis.qual_summary ?? null,
          call_title: rec.call_title ?? null,
          call_date: rec.call_date ?? null,
          duration_min: rec.duration_min ?? null,
          closer_email: rec.closer_email ?? null,
          prospect_name: rec.prospect_name ?? null,
          ghl_contact_id: rec.ghl_contact_id ?? null,
          booking_id: rec.booking_id ?? null,
        }).catch(() => { /* logged inside helper */ });
      }

      console.log(`[call-analysis] ${rec.prospect_name || rec.call_title}: score=${analysis.qual_score}`);
      results.push({ id: rec.id, title: rec.call_title, score: analysis.qual_score });
      analyzed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[call-analysis] error on ${rec.id}: ${msg}`);
      errors++;
    }
  }

  console.log(`[call-analysis] done. analyzed=${analyzed} errors=${errors}`);

  return NextResponse.json({
    total: recordings.length,
    analyzed,
    errors,
    results,
  });
}

export const GET = POST;
