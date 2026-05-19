/**
 * GET /api/week/qualitative?from=YYYY-MM-DD&to=YYYY-MM-DD&refresh=1
 *
 * Aggregates per-call qualitative signals from BOTH:
 *   • t04_call_recordings  — all sales calls (closed + non-closed)
 *                             columns: pain_points, desires_goals,
 *                             objections, ai_use_cases, ghl_contact_id
 *   • t06_deals_closed     — closed deals only
 *                             column: why_they_bought (rich prose)
 *
 * Bucket assignment per the operator's 2026-04-30 spec:
 *   1. buyReasons    — only from t06 closed deals (why people bought)
 *   2. painPoints    — ALL t04 calls (more important when they didn't buy)
 *   3. desires       — ALL t04 calls
 *   4. aiUseCases    — ALL t04 calls
 *   5. objections    — ONLY t04 calls where the prospect did NOT close
 *                      (matched via ghl_contact_id against t06 in the window)
 *
 * For each bucket: 2–5 themes, each with 2–4 verbatim quotes + a
 * `frequency` count (= # of calls where the theme appeared).
 *
 * Result is cached in t91_weekly_qualitative_cache keyed by week +
 * input-hash. Manual ?refresh=1 forces regen.
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// the operator 2026-04-30: switched from Sonnet 4.5 → Haiku 3.5 because
// Sonnet was reliably hitting Vercel's 60s function timeout on this
// corpus shape. Haiku 3.5 is 4-8× faster and the bucket-with-quotes
// task isn't reasoning-heavy enough to need Sonnet quality.
const MODEL = 'claude-haiku-4-5-20251001';
const NA_MARKER_SUBSTRING = 'no transcript available';
// the operator 2026-04-30: cap corpus aggressively so the Claude call fits
// inside Vercel's 60s function timeout. First pass (40 calls × 4 items
// × 240 chars + 6 closed deals) STILL hit FUNCTION_INVOCATION_TIMEOUT
// because Claude latency scales with input size for big prompts.
// Cutting to ~25KB total which gives Claude ~20-30s headroom.
const MAX_CALLS_TO_ANALYZE = 20;
const MAX_ITEMS_PER_ARRAY = 3;
const MAX_QUOTE_CHARS = 180;
const MAX_CLOSED_DEAL_CHARS = 1500; // truncate the verbose why_they_bought prose per deal

// the operator 2026-04-30: ET helpers — server is UTC and would otherwise
// roll the week boundary into tomorrow during evening ET requests.
import { daysAgoET } from '@/lib/timeframe';

function lastFullWeek(): { from: string; to: string } {
  return { from: daysAgoET(7), to: daysAgoET(1) };
}

interface ThemeBucket {
  theme: string;
  description: string;
  frequency: number;     // count of calls/deals where this theme showed up
  quotes: string[];
}

interface QualSummary {
  buyReasons: ThemeBucket[];
  painPoints: ThemeBucket[];
  desires: ThemeBucket[];
  objections: ThemeBucket[];
  aiUseCases: ThemeBucket[];
  // Provenance counts for transparency in the UI:
  closedDealsAnalyzed: number;
  totalCallsAnalyzed: number;
  nonClosedCallsAnalyzed: number;
  model: string;
  generatedAt: string;
}

const SYSTEM_PROMPT = `You are an analyst surfacing patterns from a coaching/agency company's weekly sales calls. You receive TWO corpora:

CORPUS A — closed-deal write-ups (t06.why_they_bought). Rich prose with verbatim prospect quotes and closer analysis. Use this ONLY for the "buyReasons" bucket.

CORPUS B — per-call qualitative arrays (t04_call_recordings). Each call has pre-extracted bullet points (with embedded direct quotes) for: pain_points, desires_goals, objections, ai_use_cases. Each bullet typically has format: "- Theme summary: \\"verbatim quote\\"". Use Corpus B for painPoints, desires, aiUseCases (ALL calls in the corpus) and for objections (ONLY calls flagged as didNotClose=true).

Your job: cluster the inputs into themes per dimension, pulling 2–4 VERBATIM quotes per theme (no paraphrasing), and counting how many distinct calls/deals exhibited each theme.

Bucket rules:
  • buyReasons    — Corpus A only.    What specifically made the prospect commit.
  • painPoints    — Corpus B all calls. What's hurting them; the problem they want to escape.
  • desires       — Corpus B all calls. The future they want to reach.
  • aiUseCases    — Corpus B all calls. Specific AI applications they mentioned.
  • objections    — Corpus B, didNotClose=true ONLY. Hesitations / pushback that prevented the close.

For EACH dimension: identify the TOP 3 themes ONLY (not more — pick the most common). For each theme:
  • theme: short label (3–6 words), specific not generic
  • description: ONE short sentence (max 20 words)
  • frequency: integer count = # of distinct calls/deals where the theme appeared
  • quotes: exactly 2 verbatim prospect quotes (no closer commentary), each ≤180 chars

Return ONLY valid JSON in this exact shape:
{
  "buyReasons":  [{"theme":"...", "description":"...", "frequency":N, "quotes":["...","..."]}],
  "painPoints":  [...],
  "desires":     [...],
  "objections":  [...],
  "aiUseCases":  [...]
}

Hard rules:
  • Quotes are verbatim. Strip outer quote marks.
  • If a dimension has no signal, return [].
  • Theme names avoid generic words like "growth"/"scale" alone.
  • Sort each bucket's themes by frequency DESC.
  • No markdown fences, no preamble — JSON only.`;

interface T06Row {
  id: string;
  name: string | null;
  offer: string | null;
  date_closed: string;
  why_they_bought: string;
  ghl_contact_id: string | null;
}

interface T04Row {
  id: string;
  prospect_name: string | null;
  call_date: string;
  offer: string | null;
  ghl_contact_id: string | null;
  pain_points: string | null;     // JSON array string
  desires_goals: string | null;
  objections: string | string[] | null; // can be array or null
  ai_use_cases: string | null;
}

function parseJsonArrayMaybe(field: unknown): string[] {
  if (!field) return [];
  if (Array.isArray(field)) return field.map(String);
  if (typeof field === 'string') {
    const s = field.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(String);
      return [String(parsed)];
    } catch {
      // Not JSON — treat as a single text block
      return [s];
    }
  }
  return [];
}

function hashInputs(t06ids: string[], t04ids: string[]): string {
  const ids = [...t06ids, ...t04ids].sort().join(',');
  return crypto.createHash('sha256').update(ids).digest('hex').slice(0, 16);
}

async function callClaude(
  closedDeals: T06Row[],
  callRecordings: Array<T04Row & { didNotClose: boolean }>,
): Promise<QualSummary> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  // 50s SDK timeout so we fail fast inside the 60s Vercel ceiling rather
  // than getting killed by FUNCTION_INVOCATION_TIMEOUT mid-response.
  const anthropic = new Anthropic({ apiKey, timeout: 50_000 });

  const corpusA = closedDeals
    .map((d, i) => {
      const body = d.why_they_bought.length > MAX_CLOSED_DEAL_CHARS
        ? d.why_they_bought.slice(0, MAX_CLOSED_DEAL_CHARS) + '\n…(truncated)'
        : d.why_they_bought;
      return `### CLOSED DEAL ${i + 1} — ${d.name ?? 'unknown'} · ${d.offer ?? 'unknown'} · ${d.date_closed}\n\n${body}`;
    })
    .join('\n\n---\n\n');

  // Truncate per-call arrays + per-quote length to keep the Claude
  // request fast enough to finish inside Vercel's 60s timeout.
  const truncate = (arr: string[]) =>
    arr.slice(0, MAX_ITEMS_PER_ARRAY).map((x) => (x.length > MAX_QUOTE_CHARS ? x.slice(0, MAX_QUOTE_CHARS) + '…' : x));

  const corpusB = callRecordings
    .slice(0, MAX_CALLS_TO_ANALYZE)
    .map((c, i) => {
      const pp = truncate(parseJsonArrayMaybe(c.pain_points));
      const dg = truncate(parseJsonArrayMaybe(c.desires_goals));
      const obj = truncate(parseJsonArrayMaybe(c.objections));
      const ai = truncate(parseJsonArrayMaybe(c.ai_use_cases));
      const flag = c.didNotClose ? 'didNotClose=true' : 'didNotClose=false';
      const sections: string[] = [];
      if (pp.length) sections.push(`pain_points:\n${pp.map((x) => `  ${x}`).join('\n')}`);
      if (dg.length) sections.push(`desires_goals:\n${dg.map((x) => `  ${x}`).join('\n')}`);
      if (obj.length) sections.push(`objections:\n${obj.map((x) => `  ${x}`).join('\n')}`);
      if (ai.length) sections.push(`ai_use_cases:\n${ai.map((x) => `  ${x}`).join('\n')}`);
      if (sections.length === 0) return null;
      return `### CALL ${i + 1} — ${c.prospect_name ?? 'unknown'} · ${c.offer ?? 'unknown'} · ${c.call_date} · ${flag}\n${sections.join('\n')}`;
    })
    .filter((s): s is string => s !== null)
    .join('\n\n---\n\n');

  const userMsg = `Bucket the inputs per the system prompt and return ONLY the JSON object.

================ CORPUS A (closed deals · ${closedDeals.length} entries) ================
${corpusA || '(none)'}

================ CORPUS B (all call recordings · ${callRecordings.length} entries; ${callRecordings.filter(c => c.didNotClose).length} non-closed) ================
${corpusB || '(none)'}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    // Output budget: 5 buckets × 3 themes × (label + desc + 2 quotes ~180c) ≈
    // ~1500 tokens of content. 2500 gives slack for escapes/whitespace
    // and lets Haiku finish well under the 60s Vercel ceiling.
    max_tokens: 2500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  });

  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  let parsed: Omit<QualSummary, 'closedDealsAnalyzed' | 'totalCallsAnalyzed' | 'nonClosedCallsAnalyzed' | 'model' | 'generatedAt'>;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Claude returned invalid JSON: ${(e as Error).message}\n--- raw text ---\n${text.slice(0, 500)}`);
  }

  return {
    ...parsed,
    closedDealsAnalyzed: closedDeals.length,
    totalCallsAnalyzed: callRecordings.length,
    nonClosedCallsAnalyzed: callRecordings.filter((c) => c.didNotClose).length,
    model: MODEL,
    generatedAt: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const forceRefresh = url.searchParams.get('refresh') === '1';
  const def = lastFullWeek();
  const from = fromParam || def.from;
  const to = toParam || def.to;

  const supa = await getServerSupabaseAsync();
  if (!supa) return NextResponse.json({ configured: false }, { status: 500 });

  // Pull both corpora in parallel.
  const [t06Res, t04Res] = await Promise.all([
    supa
      .from('t06_deals_closed')
      .select('id, name, offer, date_closed, why_they_bought, ghl_contact_id')
      .gte('date_closed', from)
      .lte('date_closed', to)
      .not('why_they_bought', 'is', null)
      .limit(200),
    supa
      .from('t04_call_recordings')
      .select('id, prospect_name, call_date, offer, ghl_contact_id, pain_points, desires_goals, objections, ai_use_cases')
      .gte('call_date', from)
      .lte('call_date', to)
      .limit(500),
  ]);

  if (t06Res.error) return NextResponse.json({ error: t06Res.error.message }, { status: 500 });
  if (t04Res.error) return NextResponse.json({ error: t04Res.error.message }, { status: 500 });

  // Strip "N/A — no transcript" rows; they have no signal.
  const closedDeals = ((t06Res.data ?? []) as T06Row[])
    .filter((d) => d.why_they_bought && !d.why_they_bought.toLowerCase().includes(NA_MARKER_SUBSTRING));

  // Build set of GHL contact IDs that closed in this window — used to
  // tag t04 calls as didNotClose=true/false for the objections rule.
  const closedContactIds = new Set(
    closedDeals.map((d) => d.ghl_contact_id).filter((x): x is string => !!x)
  );

  const callRecordings = ((t04Res.data ?? []) as T04Row[])
    .map((c) => ({
      ...c,
      didNotClose: c.ghl_contact_id ? !closedContactIds.has(c.ghl_contact_id) : true,
    }))
    .filter((c) => {
      // Keep only calls with at least one populated qualitative array.
      const pp = parseJsonArrayMaybe(c.pain_points);
      const dg = parseJsonArrayMaybe(c.desires_goals);
      const obj = parseJsonArrayMaybe(c.objections);
      const ai = parseJsonArrayMaybe(c.ai_use_cases);
      return pp.length + dg.length + obj.length + ai.length > 0;
    });

  if (closedDeals.length === 0 && callRecordings.length === 0) {
    return NextResponse.json({
      configured: true,
      window: { from, to },
      summary: null,
      cached: false,
      reason: 'no_qualitative_data',
      closedDealsAnalyzed: 0,
      totalCallsAnalyzed: 0,
      nonClosedCallsAnalyzed: 0,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const inputsHash = hashInputs(closedDeals.map((d) => d.id), callRecordings.map((c) => c.id));

  // Cache check — skip Claude unless forced or stale.
  if (!forceRefresh) {
    const { data: cacheRows } = await supa
      .from('t91_weekly_qualitative_cache')
      .select('summary, deals_hash, generated_at, model')
      .eq('week_from', from)
      .eq('week_to', to)
      .limit(1);
    const cached = (cacheRows ?? [])[0] as { summary: QualSummary; deals_hash: string; generated_at: string; model: string } | undefined;
    if (cached) {
      const ageMs = Date.now() - new Date(cached.generated_at).getTime();
      const fresh = ageMs < 24 * 60 * 60 * 1000;
      const sameInputs = cached.deals_hash === inputsHash;
      if (fresh && sameInputs) {
        return NextResponse.json({
          configured: true,
          window: { from, to },
          summary: cached.summary,
          cached: true,
          generatedAt: cached.generated_at,
          closedDealsAnalyzed: closedDeals.length,
          totalCallsAnalyzed: callRecordings.length,
          nonClosedCallsAnalyzed: callRecordings.filter((c) => c.didNotClose).length,
        }, { headers: { 'Cache-Control': 'no-store' } });
      }
    }
  }

  let summary: QualSummary;
  try {
    summary = await callClaude(closedDeals, callRecordings);
  } catch (e) {
    return NextResponse.json({
      configured: true,
      window: { from, to },
      error: (e as Error).message,
      closedDealsAnalyzed: closedDeals.length,
      totalCallsAnalyzed: callRecordings.length,
    }, { status: 502 });
  }

  // Persist to cache.
  const { error: upErr } = await supa
    .from('t91_weekly_qualitative_cache')
    .upsert({
      week_from: from,
      week_to: to,
      summary,
      deals_hash: inputsHash,
      generated_at: new Date().toISOString(),
      model: MODEL,
    }, { onConflict: 'week_from,week_to' });

  if (upErr) {
    return NextResponse.json({
      configured: true,
      window: { from, to },
      summary,
      cached: false,
      cacheError: upErr.message,
      closedDealsAnalyzed: closedDeals.length,
      totalCallsAnalyzed: callRecordings.length,
      nonClosedCallsAnalyzed: callRecordings.filter((c) => c.didNotClose).length,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json({
    configured: true,
    window: { from, to },
    summary,
    cached: false,
    generatedAt: summary.generatedAt,
    closedDealsAnalyzed: closedDeals.length,
    totalCallsAnalyzed: callRecordings.length,
    nonClosedCallsAnalyzed: callRecordings.filter((c) => c.didNotClose).length,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
