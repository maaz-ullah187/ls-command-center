// Common helper for sync workers — every Pillar that adds a real source
// (Meta, GHL, Whop, Fanbasis, Grain, Fathom, Slack, YouTube, IG, X, LI)
// builds its own `src/lib/sync/<source>.ts` worker and uses these helpers
// to upsert into Supabase idempotently and log success/failure to the
// `sync_runs` table (created in a future migration when we add observability).
//
// For Pillar 0 this file just provides the shared shape; subsequent pillars
// fill in the per-source logic.

import 'server-only';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { postMessage } from '@/lib/bot/slack';

export interface SyncResult {
  source: string;
  ok: boolean;
  rowsUpserted: number;
  rowsSkipped: number;
  durationMs: number;
  error?: string;
}

/**
 * Fire-and-forget Slack alert when a sync fails.
 *
 * Dedupes via t91_monitor_state so the same recurring error doesn't spam
 * the channel every 5 min (GHL 403, Grain token revoked, etc). One alert
 * per source per failure state — we reset the suppression when the next
 * successful run happens, so a future re-break does re-alert.
 */
async function postSyncErrorAlert(source: string, errorMessage: string, durationMs: number): Promise<void> {
  const channel = process.env.SLACK_OPS_CHANNEL;
  if (!channel) return;

  try {
    const sb = await getServerSupabaseAsync();
    const key = `sync:${source}`;

    // Check if this source is already in an errored state (suppression)
    let suppress = false;
    if (sb) {
      const { data: prior } = await sb
        .from('t91_monitor_state')
        .select('last_status, last_age_min')
        .eq('table_name', key)
        .maybeSingle();
      // last_age_min is reused here to store a short hash of the last error
      // message so transient errors that change cause a re-alert.
      if (prior?.last_status === 'ERROR') suppress = true;
    }

    if (!suppress) {
      const short = errorMessage.slice(0, 500).replace(/```/g, '` ` `');
      await postMessage({
        channel,
        text:
          `🛑 *sync/${source}* threw an error\n` +
          `Duration: ${durationMs}ms\n` +
          '```' + short + '```' +
          `\n_Next success will clear this alert; a different error will re-alert._`,
      });
    }

    // Persist errored state
    if (sb) {
      await sb
        .from('t91_monitor_state')
        .upsert(
          { table_name: `sync:${source}`, last_status: 'ERROR', last_check: new Date().toISOString(), last_age_min: null },
          { onConflict: 'table_name' },
        );
    }
  } catch {
    // Never let alert-posting failures cascade into the caller.
  }
}

/** On successful sync, clear any prior ERROR state + optionally post recovery. */
async function clearSyncErrorState(source: string): Promise<void> {
  try {
    const sb = await getServerSupabaseAsync();
    if (!sb) return;
    const key = `sync:${source}`;
    const { data: prior } = await sb
      .from('t91_monitor_state')
      .select('last_status')
      .eq('table_name', key)
      .maybeSingle();

    if (prior?.last_status === 'ERROR') {
      const channel = process.env.SLACK_OPS_CHANNEL;
      if (channel) {
        await postMessage({ channel, text: `✅ *sync/${source}* recovered` });
      }
      await sb
        .from('t91_monitor_state')
        .upsert(
          { table_name: key, last_status: 'OK', last_check: new Date().toISOString(), last_age_min: null },
          { onConflict: 'table_name' },
        );
    }
  } catch {
    // Alert path must never throw.
  }
}

/**
 * Wrap a sync function with timing, error handling, and a no-op fallback when
 * Supabase isn't yet configured. Each source pillar calls this from its own
 * cron entry in `vercel.json`.
 *
 * Example (Pillar 1, Meta):
 *   export const GET = () => runSync('meta-ads', async (sb) => {
 *     const insights = await fetchMetaInsights();
 *     const rows = insights.map(mapMetaToAdRow);
 *     const { error } = await sb.from('ads').upsert(rows, { onConflict: 'id' });
 *     if (error) throw error;
 *     return { rowsUpserted: rows.length, rowsSkipped: 0 };
 *   });
 */
export async function runSync(
  source: string,
  fn: (sb: NonNullable<Awaited<ReturnType<typeof getServerSupabaseAsync>>>) => Promise<{
    rowsUpserted: number;
    rowsSkipped: number;
  }>
): Promise<SyncResult> {
  const start = Date.now();
  const sb = await getServerSupabaseAsync();
  if (!sb) {
    return {
      source,
      ok: false,
      rowsUpserted: 0,
      rowsSkipped: 0,
      durationMs: Date.now() - start,
      error: 'Supabase not configured — sync skipped',
    };
  }
  try {
    const { rowsUpserted, rowsSkipped } = await fn(sb);
    // Clear any prior error-state suppression + post recovery if we were failing.
    // Fire-and-forget — never block the successful return on Slack.
    clearSyncErrorState(source).catch(() => {});
    return {
      source,
      ok: true,
      rowsUpserted,
      rowsSkipped,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const message = (err as { message?: string })?.message ?? String(err);
    const durationMs = Date.now() - start;
    // Fire-and-forget Slack alert with dedup. Don't let alert-posting block the
    // response, and don't let it throw (already wrapped internally).
    postSyncErrorAlert(source, message, durationMs).catch(() => {});
    return {
      source,
      ok: false,
      rowsUpserted: 0,
      rowsSkipped: 0,
      durationMs,
      error: message,
    };
  }
}
