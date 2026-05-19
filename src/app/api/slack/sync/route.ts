import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { parseCloserEod } from '@/lib/parsers/slack/closerEod';
import { parseDmSetterEod } from '@/lib/parsers/slack/dmSetterEod';
import { parseNewClient } from '@/lib/parsers/slack/newClient';
import { parsePaymentNotification } from '@/lib/parsers/slack/paymentNotification';
import { cleanEnv } from '@/lib/env';
import { postMessage } from '@/lib/bot/slack';

export const maxDuration = 60;

// Name normalization: Slack EODs often use first names only.
// Add entries for your team here so first-name posts roll up to canonical names.
const CLOSER_NAME_MAP: Record<string, string> = {
  // 'firstname': 'Firstname Lastname',
};

function normalizeCloserName(raw: string): string {
  const key = raw.trim().toLowerCase();
  return CLOSER_NAME_MAP[key] || raw.trim();
}

// ---------------------------------------------------------------------------
// Slack API helper — paginated conversations.history
// ---------------------------------------------------------------------------

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

  for (let page = 0; page < 10; page++) {
    const url = new URL('https://slack.com/api/conversations.history');
    url.searchParams.set('channel', channelId);
    url.searchParams.set('oldest', String(oldest));
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.error(`Slack API HTTP ${res.status} for channel ${channelId}`);
      break;
    }

    const data = await res.json();

    if (!data.ok) {
      console.error(`Slack API error for channel ${channelId}: ${data.error}`);
      break;
    }

    if (data.messages?.length) {
      all.push(...data.messages);
    }

    if (!data.has_more || !data.response_metadata?.next_cursor) break;
    cursor = data.response_metadata.next_cursor;
  }

  return all;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // Query param: lookback hours
  const { searchParams } = new URL(request.url);
  const hours = Number(searchParams.get('hours')) || 48;

  // All env reads go through cleanEnv() to strip any trailing whitespace /
  // wrapping quotes. Protects against the `echo "$VAR" | vercel env add` bug
  // that silently broke Slack sync for 5 days (2026-04-18 → 2026-04-23).
  const token = cleanEnv('SLACK_BOT_TOKEN');
  if (!token) {
    return NextResponse.json({ error: 'SLACK_BOT_TOKEN not configured' }, { status: 500 });
  }

  // Pre-flight: confirm the token is actually valid before we burn 3x API
  // calls across channels. If Slack rejects auth, fail loud.
  try {
    const authRes = await fetch('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const authJson = await authRes.json();
    if (!authJson.ok) {
      const msg = `Slack auth.test failed: ${authJson.error ?? 'unknown'}`;
      console.error(`[slack-sync] ${msg}`);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  } catch (err) {
    return NextResponse.json({ error: `Slack auth check threw: ${(err as Error).message}` }, { status: 500 });
  }

  const supabase = await getServerSupabaseAsync();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const oldest = Math.floor(Date.now() / 1000) - hours * 3600;

  const eodChannelId = cleanEnv('SLACK_CHANNEL_EODS');
  const newClientsChannelId = cleanEnv('SLACK_CHANNEL_NEW_CLIENTS');
  const paymentChannelId = cleanEnv('SLACK_CHANNEL_PAYMENT_NOTIS');

  let eodCount = 0;
  let newClientCount = 0;
  let paymentCount = 0;
  let errorCount = 0;
  const errorDetails: string[] = [];

  // ── EOD channel ──────────────────────────────────────────────────────────
  if (eodChannelId) {
    const messages = await fetchChannelMessages(token, eodChannelId, oldest);

    for (const msg of messages) {
      try {
        // Try DM Setter EOD format first (DM setter's
        // IG DM EODs). If matched, route to t05 with setter-shaped fields.
        const dm = parseDmSetterEod(msg as any);
        if (dm) {
          const setterName = normalizeCloserName(dm.setterName);
          const id = `eod-${dm.date}-${setterName.toLowerCase().replace(/\s+/g, '-')}`;
          // Map DM activity onto the closer-EOD shape so the leaderboard
          // can show James in the Setters section without a schema change:
          //   Appointments Set → calls_booked (the setter's appointment count)
          //   raw_message  → preserves DMs Sent / Conversations / etc.
          //   feedback     → preserves the rep's daily commentary
          const { error } = await supabase.from('t05_eod_reports').upsert(
            {
              id,
              date: dm.date,
              closer_name: setterName,
              calls_booked: dm.appointmentsSet,
              calls_shown: 0,
              no_shows: 0,
              calls_cancelled: 0,
              calls_closed: 0,
              cash_collected: 0,
              offers_given: 0,
              deposits: 0,
              revenue_generated: 0,
              feedback: dm.feedback,
              new_calls: dm.dmsSent,           // overload — DMs sent ≈ "new outreach calls"
              follow_up_calls: dm.followUps,    // overload — follow-up DMs
              raw_message: dm.rawMessage,
              slack_ts: dm.slackTs,
            },
            { onConflict: 'id' },
          );
          if (error) {
            errorCount++;
            errorDetails.push(`DM EOD upsert ${id}: ${error.message}`);
          } else {
            eodCount++;
            console.log(`Upserted DM Setter EOD: ${id}`);
          }
          continue;
        }

        const data = parseCloserEod(msg as any);
        if (!data) continue;

        const closerName = normalizeCloserName(data.closerName);
        const id = `eod-${data.date}-${closerName.toLowerCase().replace(/\s+/g, '-')}`;

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
          errorDetails.push(`EOD upsert ${id}: ${error.message}`);
        } else {
          eodCount++;
          console.log(`Upserted EOD report: ${id}`);
        }
      } catch (err: any) {
        errorCount++;
        errorDetails.push(`EOD parse error (ts=${msg.ts}): ${err.message}`);
      }
    }
  }

  // ── New clients channel ──────────────────────────────────────────────────
  if (newClientsChannelId) {
    const messages = await fetchChannelMessages(token, newClientsChannelId, oldest);

    for (const msg of messages) {
      try {
        const data = parseNewClient(msg as any);
        if (!data) continue;

        const id = `nc-${data.slackTs}`;

        const { error } = await supabase.from('t20_slack_new_clients').upsert(
          {
            id,
            slack_ts: data.slackTs,
            date: data.date,
            closer_name: data.closerName,
            program: data.program,
            lead_name: data.leadName,
            email: data.email,
            phone: data.phone,
            source: data.source,
            payment_structure: data.paymentStructure,
            cash_collected: data.cashCollected,
            contracted_revenue: data.contractedRevenue,
            payment_plan: data.paymentPlan,
            recording_url: data.recordingUrl,
            ghl_contact_url: data.ghlContactUrl,
            key_points: data.keyPoints,
          },
          { onConflict: 'id' },
        );

        if (error) {
          errorCount++;
          errorDetails.push(`New client upsert ${id}: ${error.message}`);
        } else {
          newClientCount++;
          console.log(`Upserted new client: ${id}`);
        }
      } catch (err: any) {
        errorCount++;
        errorDetails.push(`New client parse error (ts=${msg.ts}): ${err.message}`);
      }
    }
  }

  // ── Payment notifications channel ────────────────────────────────────────
  if (paymentChannelId) {
    const messages = await fetchChannelMessages(token, paymentChannelId, oldest);

    for (const msg of messages) {
      try {
        const data = parsePaymentNotification(msg as any);
        if (!data) continue;

        const id = `pn-${data.slackTs}`;

        const { error } = await supabase.from('t19_payment_notis').upsert(
          {
            id,
            slack_ts: data.slackTs,
            date: data.date,
            action: data.action,
            full_name: data.fullName,
            email: data.email,
            amount: data.amount,
            reason: data.reason,
          },
          { onConflict: 'id' },
        );

        if (error) {
          errorCount++;
          errorDetails.push(`Payment upsert ${id}: ${error.message}`);
        } else {
          paymentCount++;
          console.log(`Upserted payment notification: ${id}`);
        }
      } catch (err: any) {
        errorCount++;
        errorDetails.push(`Payment parse error (ts=${msg.ts}): ${err.message}`);
      }
    }
  }

  // Silent-failure guard (the operator rule 2026-04-23): if Slack sync parses
  // ZERO messages across all three channels for a non-trivial time window,
  // that's almost certainly a broken token / bad channel ID / permission loss
  // — not a genuine "no activity". Fire a Slack ops alert, deduped.
  //
  // Only triggers when:
  //   - hours >= 6 (ignore tiny lookbacks where zero is plausible)
  //   - at least 2 of the 3 channel IDs are configured
  //   - total parsed across all channels = 0
  const channelsConfigured = [eodChannelId, newClientsChannelId, paymentChannelId].filter(Boolean).length;
  const totalParsed = eodCount + newClientCount + paymentCount;
  const shouldAlertZeroParsed = hours >= 6 && channelsConfigured >= 2 && totalParsed === 0;

  if (shouldAlertZeroParsed) {
    const opsChannel = cleanEnv('SLACK_OPS_CHANNEL');
    if (opsChannel) {
      try {
        // Check dedup state: only alert if we haven't already flagged this
        const { data: priorState } = await supabase
          .from('t91_monitor_state')
          .select('last_status')
          .eq('table_name', 'sync:slack-zero-parsed')
          .maybeSingle();

        if (priorState?.last_status !== 'ERROR') {
          await postMessage({
            channel: opsChannel,
            text: `⚠️ *Slack sync parsed 0 messages* over ${hours}h window (${channelsConfigured}/3 channels configured).\n` +
              `This usually means: bad SLACK_BOT_TOKEN, channel IDs with trailing whitespace, or bot removed from channel.\n` +
              `Check env vars — trailing \\n is a common root cause. Run \`vercel env pull\` to inspect.\n` +
              `_Next non-zero sync will clear this alert._`,
          });
          await supabase
            .from('t91_monitor_state')
            .upsert(
              { table_name: 'sync:slack-zero-parsed', last_status: 'ERROR', last_check: new Date().toISOString(), last_age_min: null },
              { onConflict: 'table_name' },
            );
        }
      } catch (err) {
        console.error('[slack-sync] zero-parsed alert failed:', err);
      }
    }
  } else if (totalParsed > 0) {
    // Clear any prior zero-parsed ERROR state on recovery
    try {
      const { data: priorState } = await supabase
        .from('t91_monitor_state')
        .select('last_status')
        .eq('table_name', 'sync:slack-zero-parsed')
        .maybeSingle();
      if (priorState?.last_status === 'ERROR') {
        const opsChannel = cleanEnv('SLACK_OPS_CHANNEL');
        if (opsChannel) {
          await postMessage({ channel: opsChannel, text: `✅ *Slack sync* recovered (${totalParsed} msgs parsed)` });
        }
        await supabase
          .from('t91_monitor_state')
          .upsert(
            { table_name: 'sync:slack-zero-parsed', last_status: 'OK', last_check: new Date().toISOString(), last_age_min: null },
            { onConflict: 'table_name' },
          );
      }
    } catch { /* ignore */ }
  }

  return NextResponse.json({
    eods: eodCount,
    newClients: newClientCount,
    payments: paymentCount,
    errors: errorCount,
    details: errorDetails,
    zeroParsedAlertFired: shouldAlertZeroParsed,
  });
}

// Vercel Cron sends GET requests — delegate to the same sync logic
export async function GET(request: Request) {
  return POST(request);
}
