/**
 * GET /api/today/triggers
 *
 * Returns the result of every "exception card" trigger query in a single
 * round-trip. Each card on the /today page is either present (trigger fired)
 * or absent (clean). This endpoint runs all triggers in parallel and returns
 * a structured response the page can iterate over.
 *
 * Per dashboard_build_spec.md — the operator rule: /today is exceptions only.
 * Macro numbers belong on /week and /month. Cashflow summary is the ONLY
 * always-visible item.
 */

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface CardResult {
  key: string;
  title: string;
  severity: 'red' | 'yellow' | 'green' | 'info';
  count: number;
  rows: unknown[];
  notes?: string;
}

export async function GET() {
  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const cards: CardResult[] = [];

  // ─── Cashflow summary (always visible — not an alert) ────────────────────
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const yIso = yest.toISOString().slice(0, 10);

  const [{ data: cashIn }, { data: cashOut }] = await Promise.all([
    sb.from('t07_income_processors').select('final_amount, status').eq('date', yIso).eq('status', 'paid'),
    sb.from('t08_expenses').select('amount').eq('date', yIso),
  ]);

  const cashInTotal = (cashIn ?? []).reduce((s: number, r: { final_amount: number | string }) => s + Number(r.final_amount ?? 0), 0);
  const cashOutTotal = (cashOut ?? []).reduce((s: number, r: { amount: number | string }) => s + Number(r.amount ?? 0), 0);
  const cashflow = {
    yesterday_iso: yIso,
    cash_in: cashInTotal,
    payment_count: (cashIn ?? []).length,
    cash_out: cashOutTotal,
    net: cashInTotal - cashOutTotal,
  };

  // ─── Card: Data syncs failing (t91_monitor_state) ────────────────────────
  const { data: failing } = await sb
    .from('t91_monitor_state')
    .select('table_name, last_status, last_age_min, last_check')
    .neq('last_status', 'OK')
    .order('last_status', { ascending: true });
  if ((failing ?? []).length > 0) {
    cards.push({
      key: 'sync_failing',
      title: 'Data syncs failing',
      severity: 'red',
      count: failing!.length,
      rows: failing!,
    });
  }

  // ─── Card: Unknown-source leads (last 48h) ────────────────────────────────
  const { data: unknownLeads } = await sb
    .from('t01_leads')
    .select('id, name, email, campaign_id, ad_id, created_at')
    .eq('source', 'Unknown')
    .gte('created_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString())
    .order('created_at', { ascending: false });
  if ((unknownLeads ?? []).length > 0) {
    cards.push({
      key: 'unknown_source_leads',
      title: 'Unknown-source leads',
      severity: 'yellow',
      count: unknownLeads!.length,
      rows: unknownLeads!,
      notes: 'Set source inline — writes to t01_leads + t16_overrides',
    });
  }

  // ─── Card: Bookings stuck in Needs Review ────────────────────────────────
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
  const { data: nrBookings } = await sb
    .from('t03_bookings')
    .select('id, name, email, calendar, closer_assigned, date_booked_for, call_outcome_explanation')
    .eq('status', 'Needs Review')
    .lt('date_booked_for', twoDaysAgo)
    .order('date_booked_for', { ascending: false });
  if ((nrBookings ?? []).length > 0) {
    cards.push({
      key: 'bookings_needs_review',
      title: 'Bookings stuck in Needs Review',
      severity: nrBookings!.length > 5 ? 'red' : 'yellow',
      count: nrBookings!.length,
      rows: nrBookings!,
      notes: 'Set status inline — writes to t03_bookings + t16_overrides',
    });
  }

  // ─── Card: Unscored call recordings ──────────────────────────────────────
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const { data: unscored } = await sb
    .from('t04_call_recordings')
    .select('id, call_date, prospect_name, closer_email, grain_url')
    .is('qual_score', null)
    .gte('call_date', threeDaysAgo)
    .order('call_date', { ascending: false });
  if ((unscored ?? []).length > 0) {
    cards.push({
      key: 'unscored_calls',
      title: 'Unscored call recordings',
      severity: 'yellow',
      count: unscored!.length,
      rows: unscored!,
    });
  }

  // ─── Card: Large single expense yesterday (>$2K) ──────────────────────────
  const { data: bigExpenses } = await sb
    .from('t08_expenses')
    .select('id, date, transaction_name, expense_type, amount, card_name')
    .eq('date', yIso)
    .gt('amount', 2000)
    .order('amount', { ascending: false });
  if ((bigExpenses ?? []).length > 0) {
    cards.push({
      key: 'large_expense',
      title: 'Large single expense yesterday',
      severity: 'yellow',
      count: bigExpenses!.length,
      rows: bigExpenses!,
    });
  }

  // ─── Card: Mislabeled expenses (>$1K, suspicious type) ────────────────────
  const { data: mislabeled } = await sb
    .from('t08_expenses')
    .select('id, date, transaction_name, expense_type, amount')
    .eq('date', yIso)
    .gt('amount', 1000)
    .in('expense_type', ['unknown', "personal (shouldn't be there)", 'other']);
  if ((mislabeled ?? []).length > 0) {
    cards.push({
      key: 'mislabeled_expense',
      title: 'Mislabeled expenses yesterday',
      severity: 'yellow',
      count: mislabeled!.length,
      rows: mislabeled!,
    });
  }

  // ─── Card: Closer missed EOD yesterday (Mon-Fri only) ─────────────────────
  const dow = yest.getDay(); // 0=Sun, 6=Sat
  if (dow >= 1 && dow <= 5) {
    const threeDaysAgoDate = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const { data: closers } = await sb
      .from('t90_team_roster')
      .select('email, name, start_date')
      .eq('role', 'closer')
      .eq('active', true)
      .lte('start_date', threeDaysAgoDate);
    const { data: yesterdayEods } = await sb
      .from('t05_eod_reports')
      .select('closer_name')
      .eq('date', yIso);
    const submitted = new Set((yesterdayEods ?? []).map((r: { closer_name: string }) => r.closer_name));
    const missed = (closers ?? []).filter((c: { name: string }) => !submitted.has(c.name));
    if (missed.length > 0) {
      cards.push({
        key: 'missed_eod',
        title: 'Closer missed EOD yesterday',
        severity: 'red',
        count: missed.length,
        rows: missed,
      });
    }
  }

  // ─── Card: Deal closed but not posted in Slack ────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const twoDaysAgoDate = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const { data: recentDeals } = await sb
    .from('t06_deals_closed')
    .select('id, name, email, closer, date_closed, cash_collected, slack_ts')
    .gte('date_closed', sevenDaysAgo)
    .lt('date_closed', twoDaysAgoDate)
    .is('slack_ts', null);
  if ((recentDeals ?? []).length > 0) {
    cards.push({
      key: 'deal_no_slack',
      title: 'Deal closed but not posted in #new-clients',
      severity: 'yellow',
      count: recentDeals!.length,
      rows: recentDeals!,
    });
  }

  // ─── Card: Payment without matched deal (>$500, last 24h, payment_type=new) ──
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: orphanPayments } = await sb
    .from('t07_income_processors')
    .select('id, date, name, email, amount, processor')
    .gte('created_at', dayAgo)
    .is('deal_id', null)
    .eq('payment_type', 'new')
    .gt('amount', 500);
  if ((orphanPayments ?? []).length > 0) {
    cards.push({
      key: 'orphan_payment',
      title: 'Payment without matched deal',
      severity: 'yellow',
      count: orphanPayments!.length,
      rows: orphanPayments!,
    });
  }

  // ─── Card: Zero-call campaign burning spend ──────────────────────────────
  const threeDaysAgoStr = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const { data: zeroCallAds } = await sb
    .from('t02_ads')
    .select('campaign_name, spend, scheduled_calls')
    .gte('date', threeDaysAgoStr);
  if (zeroCallAds && zeroCallAds.length > 0) {
    const byCampaign = new Map<string, { spend: number; calls: number }>();
    for (const r of zeroCallAds as { campaign_name: string; spend: number | string; scheduled_calls: number | string }[]) {
      const key = r.campaign_name ?? '(unknown)';
      const cur = byCampaign.get(key) ?? { spend: 0, calls: 0 };
      cur.spend += Number(r.spend ?? 0);
      cur.calls += Number(r.scheduled_calls ?? 0);
      byCampaign.set(key, cur);
    }
    const triggered = Array.from(byCampaign.entries())
      .filter(([, v]) => v.spend > 500 && v.calls === 0)
      .map(([campaign, v]) => ({ campaign_name: campaign, spend_3d: v.spend, calls: v.calls }));
    if (triggered.length > 0) {
      cards.push({
        key: 'zero_call_campaign',
        title: 'Zero-call campaign burning spend',
        severity: 'red',
        count: triggered.length,
        rows: triggered,
      });
    }
  }

  // ─── Card: Content missing yesterday (Instagram daily target) ────────────
  const { count: igCount } = await sb
    .from('t13_content_instagram')
    .select('id', { count: 'exact', head: true })
    .eq('date', yIso);
  if (dow >= 1 && dow <= 5 && (igCount ?? 0) === 0) {
    cards.push({
      key: 'content_missing',
      title: 'No Instagram content posted yesterday',
      severity: 'yellow',
      count: 1,
      rows: [{ platform: 'Instagram', posts_yesterday: 0, target: 1 }],
    });
  }

  return NextResponse.json({
    cashflow,
    cards,
    all_clear: cards.length === 0,
    generated_at: new Date().toISOString(),
  });
}
