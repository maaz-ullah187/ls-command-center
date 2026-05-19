/**
 * Scorer: why_they_bought
 *
 * For every row in t06_deals_closed that has a sales_call_recording (Grain URL)
 * but no why_they_bought, fetch the transcript and ask Claude to return:
 *   - 3-6 bullet points
 *   - Direct quotes from the prospect ("...")
 *   - WHY they bought + WHERE they came from (YouTube, referral, ad, etc.)
 *   - The closer's own attribution analysis in 1-2 closing lines
 *
 * Input: t06_deals_closed.sales_call_recording (Grain URL)
 *        ↓ extracts Grain recording ID from URL
 *        ↓ looks up t04_call_recordings by matching grain_url
 *        ↓ falls back to fetching the transcript live from Grain API if not in t04
 * Output: t06_deals_closed.why_they_bought (markdown) +
 *         t06_deals_closed.why_they_bought_generated_at (timestamp)
 *
 * Runs daily via Vercel Cron. Idempotent — only fills rows where
 * why_they_bought IS NULL OR generated_at < recording updated_at.
 */

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { runSync } from '@/lib/sync/runner';
import { cleanEnv, requireEnv } from '@/lib/env';

export const maxDuration = 300;

const MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_MAX_ROWS = 50;
const NA_MARKER = 'N/A — no transcript available for this recording.';

function extractGrainIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  // Grain URLs look like https://grain.com/app/share/recording/{id} or
  // https://grain.com/share/recording/{id}
  const m = url.match(/grain\.com\/(?:app\/)?(?:share\/)?recording\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

async function fetchGrainTranscript(recordingId: string, token: string): Promise<string | null> {
  try {
    // Try the public-api transcript endpoint
    const url = `https://api.grain.com/_/public-api/recordings/${recordingId}/transcript.txt`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim() || null;
  } catch {
    return null;
  }
}

interface DealRow {
  id: string;
  name: string;
  email: string;
  offer: string | null;
  source: string | null;
  cash_collected: number | null;
  contracted_revenue: number | null;
  sales_call_recording: string | null;
  why_they_bought: string | null;
  ghl_contact_id: string | null;
}

async function analyzeWithClaude(anthropic: Anthropic, deal: DealRow, transcript: string): Promise<string> {
  const prompt = `You are analyzing a sales call transcript from Program B, an agency-scaling + AI-installation consultancy run by The Operator.

The prospect closed — they BOUGHT the program. Your job: pull out WHY they bought and WHERE they came from, using direct quotes from the transcript.

Prospect: ${deal.name}
Program purchased: ${deal.offer ?? 'unknown'}
Cash collected: $${deal.cash_collected ?? 0}
Contracted revenue: $${deal.contracted_revenue ?? 0}
Attribution source (from Slack): ${deal.source ?? 'unknown'}

TRANSCRIPT:
${transcript.slice(0, 40000)}

OUTPUT FORMAT (markdown, exactly this structure):

**Why they bought**
- Bullet 1 with a direct quote in "quotes" + 1-sentence interpretation
- Bullet 2 with a direct quote + interpretation
- (3-5 bullets total)

**Where they came from**
- Short description of the attribution source based on what they actually said (YouTube video, referral from X, paid ad, organic content, etc.)
- Include a direct quote if they mentioned it

**Closer analysis**
1-2 sentences of your own analysis explaining the buying psychology and how future marketing could find more prospects like this one.

Rules:
- Only quote things the PROSPECT said, not the closer.
- If the transcript is thin / closer-only / prospect barely spoke, write: "Insufficient transcript data — prospect didn't speak enough to determine motivation."
- Don't speculate beyond the transcript.
- Keep each bullet under 2 sentences.`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = res.content.find((b) => b.type === 'text');
  return block && 'text' in block ? block.text.trim() : '';
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const maxRows = Number(url.searchParams.get('max') ?? DEFAULT_MAX_ROWS);

  const result = await runSync('scoring:why-bought', async (sb) => {
    const anthropic = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });
    const grainToken = requireEnv('GRAIN_API_KEY');

    // the operator rule 2026-04-23: EVERY t06 row should have why_they_bought populated
    // or an explicit "N/A" marker. No row should stay NULL. If the recording
    // URL is missing/non-transcript/too-thin, we write N/A so the row doesn't
    // appear on the next cron's pending list.
    const { data: candidates, error } = await sb
      .from('t06_deals_closed')
      .select('id,name,email,offer,source,cash_collected,contracted_revenue,sales_call_recording,why_they_bought,ghl_contact_id')
      .is('why_they_bought', null)
      .limit(maxRows);
    if (error) throw error;

    let processed = 0;
    let marked_na = 0;
    let failed = 0;

    // Helper: mark a row N/A with a clear reason. Still updates
    // why_they_bought_generated_at so subsequent runs don't reprocess.
    async function markNA(id: string, reason: string) {
      await sb
        .from('t06_deals_closed')
        .update({
          why_they_bought: `${NA_MARKER} Reason: ${reason}`,
          why_they_bought_generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      marked_na++;
    }

    for (const deal of (candidates ?? []) as DealRow[]) {
      // Tier 1: no recording URL at all → N/A immediately
      if (!deal.sales_call_recording) {
        await markNA(deal.id, 'no sales_call_recording on deal row');
        continue;
      }

      // Tier 2: URL is not a Grain recording (could be a mailto, a Google Doc,
      // raw text "n/a", etc). Can't extract a transcript → N/A.
      const grainId = extractGrainIdFromUrl(deal.sales_call_recording);
      if (!grainId) {
        await markNA(deal.id, `recording URL is not a Grain link (${deal.sales_call_recording.slice(0, 60)})`);
        continue;
      }

      // Tier 3: try t04 cache first (cheap, already authed). Stitch the
      // Claude-extracted structured fields into a synthetic "transcript" — good
      // enough signal for a why-bought pass.
      let transcript: string | null = null;
      const { data: cached } = await sb
        .from('t04_call_recordings')
        .select('prospect_name, pitch_summary, why_didnt_close, qual_summary, pain_points, desires_goals, motivation_to_show, objections, buying_questions, transcript_txt_url')
        .eq('id', grainId)
        .maybeSingle();

      if (cached) {
        const parts: string[] = [];
        if (cached.motivation_to_show) parts.push(`MOTIVATION TO SHOW: ${cached.motivation_to_show}`);
        if (cached.pain_points) parts.push(`PAIN POINTS: ${cached.pain_points}`);
        if (cached.desires_goals) parts.push(`DESIRES/GOALS: ${cached.desires_goals}`);
        if (cached.objections?.length) parts.push(`OBJECTIONS: ${cached.objections.join('; ')}`);
        if (cached.buying_questions?.length) parts.push(`BUYING QUESTIONS: ${cached.buying_questions.join('; ')}`);
        if (cached.pitch_summary) parts.push(`PITCH SUMMARY: ${cached.pitch_summary}`);
        if (cached.qual_summary) parts.push(`QUAL SUMMARY: ${cached.qual_summary}`);
        if (parts.length >= 3) transcript = parts.join('\n\n');
      }

      // Tier 4: fetch transcript live from Grain if cache was thin
      if (!transcript) {
        transcript = await fetchGrainTranscript(grainId, grainToken);
      }

      // Tier 5: still no transcript → N/A (prospect barely spoke or recording failed)
      if (!transcript || transcript.length < 200) {
        await markNA(deal.id, 'transcript too thin or unavailable from Grain');
        continue;
      }

      // Tier 6: analyze with Claude
      try {
        const analysis = await analyzeWithClaude(anthropic, deal, transcript);
        if (analysis.length < 50) {
          await markNA(deal.id, 'Claude returned empty/short analysis');
          continue;
        }
        await sb
          .from('t06_deals_closed')
          .update({
            why_they_bought: analysis,
            why_they_bought_generated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', deal.id);
        processed++;
      } catch (err) {
        console.error(`[scoring/why-bought] Claude error for ${deal.id}:`, err);
        failed++;
      }
    }

    console.log(`[scoring/why-bought] processed=${processed} marked_na=${marked_na} failed=${failed}`);
    return { rowsUpserted: processed + marked_na, rowsSkipped: failed };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = POST;
