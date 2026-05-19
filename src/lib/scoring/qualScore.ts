import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { Lead } from '../types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface LeadScore {
  score: number;        // 0-10, one decimal
  summary: string;      // 1-2 sentences
  redFlags: string[];
  greenFlags: string[];
  qualified: boolean;   // score >= 6
}

/* ------------------------------------------------------------------ */
/*  Scoring rubric (system prompt)                                     */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are the lead-quality scorer for a B2B AI agency that builds custom AI agents for businesses. The agency sells three programs: Program A (community/course), Program B (licensing model), and Program C (done-for-you agency offer).

Score the lead on a 0-10 scale (one decimal place). Return ONLY valid JSON — no markdown, no commentary.

## Scale

- 0: Unqualified, never pitched. No financial capacity. Call ended early (<10 min) with no offer discussion.
- 1-3: Got pitched but clearly can't afford it, no real pain, wrong fit.
- 4-5: Some potential but major gaps — low revenue, unclear need, flaky engagement.
- 6: Borderline qualified — in ICP but financially tight ($30-50K/month). Long call shows interest but economics marginal.
- 7-8: Solid lead — good business (5+ years, team, $50-150K+/month), clear pain, can afford it.
- 9-10: Home run — high revenue ($150K+/month), obvious operational pain, financially ready, deeply engaged (45+ min), next steps booked.

## Calibration examples

- Score 10: Cannabis operator, 16 years in business, ~$35M gross revenue, $150-500K/month, 10 businesses. 58-min call. Discussed specific agents (CFO, inventory, marketing), $15K pricing, follow-up with developer booked.
- Score 7.5: E-commerce home decor, 5 years, 10-person team, $50-150K/month. 29-min call. Wants to automate and resell. Requested deeper demo.
- Score 6: Tutoring agency, 1 year, $30-50K/month. 49-min call, interest but revenue low end.
- Score 0: Never pitched, no financial capacity, call ended early.

## Key signals (in order of importance)

1. Revenue / financial capacity (heaviest weight)
2. Call duration
3. Whether pricing was discussed
4. Clear pain articulated
5. Business maturity (years, team size)
6. Next steps booked
7. Application answer quality

## Response format

Return ONLY a JSON object with these fields:
{
  "score": <number 0-10, one decimal>,
  "summary": "<1-2 sentence summary of qualification status>",
  "redFlags": ["<flag1>", ...],
  "greenFlags": ["<flag1>", ...],
  "qualified": <true if score >= 6, false otherwise>
}`;

/* ------------------------------------------------------------------ */
/*  User message builder                                               */
/* ------------------------------------------------------------------ */

function buildUserMessage(lead: Lead, transcript: string | null): string {
  const parts: string[] = [];

  parts.push(`## Lead: ${lead.name}`);
  parts.push(`Email: ${lead.email || 'N/A'}`);
  parts.push(`Program: ${lead.program || 'Unknown'}`);
  parts.push(`Stage: ${lead.stage || 'Unknown'}`);
  parts.push(`Cash Collected: $${(lead.cashCollected ?? 0).toLocaleString()}`);

  // Qualification answers
  if (lead.qualification) {
    parts.push('\n## Application / Qualification Answers');
    const q = lead.qualification;
    if (q.businessType) parts.push(`Business Type: ${q.businessType}`);
    if (q.monthlyRevenue) parts.push(`Monthly Revenue: ${q.monthlyRevenue}`);
    if (q.coreBusiness) parts.push(`Core Business: ${q.coreBusiness}`);
    if (q.biggestStruggle) parts.push(`Biggest Struggle: ${q.biggestStruggle}`);
    if (q.currentIncome) parts.push(`Current Income: ${q.currentIncome}`);
    if (q.investmentCapacity) parts.push(`Investment Capacity: ${q.investmentCapacity}`);
    if (q.teamSize) parts.push(`Team Size: ${q.teamSize}`);
    if (q.monthlyPayroll) parts.push(`Monthly Payroll: ${q.monthlyPayroll}`);
    if (q.triedAiBefore) parts.push(`Tried AI Before: ${q.triedAiBefore}`);
    if (q.biggestBottlenecks) parts.push(`Biggest Bottlenecks: ${q.biggestBottlenecks}`);
    if (q.speedToImplement) parts.push(`Speed to Implement: ${q.speedToImplement}`);
  }

  // Call metadata
  parts.push('\n## Call Metadata');
  if (lead.grainCallType) parts.push(`Call Type: ${lead.grainCallType}`);
  if (lead.grainDurationMin != null) parts.push(`Call Duration: ${lead.grainDurationMin} minutes`);
  if (lead.assignedCloser) parts.push(`Closer: ${lead.assignedCloser}`);
  if (lead.callOutcome) parts.push(`Call Outcome: ${lead.callOutcome}`);
  if (lead.showStatus) parts.push(`Show Status: ${lead.showStatus}`);

  // Grain AI summary
  if (lead.grainCallSummary) {
    parts.push('\n## Grain AI Summary');
    parts.push(lead.grainCallSummary);
  }

  // Intelligence notes
  if (lead.grainIntelligenceNotes) {
    parts.push('\n## Intelligence Notes');
    parts.push(lead.grainIntelligenceNotes);
  }

  // Transcript (truncated to 30k chars)
  if (transcript) {
    const maxLen = 30_000;
    const truncated = transcript.length > maxLen
      ? transcript.slice(0, maxLen) + '\n\n[...transcript truncated at 30,000 characters]'
      : transcript;
    parts.push('\n## Call Transcript');
    parts.push(truncated);
  } else {
    parts.push('\n## Call Transcript');
    parts.push('No transcript available.');
  }

  return parts.join('\n');
}

/* ------------------------------------------------------------------ */
/*  JSON parsing helpers                                               */
/* ------------------------------------------------------------------ */

function stripCodeFences(raw: string): string {
  // Remove ```json ... ``` or ``` ... ```
  return raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;
}

function parseLeadScore(raw: string): LeadScore {
  const cleaned = stripCodeFences(raw);
  const parsed = JSON.parse(cleaned);

  const score = clamp(
    typeof parsed.score === 'number' ? parsed.score : parseFloat(parsed.score) || 0,
    0,
    10,
  );

  return {
    score,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    redFlags: Array.isArray(parsed.redFlags)
      ? parsed.redFlags.filter((f: unknown) => typeof f === 'string')
      : [],
    greenFlags: Array.isArray(parsed.greenFlags)
      ? parsed.greenFlags.filter((f: unknown) => typeof f === 'string')
      : [],
    qualified: score >= 6,
  };
}

/* ------------------------------------------------------------------ */
/*  Main scoring function                                              */
/* ------------------------------------------------------------------ */

export async function scoreLeadQuality(
  lead: Lead,
  transcript: string | null,
): Promise<LeadScore> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const client = new Anthropic({ apiKey });

  const userMessage = buildUserMessage(lead, transcript);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  // Extract text from response
  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text content in Claude response');
  }

  return parseLeadScore(textBlock.text);
}
