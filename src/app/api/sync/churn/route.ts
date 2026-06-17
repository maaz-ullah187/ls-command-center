// Sync worker: t09_churn (client offboarding events)
// Source: Slack channel C0B652E8Z32 → t09_churn
// Schedule: daily via Vercel Cron
//
// Parses messages that announce a client has been offboarded. Gate is
// strict — the message must contain BOTH "has now been offboarded" AND
// "Client Name:" AND "Client Revenue:" so test posts and other chatter
// in the channel are skipped.
//
// Field extraction is regex-based on `Label: value` pairs. Each message
// is upserted on its Slack ts so the sync is idempotent.

import { NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/runner';

export const maxDuration = 60;

// Fixed channel id per the operator's spec — channel is dedicated to churn
// announcements only.
const CHURN_CHANNEL_ID = 'C0B652E8Z32';

interface SlackMessage {
  text?: string;
  ts?: string;
  blocks?: unknown[];
}

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
      console.error(`[sync/churn] Slack API HTTP ${res.status}`);
      break;
    }
    const data = await res.json();
    if (!data.ok) {
      console.error(`[sync/churn] Slack API error: ${data.error}`);
      break;
    }
    if (data.messages?.length) all.push(...data.messages);
    if (!data.has_more || !data.response_metadata?.next_cursor) break;
    cursor = data.response_metadata.next_cursor;
  }

  return all;
}

/** Pull the full text out of a Slack message, including block-content fallback. */
function extractMessageText(msg: SlackMessage): string {
  let combined = msg.text ?? '';
  const blocks = (msg.blocks ?? []) as Array<{ type?: string; text?: { text?: string } }>;
  for (const b of blocks) {
    if (b.type === 'section' && b.text?.text) {
      combined += '\n' + b.text.text;
    }
  }
  return combined;
}

/**
 * Extract a single "Label: value" field from the message body.
 * Handles bold-wrapped labels (`*Label:*`), trailing currency symbols, and
 * mailto/URL noise that Slack sometimes wraps around values.
 */
function extractField(text: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `\\*?\\s*${escaped}\\s*\\*?\\s*:\\s*\\*?\\s*([^*\\n]*?)\\s*\\*?\\s*$`,
    'm',
  );
  const m = text.match(re);
  const v = m?.[1]?.trim();
  return v && v.length > 0 ? v : undefined;
}

/** Strip $, commas, whitespace from a currency string and return a Number. */
function parseMoney(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse an int from a free-form string (e.g. "8 months" → 8). */
function parseInt0(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/-?\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

/** YYYY-MM-DD derived from a Slack ts. */
function dateFromSlackTs(ts: string): string {
  const epoch = parseFloat(ts);
  if (!Number.isFinite(epoch)) return new Date().toISOString().slice(0, 10);
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const result = await runSync('churn', async (sb) => {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error('SLACK_BOT_TOKEN not configured');

    // Query params:
    //   ?hours=24            — lookback N hours (default 24)
    //   ?since=YYYY-MM-DD    — backfill from a specific date (overrides hours)
    const { searchParams } = new URL(request.url);
    const sinceDate = searchParams.get('since');
    const hours = Number(searchParams.get('hours')) || 24;
    const oldest = sinceDate
      ? Math.floor(new Date(`${sinceDate}T00:00:00Z`).getTime() / 1000)
      : Math.floor(Date.now() / 1000) - hours * 3600;

    const messages = await fetchChannelMessages(token, CHURN_CHANNEL_ID, oldest);
    console.log(`[sync/churn] Scanned ${messages.length} messages from #${CHURN_CHANNEL_ID}`);

    let scanned = 0;
    let parsed = 0;
    let skippedGate = 0;
    let skippedTest = 0;
    const rows: Array<Record<string, unknown>> = [];

    for (const msg of messages) {
      scanned += 1;
      if (!msg.ts) continue;
      const text = extractMessageText(msg);

      // Strict gate — all three markers must be present. Filters out test
      // posts, unrelated chatter, partial drafts.
      if (
        !text.includes('has now been offboarded') ||
        !text.includes('Client Name:') ||
        !text.includes('Client Revenue:')
      ) {
        skippedGate += 1;
        continue;
      }

      const clientName    = extractField(text, 'Client Name');
      const csManager     = extractField(text, 'CS Manager')
                          ?? extractField(text, 'CS')
                          ?? extractField(text, 'Account Manager');

      // Drop empty / junk / test rows BEFORE pulling the rest of the fields.
      //   - client_name must exist and be at least 3 chars (filters "AB",
      //     "—", placeholder dashes, etc.)
      //   - either client_name OR cs_manager mentioning "test" (case-insensitive)
      //     means it's a test post the team doesn't want in revenue rollups.
      const nameTrim = (clientName ?? '').trim();
      if (nameTrim.length < 3) {
        skippedTest += 1;
        continue;
      }
      const nameLc = nameTrim.toLowerCase();
      const mgrLc = (csManager ?? '').toLowerCase();
      if (nameLc.includes('test') || mgrLc.includes('test')) {
        skippedTest += 1;
        continue;
      }

      const reason        = extractField(text, 'Reason')
                          ?? extractField(text, 'Churn Reason')
                          ?? extractField(text, 'Why');
      const ltvMonths     = parseInt0(
                              extractField(text, 'LTV (months)')
                              ?? extractField(text, 'LTV Months')
                              ?? extractField(text, 'LTV')
                              ?? extractField(text, 'Tenure')
                          );
      const clientRevenue = parseMoney(extractField(text, 'Client Revenue'));
      const refundAmount  = parseMoney(
                              extractField(text, 'Refund Amount')
                              ?? extractField(text, 'Refund')
                          );

      parsed += 1;
      rows.push({
        id: msg.ts,
        date: dateFromSlackTs(msg.ts),
        client_name: clientName ?? null,
        cs_manager: csManager ?? null,
        reason: reason ?? null,
        ltv_months: ltvMonths,
        client_revenue: clientRevenue,
        refund_amount: refundAmount,
        slack_ts: msg.ts,
        raw_text: text,
        // created_at left to its DEFAULT now() on first insert. Re-syncs
        // won't overwrite it (upsert on primary key).
      });
    }

    if (rows.length === 0) {
      console.log(
        `[sync/churn] No churn events to upsert ` +
          `(scanned=${scanned} parsed=${parsed} skippedGate=${skippedGate} skippedTest=${skippedTest})`,
      );
      return { rowsUpserted: 0, rowsSkipped: scanned - parsed };
    }

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await sb
        .from('t09_churn')
        .upsert(batch, { onConflict: 'id' });
      if (error) throw error;
      upserted += batch.length;
    }

    console.log(
      `[sync/churn] Upserted ${upserted} churn events ` +
        `(scanned=${scanned} parsed=${parsed} skippedGate=${skippedGate} skippedTest=${skippedTest})`,
    );
    return { rowsUpserted: upserted, rowsSkipped: scanned - parsed };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = POST;
