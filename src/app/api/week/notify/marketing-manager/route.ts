/**
 * POST /api/week/notify/marketing-manager
 *
 * Triggered from /week's Qualitative Data card. Pulls the cached
 * qualitative summary for the given window (or this week by default),
 * formats it as a Slack-friendly markdown report, and posts it to the
 * media-buying / CMO channel.
 *
 * Channel: configured via SLACK_NOTIFY_MARKETING_MANAGER env var
 *          (falls back to SLACK_CHANNEL_MARKETING_MGR).
 *
 * Body (optional):
 *   { from?: string; to?: string; }   — defaults to last full week
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const DEFAULT_CHANNEL = process.env.SLACK_CHANNEL_MARKETING_MGR ?? '';

interface Body { from?: string; to?: string }

interface ThemeBucket { theme: string; description: string; frequency: number; quotes: string[] }
interface QualSummary {
  buyReasons: ThemeBucket[];
  painPoints: ThemeBucket[];
  desires: ThemeBucket[];
  objections: ThemeBucket[];
  aiUseCases: ThemeBucket[];
  closedDealsAnalyzed: number;
  totalCallsAnalyzed: number;
  nonClosedCallsAnalyzed: number;
  model: string;
  generatedAt: string;
}

// the operator 2026-04-30: ET helpers — Vercel runs in UTC.
import { daysAgoET } from '@/lib/timeframe';

function lastFullWeek(): { from: string; to: string } {
  return { from: daysAgoET(7), to: daysAgoET(1) };
}

function formatBucket(label: string, buckets: ThemeBucket[], maxQuotesPerTheme = 2): string {
  if (!buckets || buckets.length === 0) return `*${label}:* _no themes surfaced this week._`;
  const sorted = [...buckets].sort((a, b) => b.frequency - a.frequency);
  const lines: string[] = [`*${label}:*`];
  for (const b of sorted) {
    lines.push(`• *${b.theme}* — ${b.frequency} call${b.frequency === 1 ? '' : 's'}`);
    if (b.description) lines.push(`    _${b.description}_`);
    for (const q of b.quotes.slice(0, maxQuotesPerTheme)) {
      const cleaned = q.replace(/^["']|["']$/g, '').slice(0, 240);
      lines.push(`    > "${cleaned}"`);
    }
  }
  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_NOTIFY_MARKETING_MANAGER || DEFAULT_CHANNEL;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'SLACK_BOT_TOKEN not configured' }, { status: 503 });
  }

  let body: Body = {};
  try { body = (await req.json()) as Body; } catch { /* empty body ok */ }
  const def = lastFullWeek();
  const from = body.from || def.from;
  const to = body.to || def.to;

  const supa = await getServerSupabaseAsync();
  if (!supa) return NextResponse.json({ ok: false, error: 'supabase not configured' }, { status: 503 });

  // Read the cached summary directly — the /week page has already
  // ensured it's fresh. If it's missing, instruct the operator to open
  // /week first so the qualitative endpoint can populate the cache.
  const { data: cacheRows, error } = await supa
    .from('t91_weekly_qualitative_cache')
    .select('summary, generated_at')
    .eq('week_from', from)
    .eq('week_to', to)
    .limit(1);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const row = (cacheRows ?? [])[0] as { summary: QualSummary; generated_at: string } | undefined;
  if (!row) {
    return NextResponse.json({
      ok: false,
      error: 'no_cache',
      detail: 'No cached qualitative summary for this window. Open /week first so the analyzer populates the cache.',
    }, { status: 404 });
  }
  const summary = row.summary;

  // Build the Slack message — bucket-by-bucket markdown.
  const header = [
    `:bar_chart: *Weekly qualitative report — ${from} → ${to}*`,
    `${summary.totalCallsAnalyzed} calls analyzed (${summary.nonClosedCallsAnalyzed} non-closed) · ${summary.closedDealsAnalyzed} closed deals · model ${summary.model}`,
    '',
  ].join('\n');

  const sections = [
    formatBucket('What made them buy', summary.buyReasons),
    formatBucket('Pain points', summary.painPoints),
    formatBucket('Desires', summary.desires),
    formatBucket("Objections (didn't buy)", summary.objections),
    formatBucket('AI use cases', summary.aiUseCases),
  ];

  const recommendations: string[] = ['', '*Recommended next steps:*'];
  if (summary.painPoints?.[0]) {
    recommendations.push(`• Build creative around the top pain point: *${summary.painPoints[0].theme}*.`);
  }
  if (summary.objections?.[0]) {
    recommendations.push(`• Address top objection in ad copy + pitch: *${summary.objections[0].theme}*.`);
  }
  if (summary.aiUseCases?.[0]) {
    recommendations.push(`• Build an AI-Installation demo around: *${summary.aiUseCases[0].theme}*.`);
  }
  if (summary.desires?.[0]) {
    recommendations.push(`• Future-state hook for content: *${summary.desires[0].theme}*.`);
  }

  const text = [header, sections.join('\n\n'), recommendations.join('\n')].join('\n');

  // Slack chat.postMessage has a 40k character limit but the practical
  // limit for readability is around 4k — truncate if needed.
  const finalText = text.length > 38000 ? text.slice(0, 38000) + '\n\n…(truncated)' : text;

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, text: finalText, mrkdwn: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data?.ok) {
    // Translate the most common Slack failure into something the UI can show
    // without forcing the user to hover the badge. `channel_not_found` is
    // really "bot isn't in this channel" 99% of the time.
    let hint: string | null = null;
    if (data?.error === 'channel_not_found') {
      hint = `The Slack bot isn't a member of the target channel. Open the channel in Slack and run "/invite @AI Personal Assistant", then retry.`;
    } else if (data?.error === 'not_in_channel') {
      hint = `The Slack bot needs to be invited to this channel first ("/invite @AI Personal Assistant").`;
    } else if (data?.error === 'invalid_auth' || data?.error === 'token_revoked') {
      hint = `SLACK_BOT_TOKEN is invalid or revoked — refresh it in Vercel env vars.`;
    }
    return NextResponse.json({ ok: false, error: data?.error ?? 'slack_error', hint, channel, detail: data }, { status: 502 });
  }
  return NextResponse.json({ ok: true, channel, ts: data.ts, characters: finalText.length });
}
