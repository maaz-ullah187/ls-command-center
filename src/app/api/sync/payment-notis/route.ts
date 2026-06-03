// Sync worker: t06_deals_closed (payment-notifications source)
// Source: Slack #payment-notifications (SLACK_CHANNEL_PAYMENT_NOTIS)
// Schedule: daily via Vercel Cron
//
// Each "PAYMENT NOTIS" Slack message with Action = payment.succeeded
// represents a real Whop payment. We upsert those into t06_deals_closed
// as deal rows keyed on the Slack ts so the sync is idempotent.
//
// Other action types (failed / refunded / chargedback) are ignored here —
// they live in t19_payment_notis (full audit trail) and t07_income_processors
// (revenue accounting).
//
// NOTE: this is a sibling of /api/sync/deals (which reads from the
// #new-clients channel). Both write to t06_deals_closed using DIFFERENT id
// prefixes so they never collide (`slack-…` vs `payment-noti-…`).

import { NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/runner';
import { parsePaymentNotification } from '@/lib/parsers/slack/paymentNotification';

export const maxDuration = 60;

interface SlackMessage {
  text?: string;
  ts?: string;
  blocks?: unknown[];
}

/** Paginate through Slack conversations.history for the given channel. */
async function fetchChannelMessages(
  token: string,
  channelId: string,
  oldest: number,
): Promise<SlackMessage[]> {
  const all: SlackMessage[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 30; page++) {
    const url = new URL('https://slack.com/api/conversations.history');
    url.searchParams.set('channel', channelId);
    url.searchParams.set('oldest', String(oldest));
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error(`[sync/payment-notis] Slack API HTTP ${res.status}`);
      break;
    }

    const data = await res.json();
    if (!data.ok) {
      console.error(`[sync/payment-notis] Slack API error: ${data.error}`);
      break;
    }

    if (data.messages?.length) all.push(...data.messages);
    if (!data.has_more || !data.response_metadata?.next_cursor) break;
    cursor = data.response_metadata.next_cursor;
  }

  return all;
}

export async function POST(request: Request) {
  const result = await runSync('deals-from-payment-notis', async (sb) => {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error('SLACK_BOT_TOKEN not configured');

    const channelId = process.env.SLACK_CHANNEL_PAYMENT_NOTIS;
    if (!channelId) throw new Error('SLACK_CHANNEL_PAYMENT_NOTIS not configured');

    // Query params:
    //   ?hours=24            — lookback N hours (default 24)
    //   ?since=YYYY-MM-DD    — backfill from a specific date (overrides hours)
    const { searchParams } = new URL(request.url);
    const sinceDate = searchParams.get('since');
    const hours = Number(searchParams.get('hours')) || 24;
    const oldest = sinceDate
      ? Math.floor(new Date(`${sinceDate}T00:00:00Z`).getTime() / 1000)
      : Math.floor(Date.now() / 1000) - hours * 3600;

    const messages = await fetchChannelMessages(token, channelId, oldest);
    console.log(`[sync/payment-notis] Scanned ${messages.length} messages`);

    let scanned = 0;
    let parsed = 0;
    let skippedNonSucceeded = 0;
    const rows: Array<Record<string, unknown>> = [];

    for (const msg of messages) {
      scanned += 1;
      const data = parsePaymentNotification({
        ts: msg.ts ?? '',
        text: msg.text,
        blocks: msg.blocks as never,
      });
      // ── DEBUG (temporary) ─────────────────────────────────────────────
      // Remove once payment-notis sync is confirmed working end-to-end.
      console.log(
        `[payment-notis-debug] ts=${msg.ts ?? 'no-ts'} ` +
          `parsed=${data !== null} ` +
          `text=${JSON.stringify((msg.text ?? '').slice(0, 100))}`,
      );
      if (!data) continue;
      parsed += 1;

      // Only payment.succeeded events become deals. Refunds / failures /
      // chargebacks are tracked elsewhere.
      if (data.action !== 'succeeded') {
        skippedNonSucceeded += 1;
        continue;
      }

      rows.push({
        id: `payment-noti-${data.slackTs}`,
        date_closed: data.date,
        name: data.fullName,
        email: data.email || null,
        cash_collected: data.amount,
        contracted_revenue: data.amount,
        source: 'Whop',
        closer: null,
        slack_ts: data.slackTs,
        updated_at: new Date().toISOString(),
      });
    }

    if (rows.length === 0) {
      console.log(
        `[sync/payment-notis] No succeeded payments to upsert ` +
          `(scanned=${scanned} parsed=${parsed} skippedNonSucceeded=${skippedNonSucceeded})`,
      );
      return { rowsUpserted: 0, rowsSkipped: scanned - parsed };
    }

    // Upsert in batches of 100, idempotent on `id` (payment-noti-<slack_ts>).
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await sb
        .from('t06_deals_closed')
        .upsert(batch, { onConflict: 'id' });
      if (error) throw error;
      upserted += batch.length;
    }

    console.log(
      `[sync/payment-notis] Upserted ${upserted} deals to t06_deals_closed ` +
        `(scanned=${scanned} parsed=${parsed} skippedNonSucceeded=${skippedNonSucceeded})`,
    );
    return { rowsUpserted: upserted, rowsSkipped: scanned - parsed };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = POST;
