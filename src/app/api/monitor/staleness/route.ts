// Staleness monitor — runs every 30 min via Vercel Cron.
// For each sync table, checks MAX(updated_at) against the expected cadence.
// If a table's latest write is older than 2× its expected cadence, posts an
// alert to the configured ops Slack channel. Dedupes via a small in-memory marker
// written back into Supabase (table `t91_monitor_state`) so we don't spam
// alerts every 30 min for the same ongoing issue — only on state changes
// (OK → STALE, and STALE → RECOVERED).

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { postMessage } from '@/lib/bot/slack';

export const maxDuration = 60;

// Expected cadence per table (the cron that writes it).
// Expressed in minutes. A table is "stale" if last write > 2 × this.
interface Monitor {
  table: string;
  cadenceMin: number;
  cron: string; // human-readable
  timestampColumn: string;
  /**
   * If true, skip the staleness check entirely on weekends (Sat/Sun in UTC).
   * Use for tables that only receive writes on business days — call recordings,
   * EOD reports, etc. Prevents Monday-morning false-positives after a Sunday
   * with zero legitimate activity. the operator 2026-04-20.
   */
  skipWeekends?: boolean;
}

// Monitored tables. MUST include every table that receives scheduled writes.
// Tables intentionally omitted: t16_overrides (user-generated), t17_competitors
// (manual), t90_team_roster (config), t91_monitor_state (internal).
const MONITORS: Monitor[] = [
  { table: 't01_leads',                cadenceMin: 5,       cron: '*/5 * * * *',   timestampColumn: 'updated_at' },
  { table: 't02_ads',                  cadenceMin: 24 * 60, cron: '0 6 * * *',     timestampColumn: 'updated_at' },
  { table: 't03_bookings',             cadenceMin: 120,     cron: '0 */2 * * *',   timestampColumn: 'updated_at' },
  { table: 't04_call_recordings',      cadenceMin: 24 * 60, cron: '0 20 * * *',    timestampColumn: 'call_date',  skipWeekends: true },
  { table: 't05_eod_reports',          cadenceMin: 24 * 60, cron: '0 10 * * *',    timestampColumn: 'updated_at', skipWeekends: true },
  { table: 't06_deals_closed',         cadenceMin: 120,     cron: '30 */2 * * *',  timestampColumn: 'updated_at' },
  { table: 't07_income_processors',    cadenceMin: 120,     cron: '30 */2 * * *',  timestampColumn: 'updated_at' },
  { table: 't08_expenses',             cadenceMin: 24 * 60, cron: '0 8 * * *',     timestampColumn: 'updated_at' },
  { table: 't_client_ledger',          cadenceMin: 24 * 60, cron: '15 6 * * *',    timestampColumn: 'synced_at' },
  // t10_lead_scores dropped 2026-04-23 — redundant with t04.qual_score.
  { table: 't12_content_youtube',      cadenceMin: 24 * 60, cron: '0 9 * * *',     timestampColumn: 'updated_at' },
  { table: 't13_content_instagram',    cadenceMin: 24 * 60, cron: '0 10 * * *',    timestampColumn: 'updated_at' },
  // t14_content_linkedin + t15_content_x intentionally excluded — content sync
  // skipped per the spec 2026-04-23 (no business value, API pain not worth it).
  { table: 't18_manychat_leads',       cadenceMin: 24 * 60, cron: '0 12 * * *',    timestampColumn: 'updated_at' },
  { table: 't19_payment_notis',        cadenceMin: 120,     cron: '15 */2 * * *',  timestampColumn: 'created_at' },
  { table: 't20_slack_new_clients',    cadenceMin: 120,     cron: '15 */2 * * *',  timestampColumn: 'created_at' },
];

interface Check {
  table: string;
  cron: string;
  cadenceMin: number;
  lastWrite: string | null;
  ageMin: number | null;
  status: 'OK' | 'STALE' | 'MISSING';
}

async function runChecks(sb: NonNullable<Awaited<ReturnType<typeof getServerSupabaseAsync>>>): Promise<Check[]> {
  const out: Check[] = [];
  // Business-day gate: UTC getUTCDay() returns 0=Sunday, 6=Saturday.
  // When current day is Sat or Sun, skipWeekends=true tables are treated as
  // "OK by policy" — we don't check them, don't alert, don't mark STALE.
  const dow = new Date().getUTCDay();
  const isWeekend = dow === 0 || dow === 6;

  for (const m of MONITORS) {
    if (m.skipWeekends && isWeekend) {
      out.push({
        table: m.table, cron: m.cron, cadenceMin: m.cadenceMin,
        lastWrite: null, ageMin: null, status: 'OK',
      });
      continue;
    }

    // Use the REST API: select max() via rpc would be cleaner but easier to just order desc limit 1
    const { data, error } = await sb
      .from(m.table)
      .select(m.timestampColumn)
      .order(m.timestampColumn, { ascending: false })
      .limit(1);

    if (error) {
      out.push({ table: m.table, cron: m.cron, cadenceMin: m.cadenceMin, lastWrite: null, ageMin: null, status: 'MISSING' });
      continue;
    }

    const row = (data ?? [])[0] as Record<string, string> | undefined;
    const lastWriteStr = row ? row[m.timestampColumn] : null;
    if (!lastWriteStr) {
      out.push({ table: m.table, cron: m.cron, cadenceMin: m.cadenceMin, lastWrite: null, ageMin: null, status: 'MISSING' });
      continue;
    }

    const lastMs = new Date(lastWriteStr).getTime();
    const ageMin = (Date.now() - lastMs) / 60000;
    // Weekend-skip tables get a 4× tolerance instead of 2× so Fri→Mon gaps
    // don't false-fire (even a 3-day weekend stays under threshold).
    const multiplier = m.skipWeekends ? 4 : 2;
    const status = ageMin > m.cadenceMin * multiplier ? 'STALE' : 'OK';

    out.push({ table: m.table, cron: m.cron, cadenceMin: m.cadenceMin, lastWrite: lastWriteStr, ageMin, status });
  }
  return out;
}

/** Format minutes → "3h 12m" or "45m" for human readability. */
function fmtAge(min: number | null): string {
  if (min == null) return 'never';
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h - d * 24}h`;
}

/** Format cadence minutes → "every 5 min", "every 2h", "daily 09:00 UTC". */
function fmtCadence(cronExpr: string, cadenceMin: number): string {
  if (cadenceMin < 60) return `every ${cadenceMin} min`;
  if (cadenceMin === 60) return 'hourly';
  if (cadenceMin < 24 * 60) return `every ${cadenceMin / 60}h`;
  return `daily (${cronExpr})`;
}

export async function POST() {
  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const checks = await runChecks(sb);
  const stale = checks.filter(c => c.status !== 'OK');

  // Dedupe via t91_monitor_state (one row per table, marks last seen status).
  // On state transition (OK→STALE or STALE→OK), alert. Otherwise silent.
  const alertChannel = process.env.SLACK_OPS_CHANNEL;
  const alerts: string[] = [];
  const recoveries: string[] = [];

  for (const c of checks) {
    const { data: prior } = await sb
      .from('t91_monitor_state')
      .select('last_status')
      .eq('table_name', c.table)
      .maybeSingle();
    const prev = (prior?.last_status ?? 'UNKNOWN') as string;

    // Persist current status (upsert)
    await sb
      .from('t91_monitor_state')
      .upsert(
        { table_name: c.table, last_status: c.status, last_check: new Date().toISOString(), last_age_min: c.ageMin },
        { onConflict: 'table_name' },
      );

    if (c.status === 'STALE' && prev !== 'STALE') alerts.push(c.table);
    if (c.status === 'OK' && prev === 'STALE') recoveries.push(c.table);
  }

  // Post to Slack only on transitions — no spam
  if (alertChannel && (alerts.length > 0 || recoveries.length > 0)) {
    const lines: string[] = [];
    for (const t of alerts) {
      const c = checks.find(x => x.table === t)!;
      lines.push(
        `🔴 *${t}* stale — last write ${fmtAge(c.ageMin)} ago (expected ${fmtCadence(c.cron, c.cadenceMin)})`,
      );
    }
    for (const t of recoveries) {
      lines.push(`✅ *${t}* recovered`);
    }
    lines.push('');
    lines.push(`_Reply in this thread and @mention the bot for help. e.g. "@LS Command Bot why is t01_leads stale?"_`);

    await postMessage({ channel: alertChannel, text: lines.join('\n') });
  }

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    checks,
    alerts,
    recoveries,
    alertsPosted: !!alertChannel && (alerts.length > 0 || recoveries.length > 0),
  });
}

export const GET = POST;
