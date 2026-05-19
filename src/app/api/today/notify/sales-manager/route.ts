/**
 * POST /api/today/notify/sales-manager
 *
 * Triggered from /today's "Emergency booking protocol" when the operator
 * clicks "Notify sales manager — run reactivation campaign". Posts a
 * Slack message to the sales-manager channel asking them to launch a
 * reactivation campaign across existing leads.
 *
 * Channel: configured via SLACK_NOTIFY_SALES_MANAGER env var
 *          (falls back to SLACK_CHANNEL_SALES_MGR).
 *
 * Body (optional, all auto-populated from booking-capacity if omitted):
 *   { teamCapacityPct?: number; closersBelowCapacity?: number;
 *     totalClosers?: number; targetCapacityPct?: number }
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DEFAULT_CHANNEL = process.env.SLACK_CHANNEL_SALES_MGR ?? '';
const TARGET_CAPACITY_PCT = 100; // 6 booked/day = 100% capacity. Below 70% triggers protocol.

interface Body {
  teamCapacityPct?: number;
  closersBelowCapacity?: number;
  totalClosers?: number;
  targetCapacityPct?: number;
}

export async function POST(req: NextRequest) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_NOTIFY_SALES_MANAGER || DEFAULT_CHANNEL;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'SLACK_BOT_TOKEN not configured' }, { status: 503 });
  }

  let body: Body = {};
  try { body = (await req.json()) as Body; } catch { /* empty body ok */ }

  const pct = typeof body.teamCapacityPct === 'number' ? Math.round(body.teamCapacityPct) : null;
  const target = typeof body.targetCapacityPct === 'number' ? body.targetCapacityPct : TARGET_CAPACITY_PCT;
  const below = typeof body.closersBelowCapacity === 'number' ? body.closersBelowCapacity : null;
  const total = typeof body.totalClosers === 'number' ? body.totalClosers : null;

  const lines: string[] = [];
  lines.push(':rotating_light: *Booking-capacity alert from the operator — reactivation campaign needed*');
  if (pct !== null) {
    lines.push(`Team booking capacity is at *${pct}%* over the last 4 days. Target is *${target}%*.`);
  } else {
    lines.push(`Team booking capacity is below the ${target}% target over the last 4 days.`);
  }
  if (below !== null && total !== null && total > 0) {
    lines.push(`*${below} of ${total} closers* are averaging fewer than 6 calls/day this window.`);
  }
  lines.push('');
  lines.push('*Action needed:* run a reactivation campaign across existing leads to drive new bookings onto the calendar this week.');
  lines.push('Suggested cadence: SMS + email blast to last 90 days of unbooked leads, then DM follow-up on highest-intent contacts.');

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
