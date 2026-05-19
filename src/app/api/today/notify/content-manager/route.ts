/**
 * POST /api/today/notify/content-manager
 *
 * Triggered from /today's "Emergency booking protocol" section when
 * the operator clicks "Notify content manager — IG story CTA". Posts a
 * pre-formatted Slack message to the content manager's channel
 * asking for an Instagram story CTA to drive bookings.
 *
 * Channel: configured via SLACK_NOTIFY_CONTENT_MANAGER env var
 *          (falls back to SLACK_CHANNEL_CONTENT_MGR).
 *
 * Body (optional, all auto-populated from booking-capacity if omitted):
 *   { teamCapacityPct?: number; closersBelowCapacity?: number;
 *     totalClosers?: number }
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DEFAULT_CHANNEL = process.env.SLACK_CHANNEL_CONTENT_MGR ?? '';

interface Body {
  teamCapacityPct?: number;
  closersBelowCapacity?: number;
  totalClosers?: number;
}

export async function POST(req: NextRequest) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_NOTIFY_CONTENT_MANAGER || DEFAULT_CHANNEL;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'SLACK_BOT_TOKEN not configured' }, { status: 503 });
  }

  let body: Body = {};
  try { body = (await req.json()) as Body; } catch { /* allow empty body */ }

  const pct = typeof body.teamCapacityPct === 'number' ? Math.round(body.teamCapacityPct) : null;
  const below = typeof body.closersBelowCapacity === 'number' ? body.closersBelowCapacity : null;
  const total = typeof body.totalClosers === 'number' ? body.totalClosers : null;

  const lines: string[] = [];
  lines.push(':rotating_light: *Booking-capacity request from the operator*');
  if (pct !== null) {
    lines.push(`Team booking capacity is at *${pct}%* of target right now.`);
  } else {
    lines.push(`Team booking capacity is below target right now.`);
  }
  if (below !== null && total !== null && total > 0) {
    lines.push(`${below} of ${total} closers are below the 6-call/day threshold across the last 4 days.`);
  }
  lines.push('');
  lines.push('*Need:* an Instagram story CTA today to drive new applications onto the calendar.');
  lines.push('Example angle: scarcity ("only 3 spots left this week"), social proof (latest client win), or a direct ask ("DM me \\"BOOK\\" if you want a free strategy call").');

  const text = lines.join('\n');

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel, text, mrkdwn: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data?.ok) {
    return NextResponse.json({ ok: false, error: data?.error ?? 'slack_error', detail: data }, { status: 502 });
  }
  return NextResponse.json({ ok: true, channel, ts: data.ts });
}
