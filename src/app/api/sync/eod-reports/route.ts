import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { parseCloserEod } from '@/lib/parsers/slack/closerEod';

export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Dedicated EOD Reports sync endpoint.
//
// Designed to run via Vercel Cron at 5 AM Eastern (10:00 UTC) every day.
// Pulls the last 24 hours of messages from #sales-rep-eods and upserts
// parsed closer EOD reports into t05_eod_reports.
//
// Also checks for missing EODs from the previous business day and logs them.
// ---------------------------------------------------------------------------

// Configure your closers here.
const EXPECTED_CLOSERS: string[] = [];

// Name normalization: Slack EODs often use first names only.
// Add entries for your team so first-name posts roll up to canonical names.
const NAME_MAP: Record<string, string> = {
  // 'firstname': 'Firstname Lastname',
};

function normalizeCloserName(raw: string): string {
  const key = raw.trim().toLowerCase();
  return NAME_MAP[key] || raw.trim();
}

interface SlackMessage {
  text?: string;
  ts?: string;
  blocks?: any[];
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
      console.error(`[eod-sync] Slack API HTTP ${res.status}`);
      break;
    }

    const data = await res.json();
    if (!data.ok) {
      console.error(`[eod-sync] Slack API error: ${data.error}`);
      break;
    }

    if (data.messages?.length) all.push(...data.messages);
    if (!data.has_more || !data.response_metadata?.next_cursor) break;
    cursor = data.response_metadata.next_cursor;
  }

  return all;
}

/** Get yesterday's date in YYYY-MM-DD (Eastern Time) */
function getYesterdayET(): string {
  const now = new Date();
  // Convert to Eastern Time (UTC-5 or UTC-4 during DST)
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setDate(et.getDate() - 1);
  return et.toISOString().split('T')[0];
}

/** Check if EOD is expected on this date. Only Sundays are exempt. */
function isExpectedEodDay(dateStr: string): boolean {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  return day !== 0; // Every day except Sunday
}

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'SLACK_BOT_TOKEN not configured' }, { status: 500 });
  }

  const supabase = await getServerSupabaseAsync();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const eodChannelId = process.env.SLACK_CHANNEL_EODS;
  if (!eodChannelId) {
    return NextResponse.json({ error: 'SLACK_CHANNEL_EODS not configured' }, { status: 500 });
  }

  // Query params:
  //   ?hours=24 — lookback N hours (default 24)
  //   ?since=2026-04-01 — backfill from a specific date (overrides hours)
  const { searchParams } = new URL(request.url);
  const sinceDate = searchParams.get('since');
  const hours = Number(searchParams.get('hours')) || 24;

  let oldest: number;
  if (sinceDate) {
    // Parse YYYY-MM-DD to Unix timestamp
    oldest = Math.floor(new Date(sinceDate + 'T00:00:00Z').getTime() / 1000);
  } else {
    oldest = Math.floor(Date.now() / 1000) - hours * 3600;
  }

  const messages = await fetchChannelMessages(token, eodChannelId, oldest);

  let upsertCount = 0;
  let errorCount = 0;
  const errors: string[] = [];
  const syncedClosers = new Set<string>();

  for (const msg of messages) {
    try {
      const data = parseCloserEod(msg as any);
      if (!data) continue;

      const closerName = normalizeCloserName(data.closerName);
      const id = `eod-${data.date}-${closerName.toLowerCase().replace(/\s+/g, '-')}`;
      syncedClosers.add(closerName);

      const { error } = await supabase.from('t05_eod_reports').upsert(
        {
          id,
          date: data.date,
          closer_name: closerName,
          calls_booked: data.callsBooked,
          calls_shown: data.callsShown,
          no_shows: data.noShows,
          calls_cancelled: data.callsCancelled,
          calls_closed: data.dealsClosed,
          cash_collected: data.cashCollected,
          offers_given: data.offersGiven,
          deposits: data.deposits,
          revenue_generated: data.revenueGenerated,
          feedback: data.feedback,
          new_calls: data.newCalls,
          follow_up_calls: data.followUpCalls,
          raw_message: data.rawMessage,
          slack_ts: data.slackTs,
        },
        { onConflict: 'id' },
      );

      if (error) {
        errorCount++;
        errors.push(`Upsert ${id}: ${error.message}`);
      } else {
        upsertCount++;
        console.log(`[eod-sync] Upserted: ${id}`);
      }
    } catch (err: any) {
      errorCount++;
      errors.push(`Parse error (ts=${msg.ts}): ${err.message}`);
    }
  }

  // --- Clean up old un-normalized closer names ---
  // Add first-name variants here that should be deleted in favour of canonical names.
  const unnormalizedNames: string[] = [];
  for (const oldName of unnormalizedNames) {
    const { data: oldRecs } = await supabase
      .from('t05_eod_reports')
      .select('id')
      .eq('closer_name', oldName);
    if (oldRecs && oldRecs.length > 0) {
      await supabase.from('t05_eod_reports').delete().in('id', oldRecs.map((r: any) => r.id));
      console.log(`[eod-sync] Cleaned up ${oldRecs.length} stale "${oldName}" records`);
    }
  }

  // --- Check for missing EODs from yesterday ---
  const yesterday = getYesterdayET();
  const isExpectedDay = isExpectedEodDay(yesterday);
  const missingClosers: string[] = [];

  if (isExpectedDay) {
    // Check which expected closers have an EOD for yesterday in Supabase
    const { data: existingEods } = await supabase
      .from('t05_eod_reports')
      .select('closer_name')
      .eq('date', yesterday);

    const reportedClosers = new Set((existingEods ?? []).map((r: any) => r.closer_name));

    for (const closer of EXPECTED_CLOSERS) {
      if (!reportedClosers.has(closer)) {
        missingClosers.push(closer);
      }
    }

    if (missingClosers.length > 0) {
      console.warn(`[eod-sync] ⚠️ Missing EOD reports for ${yesterday}: ${missingClosers.join(', ')}`);
    }
  }

  return NextResponse.json({
    synced: upsertCount,
    errors: errorCount,
    errorDetails: errors,
    yesterday,
    isExpectedEodDay: isExpectedDay,
    missingClosers,
    syncedClosers: Array.from(syncedClosers),
    messagesScanned: messages.length,
  });
}
