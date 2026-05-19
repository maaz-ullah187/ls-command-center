import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

/**
 * POST /api/review-queue/ping
 *
 * Sends a Slack DM to the row owner (or falls back to #ops).
 *
 * Body:
 *   {
 *     bucket:  'unknown_source' | 'unlogged_calls' | 'missing_quality'
 *            | 'missing_eod'    | 'data_anomaly'   | 'revenue_flag'
 *            | 'missing_billing_type' | 'missing_expense_type',
 *     ownerName?: string,        // optional pre-resolved closer/owner name
 *     leadId?: string,           // for context
 *     leadName?: string,         // for context
 *     summary: string,           // short human description used in the DM
 *     deepLink?: string          // /crm?id=…  /sales-calls?…  built by caller
 *   }
 *
 * Owner routing:
 *   1. If ownerName provided, look up t90_team_roster.slack_user_id by name (case-insensitive).
 *   2. Otherwise, use bucket → fallback channel:
 *        missing_expense_type      → #ops (finance lead lives in env later)
 *        everything else           → #ops
 */

const FALLBACK_CHANNEL = process.env.SLACK_REVIEW_QUEUE_CHANNEL || '#ops';

interface PingBody {
  bucket: string;
  ownerName?: string;
  leadId?: string;
  leadName?: string;
  summary: string;
  deepLink?: string;
}

async function postSlack(token: string, channel: string, text: string) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel, text }),
  });
  const data = await res.json().catch(() => ({}));
  return data;
}

async function resolveOwnerSlackId(name: string | undefined): Promise<string | null> {
  if (!name) return null;
  const supa = await getServerSupabase();
  if (!supa) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  // Case-insensitive name match. Service-role bypasses RLS.
  const { data } = await supa
    .from('t90_team_roster')
    .select('slack_user_id, name')
    .ilike('name', trimmed)
    .limit(1);
  if (Array.isArray(data) && data.length > 0 && data[0]?.slack_user_id) {
    return data[0].slack_user_id as string;
  }
  return null;
}

function buildMessage(body: PingBody, baseUrl: string): string {
  const lines: string[] = [];
  const labels: Record<string, string> = {
    unknown_source: 'Unknown source',
    unlogged_calls: 'Unlogged call outcome',
    missing_quality: 'Missing quality score',
    missing_eod: 'Missing EOD report',
    data_anomaly: 'Data anomaly',
    revenue_flag: 'Revenue flag',
    missing_billing_type: 'Missing billing type / offer',
    missing_expense_type: 'Missing expense type',
  };
  const label = labels[body.bucket] ?? body.bucket;

  lines.push(`:warning: *${label}* — needs your attention`);
  if (body.leadName) lines.push(`*Lead:* ${body.leadName}${body.leadId ? ` (\`${body.leadId}\`)` : ''}`);
  lines.push(body.summary);
  if (body.deepLink) {
    const url = body.deepLink.startsWith('http') ? body.deepLink : `${baseUrl}${body.deepLink}`;
    lines.push(`<${url}|Open in dashboard>`);
  }
  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'SLACK_BOT_TOKEN not configured' }, { status: 500 });
  }

  let body: PingBody;
  try {
    body = (await req.json()) as PingBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.bucket || !body.summary) {
    return NextResponse.json({ error: 'bucket and summary are required' }, { status: 400 });
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    `https://${req.headers.get('host') ?? 'tracking-dashboard-your-app.vercel.app'}`;

  const ownerSlackId = await resolveOwnerSlackId(body.ownerName);
  const channel = ownerSlackId ?? FALLBACK_CHANNEL;
  const text = buildMessage(body, baseUrl);

  const result = await postSlack(token, channel, text);
  if (!result?.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result?.error || 'slack_post_failed',
        attemptedChannel: channel,
        fellBackToOps: !ownerSlackId,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    deliveredTo: channel,
    fellBackToOps: !ownerSlackId,
    ts: result.ts,
  });
}
