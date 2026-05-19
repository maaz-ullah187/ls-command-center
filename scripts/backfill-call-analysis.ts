#!/usr/bin/env npx tsx
// Backfill call analysis for all unanalyzed recordings in t04_call_recordings
// Usage: npx tsx scripts/backfill-call-analysis.ts
//
// Requires: GRAIN_API_KEY, ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GRAIN_TOKEN = process.env.GRAIN_API_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY || !GRAIN_TOKEN || !ANTHROPIC_KEY) {
  console.error('Missing required env vars. Check .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

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

## Scoring scale
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

async function fetchTranscript(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${GRAIN_TOKEN}` },
    });
    if (!res.ok) {
      console.error(`  Transcript fetch failed: HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error(`  Transcript fetch error:`, err);
    return null;
  }
}

async function analyzeCall(rec: {
  id: string;
  call_title: string;
  call_date: string;
  duration_min: number;
  closer_email: string;
  prospect_name: string | null;
  transcript_txt_url: string;
  ghl_contact_id: string | null;
  booking_id: string | null;
}): Promise<{ score: number } | null> {
  // Fetch transcript
  const transcript = await fetchTranscript(rec.transcript_txt_url);
  if (!transcript || transcript.length < 100) {
    console.log(`  Skipping — no/short transcript (${transcript?.length ?? 0} chars)`);
    return null;
  }

  // Truncate to 50k chars
  const maxLen = 50_000;
  const truncated = transcript.length > maxLen
    ? transcript.slice(0, maxLen) + '\n\n[...transcript truncated]'
    : transcript;

  const userMsg = [
    `## Call: ${rec.call_title}`,
    `Date: ${rec.call_date}`,
    `Duration: ${rec.duration_min} minutes`,
    `Closer: ${rec.closer_email}`,
    rec.prospect_name ? `Prospect: ${rec.prospect_name}` : '',
    `\n## Full Transcript\n${truncated}`,
  ].filter(Boolean).join('\n');

  const response = await anthropic.messages.create({
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

  // Write to t04_call_recordings
  const { error: updateErr } = await supabase
    .from('t04_call_recordings')
    .update({
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
    })
    .eq('id', rec.id);

  if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);

  // Also update t10_lead_scores if linked
  if (rec.ghl_contact_id && !rec.ghl_contact_id.startsWith('cal-')) {
    await supabase
      .from('t10_lead_scores')
      .upsert({
        lead_id: rec.ghl_contact_id,
        qual_score: analysis.qual_score,
        combined_score: analysis.qual_score,
        qual_summary: analysis.qual_summary,
        qual_red_flags: analysis.red_flags,
        qual_green_flags: analysis.green_flags,
        scored_at: new Date().toISOString(),
        scored_model: 'claude-sonnet-4-20250514',
      }, { onConflict: 'lead_id' });
  }

  return { score: analysis.qual_score };
}

async function main() {
  console.log('=== Call Analysis Backfill ===\n');

  // Fetch all unanalyzed recordings
  const { data: recordings, error } = await supabase
    .from('t04_call_recordings')
    .select('id, call_title, call_date, duration_min, closer_email, prospect_name, transcript_txt_url, ghl_contact_id, booking_id')
    .is('qual_score', null)
    .not('transcript_txt_url', 'is', null)
    .gte('duration_min', 5)
    .order('call_date', { ascending: false });

  if (error) {
    console.error('Failed to fetch recordings:', error.message);
    process.exit(1);
  }

  console.log(`Found ${recordings.length} recordings to analyze\n`);

  let analyzed = 0;
  let errors = 0;
  let skipped = 0;

  for (let i = 0; i < recordings.length; i++) {
    const rec = recordings[i];
    const progress = `[${i + 1}/${recordings.length}]`;
    console.log(`${progress} ${rec.prospect_name || rec.call_title} (${rec.duration_min}min, ${rec.call_date})`);

    try {
      const result = await analyzeCall(rec);
      if (result) {
        console.log(`  ✓ Score: ${result.score}/10`);
        analyzed++;
      } else {
        skipped++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Error: ${msg}`);
      errors++;
    }

    // Small delay between API calls to avoid rate limiting
    if (i < recordings.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Analyzed: ${analyzed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
}

main().catch(console.error);
