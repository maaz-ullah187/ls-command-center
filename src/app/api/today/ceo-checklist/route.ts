import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/today/ceo-checklist
 *
 * Single-shot endpoint powering the operator's daily CEO walkthrough at /today.
 * Returns everything needed for one page-load — fast, structured, no second
 * fetches.
 *
 * Sections (per the operator's CEO daily flow PDF, 2026-04-30):
 *   1. yesterdayIncome    — total cash collected yesterday by payment_type
 *                           bucket. Match the Revenue Composition donut's
 *                           t07-driven breakdown so the team's queue work
 *                           is reflected here.
 *   2. yesterdayExpenses  — top expense rows from yesterday + flags (new
 *                           vendor, big-ticket, uncategorized).
 *   3. bookingCapacity    — per-closer booked + shown calls yesterday from
 *                           t05_eod_reports. Flag any closer below the
 *                           6-call threshold (the operator's rule of thumb).
 *   4. organicLeads       — leads from organic sources (YouTube / IG / X /
 *                           LinkedIn / Webinar / Organic) yesterday + last
 *                           7 days. From t01_leads.source via canonSource.
 *   5. salesPerformance   — combined 3-day and 7-day close rates, show
 *                           rates, and per-closer Cash/Call to spot
 *                           underperformers. From t05 EODs + t06 deals.
 *
 * `date` query param overrides "yesterday" for testing. Defaults to local
 * yesterday.
 */

// the operator 2026-04-30: switched from server-local (UTC on Vercel) to ET
// so the dashboard's "today" matches the operator's wall clock. Without this,
// late-evening ET requests would compute "yesterday" as today's date.
import { yesterdayET, daysAgoET } from '@/lib/timeframe';

function yesterdayLocal(): string { return yesterdayET(); }

function daysAgo(days: number): string { return daysAgoET(days); }

function daysInMonth(monthYYYYMM: string): number {
  const [y, m] = monthYYYYMM.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// Same canonicalisation as Cash by Source / Sales Funnel so source labels
// stay consistent across the dashboard.
function canonSource(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return 'Unknown';
  const k = s.toLowerCase();
  if (k === 'unknown') return 'Unknown';
  if (k === 'twitter' || k === 'x' || k === 'x.com' || k === 'twitter/x') return 'X';
  if (k === 'fb' || k === 'facebook' || k === 'meta' || k === 'facebook ads' || k === 'paid' || k === 'paid ads') return 'Facebook Ads';
  if (k === 'yt' || k === 'youtube' || k === 'youtube ads') return 'YouTube';
  if (k === 'ig' || k === 'instagram') return 'Instagram';
  if (k === 'li' || k === 'linkedin') return 'LinkedIn';
  if (k === 'organic' || k === 'seo') return 'Organic';
  if (k === 'referral' || k === 'ref' || k === 'referred') return 'Referral';
  if (k === 'webinar' || k === 'webinars') return 'Webinar';
  if (/^[a-z]+$/i.test(s) && !['email','sms','dm','outbound','inbound','website','direct','affiliate','partner'].includes(k)) return 'Referral';
  return s;
}

const ORGANIC_SOURCES = new Set(['YouTube', 'Instagram', 'LinkedIn', 'X', 'Webinar', 'Organic', 'Referral']);

// the operator 2026-04-30: 7 calls/day = 100% capacity per closer.
// Emergency booking protocol triggers when ANY closer is ≤ 70%
// of their daily capacity over the 4-day window.
const TARGET_CALLS_PER_DAY = 7;
const EMERGENCY_CAPACITY_THRESHOLD_PCT = 70;
// Backwards-compat alias used elsewhere in this file's response payload.
const MIN_BOOKED_PER_DAY = TARGET_CALLS_PER_DAY;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const dateParam = url.searchParams.get('date');
  const yesterday = dateParam || yesterdayLocal();
  const sevenAgo = daysAgo(7);
  const threeAgo = daysAgo(3);

  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ configured: false }, { status: 500 });
  }

  // ── Roster-driven name canonicalisation ─────────────────────────────
  // Same first-name → full-name map used by the Closer Leaderboard so
  // "Closer Three" (from EOD posts) and "Closer Three" (from t06 deals) merge
  // into one row. the operator 2026-04-30: had to apply this to the today
  // checklist too — was showing them as 2 different closers.
  const { data: rosterRows } = await supa
    .from('t90_team_roster')
    .select('name, role, active')
    .eq('active', true);
  const firstWord = (s: string) => s.trim().toLowerCase().split(/\s+/)[0] || '';
  const firstToFull = new Map<string, string>();
  const ambiguousFirst = new Set<string>();
  for (const r of (rosterRows ?? []) as Array<{ name: string | null; role: string | null }>) {
    const full = (r.name ?? '').trim();
    if (!full) continue;
    const fn = firstWord(full);
    if (firstToFull.has(fn) && firstToFull.get(fn) !== full) ambiguousFirst.add(fn);
    else firstToFull.set(fn, full);
  }
  for (const fn of ambiguousFirst) firstToFull.delete(fn);
  const canonName = (raw: string | null | undefined): string => {
    const s = (raw ?? '').trim();
    if (!s) return '';
    return firstToFull.get(firstWord(s)) ?? s;
  };

  const fourteenAgo = daysAgo(14);
  const yMonthKey = yesterday.slice(0, 7); // YYYY-MM

  // Run all queries in parallel.
  const [t07Yesterday, t08Yesterday, t05Yesterday, t01_7d, t05_7d, t06_7d, t07_14d, t21Targets, t08_14d] = await Promise.all([
    supa
      .from('t07_income_processors')
      .select('payment_type, status, final_amount, amount, name, email')
      .eq('date', yesterday),
    supa
      .from('t08_expenses')
      .select('id, transaction_name, amount, expense_type, card_name, notes')
      .eq('date', yesterday)
      .order('amount', { ascending: false })
      .limit(20),
    supa
      .from('t05_eod_reports')
      .select('closer_name, calls_booked, calls_shown, calls_closed, no_shows, calls_cancelled, cash_collected')
      .eq('date', yesterday),
    supa
      .from('t01_leads')
      .select('id, source, date, name, email')
      .gte('date', sevenAgo)
      .limit(20000),
    supa
      .from('t05_eod_reports')
      .select('date, closer_name, calls_booked, calls_shown, calls_closed, no_shows, calls_cancelled, cash_collected')
      .gte('date', sevenAgo)
      .limit(5000),
    supa
      .from('t06_deals_closed')
      .select('date_closed, closer, cash_collected, contracted_revenue, deal_type')
      .gte('date_closed', sevenAgo)
      .limit(5000),
    // Last 14 days of t07 paid + refund rows for the income sparkline.
    supa
      .from('t07_income_processors')
      .select('date, payment_type, status, final_amount, amount')
      .gte('date', fourteenAgo)
      .lte('date', yesterday)
      .limit(20000),
    // Monthly target — same source as Pace vs Projection so the daily
    // pace target matches the rest of the dashboard.
    supa
      .from('t21_monthly_projections')
      .select('section, target_value')
      .eq('month', yMonthKey),
    // Last 14 days of t08 expenses for the trend sparkline (the operator
    // 2026-04-30 option C: keep yesterday's strict filter for the
    // headline AND add a 7-day rolling chart so the wider context is
    // in the same place — no need to flip to /expenses).
    supa
      .from('t08_expenses')
      .select('date, amount, expense_type')
      .gte('date', fourteenAgo)
      .lte('date', yesterday)
      .limit(20000),
  ]);

  // ── 1. Yesterday's income ──────────────────────────────────────────────
  type IncRow = { payment_type: string | null; status: string | null; final_amount: number | string | null; amount: number | string | null; name: string | null; email: string | null };
  const incRows = (t07Yesterday.data ?? []) as IncRow[];
  let newCash = 0, ar = 0, upsellRenewal = 0, mastermind = 0, uncategorized = 0, refunds = 0;
  for (const r of incRows) {
    const ptype = (r.payment_type ?? '').toLowerCase();
    const status = (r.status ?? '').toLowerCase();
    if (ptype === 'excluded') continue;
    const amt = Number(r.final_amount ?? r.amount ?? 0);
    if (status === 'refunded' || ptype === 'refund') {
      refunds += Math.abs(amt);
      continue;
    }
    if (status !== 'paid') continue;
    if (ptype === 'new_client' || ptype === 'new') newCash += amt;
    else if (ptype === 'account_receivable') ar += amt;
    else if (ptype === 'upsell_renewal') upsellRenewal += amt;
    else if (ptype === 'mastermind') mastermind += amt;
    else uncategorized += amt;
  }
  const grossIncome = newCash + ar + upsellRenewal + mastermind + uncategorized;
  const netIncome = grossIncome - refunds;

  // ── 1b. 14-day daily net income (for sparkline + 7-day avg + vs target) ─
  type Inc14 = { date: string; payment_type: string | null; status: string | null; final_amount: number | string | null; amount: number | string | null };
  const inc14 = (t07_14d.data ?? []) as Inc14[];
  // Build the day-by-day net total
  const dailyNet = new Map<string, number>();
  // Initialise all 14 days so days with zero activity render as 0.
  // Use ET — server is UTC and would skew the day boundaries.
  for (let i = 0; i < 14; i += 1) {
    dailyNet.set(daysAgoET(1 + i), 0);
  }
  for (const r of inc14) {
    const ptype = (r.payment_type ?? '').toLowerCase();
    const status = (r.status ?? '').toLowerCase();
    if (ptype === 'excluded') continue;
    if (!dailyNet.has(r.date)) continue;
    const amt = Number(r.final_amount ?? r.amount ?? 0);
    if (status === 'refunded' || ptype === 'refund') {
      dailyNet.set(r.date, dailyNet.get(r.date)! - Math.abs(amt));
    } else if (status === 'paid') {
      dailyNet.set(r.date, dailyNet.get(r.date)! + amt);
    }
  }
  const last14Days = Array.from(dailyNet.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, net]) => ({ date, net }));
  // Trailing 7-day avg = mean of yesterday + 6 prior days
  const last7 = last14Days.slice(-7);
  const trailing7dAvg = last7.length ? last7.reduce((s, p) => s + p.net, 0) / last7.length : 0;

  // ── 1c. Daily target derived from monthly projections ─────────────────
  let monthlyRevTarget = 0;
  let monthlyExpenseCap = 0;
  for (const r of (t21Targets.data ?? []) as Array<{ section: string | null; target_value: number | string | null }>) {
    const sec = (r.section ?? '').toLowerCase();
    const v = Number(r.target_value ?? 0);
    if (sec === 'cash_collected' || sec === 'receivables') monthlyRevTarget += v;
    else if (sec === 'refunds') monthlyRevTarget -= v;
    else if (sec === 'expenses') monthlyExpenseCap += v;
  }
  const dailyTarget = monthlyRevTarget > 0 ? monthlyRevTarget / daysInMonth(yMonthKey) : 0;
  const dailyExpenseTarget = monthlyExpenseCap > 0 ? monthlyExpenseCap / daysInMonth(yMonthKey) : 0;
  const yesterdayVsTarget = dailyTarget > 0 ? netIncome - dailyTarget : 0;
  const yesterdayVs7d = trailing7dAvg > 0 ? netIncome - trailing7dAvg : 0;
  const paceStatus: 'above' | 'on' | 'below' =
    dailyTarget <= 0 ? 'on'
    : netIncome >= dailyTarget * 1.05 ? 'above'
    : netIncome >= dailyTarget * 0.85 ? 'on'
    : 'below';

  // ── 2. Yesterday's expenses ────────────────────────────────────────────
  type ExpRow = { id: string; transaction_name: string | null; amount: number | string | null; expense_type: string | null; card_name: string | null; notes: string | null };
  const expRows = (t08Yesterday.data ?? []) as ExpRow[];
  const expenseTotal = expRows.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  // 14-day expense trajectory (mirror of the income sparkline so the operator
  // can see yesterday in context without leaving /today).
  type Exp14 = { date: string; amount: number | string | null; expense_type: string | null };
  const exp14 = (t08_14d.data ?? []) as Exp14[];
  const dailyExpense = new Map<string, number>();
  // 14-day expense trajectory — use ET so the day boundaries match
  // the operator's wall clock (Vercel runs in UTC).
  for (let i = 0; i < 14; i += 1) {
    dailyExpense.set(daysAgoET(1 + i), 0);
  }
  for (const r of exp14) {
    const cat = (r.expense_type ?? '').toLowerCase();
    // Match the Pace vs Projection convention — skip out-of-scope buckets
    // so the chart reflects operating expenses only.
    if (!cat || cat === 'personal' || cat === "personal (shouldn't be there)" || cat === 'unknown' || cat === 'other') continue;
    if (!dailyExpense.has(r.date)) continue;
    dailyExpense.set(r.date, dailyExpense.get(r.date)! + Number(r.amount ?? 0));
  }
  const last14DaysExpenses = Array.from(dailyExpense.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total }));
  const last7Exp = last14DaysExpenses.slice(-7);
  const trailing7dAvgExpense = last7Exp.length ? last7Exp.reduce((s, p) => s + p.total, 0) / last7Exp.length : 0;
  const yesterdayVsTargetExp = dailyExpenseTarget > 0 ? expenseTotal - dailyExpenseTarget : 0;
  const yesterdayVs7dExp = trailing7dAvgExpense > 0 ? expenseTotal - trailing7dAvgExpense : 0;
  // For expenses, LOW is good — paceStatus inverts vs income.
  const expensePaceStatus: 'under' | 'on' | 'over' =
    dailyExpenseTarget <= 0 ? 'on'
    : expenseTotal <= dailyExpenseTarget * 0.95 ? 'under'
    : expenseTotal <= dailyExpenseTarget * 1.15 ? 'on'
    : 'over';
  // Flag any expense where: (a) expense_type is unknown/personal, (b) > $1k
  // (the operator should eyeball big-ticket expenses), or (c) flagged via notes.
  const flagged = expRows
    .filter((r) => {
      const cat = (r.expense_type ?? '').toLowerCase();
      const amt = Number(r.amount ?? 0);
      return amt >= 1000 || cat === 'unknown' || cat === '' || cat.includes('personal') || cat === 'other';
    })
    .map((r) => ({
      id: r.id,
      vendor: r.transaction_name ?? '?',
      amount: Number(r.amount ?? 0),
      type: r.expense_type ?? 'unknown',
      flag:
        Number(r.amount ?? 0) >= 1000 ? 'big-ticket' :
        (r.expense_type ?? '').toLowerCase().includes('personal') ? 'personal?' :
        'needs-category',
    }));

  // ── 3. Booking capacity (LAST 4 DAYS per-closer) ───────────────────────
  // the operator 2026-04-30: switched from 1 day → 4 days. One day of a closer
  // having 5 calls instead of 6 isn't the end of the world; 4 consecutive
  // days under threshold is a real capacity problem worth running a
  // reactivation campaign for. We also surface average-bookings-per-day
  // per closer + an aggregate "team capacity %" the sales-manager
  // notification can use.
  type EodRow = { closer_name: string | null; calls_booked: number | null; calls_shown: number | null; calls_closed: number | null; no_shows: number | null; calls_cancelled: number | null; cash_collected: number | string | null; date?: string };
  const fourAgoIso = daysAgoET(4);
  // Use the t05_7d query (already pulled) and slice to last 4 days inclusive.
  const eod4dRows = ((t05_7d.data ?? []) as EodRow[]).filter((r) => r.date && r.date >= fourAgoIso && r.date <= yesterday);
  const closerAccum = new Map<string, { booked: number; showed: number; closed: number; noShows: number; cancelled: number; cash: number; daysReporting: Set<string> }>();
  for (const r of eod4dRows) {
    const name = canonName(r.closer_name);
    if (!name) continue;
    if (!closerAccum.has(name)) closerAccum.set(name, { booked: 0, showed: 0, closed: 0, noShows: 0, cancelled: 0, cash: 0, daysReporting: new Set() });
    const ent = closerAccum.get(name)!;
    ent.booked += Number(r.calls_booked ?? 0);
    ent.showed += Number(r.calls_shown ?? 0);
    ent.closed += Number(r.calls_closed ?? 0);
    ent.noShows += Number(r.no_shows ?? 0);
    ent.cancelled += Number(r.calls_cancelled ?? 0);
    ent.cash += Number(r.cash_collected ?? 0);
    if (r.date) ent.daysReporting.add(r.date);
  }
  const WINDOW_DAYS = 4;
  const closersYesterday = Array.from(closerAccum.entries())
    .map(([closer, v]) => {
      const trueBooked = v.booked - v.cancelled;
      const showRate = trueBooked > 0 ? (v.showed / trueBooked) * 100 : 0;
      const closeRate = v.showed > 0 ? (v.closed / v.showed) * 100 : 0;
      const cancelRate = v.booked > 0 ? (v.cancelled / v.booked) * 100 : 0;
      const daysReporting = v.daysReporting.size || 1;
      const avgBookedPerDay = v.booked / daysReporting;
      // capacityPct: per-closer running rate vs the 7-call/day target.
      // the operator 2026-04-30: emergency protocol fires when ANY closer
      // sits ≤ 70% across the rolling 4-day window.
      const capacityPct = TARGET_CALLS_PER_DAY > 0
        ? (avgBookedPerDay / TARGET_CALLS_PER_DAY) * 100
        : 0;
      return {
        closer,
        booked: v.booked,
        showed: v.showed,
        closed: v.closed,
        noShows: v.noShows,
        cancelled: v.cancelled,
        cash: v.cash,
        showRate,
        closeRate,
        cancelRate,
        avgBookedPerDay,
        capacityPct,
        daysReporting,
        belowCapacity: capacityPct <= EMERGENCY_CAPACITY_THRESHOLD_PCT,
      };
    })
    .sort((a, b) => a.capacityPct - b.capacityPct); // worst first so eyes land on the problem
  const closersBelowCapacity = closersYesterday.filter((c) => c.belowCapacity).length;
  const totalBookedYesterday = closersYesterday.reduce((s, c) => s + c.booked, 0);
  const totalShowedYesterday = closersYesterday.reduce((s, c) => s + c.showed, 0);
  // Team capacity % = avg bookings/day across team ÷ 7. Used by the
  // sales-manager Slack notification to give a concrete number.
  const totalDaysReportingTeam = closersYesterday.reduce((s, c) => s + c.daysReporting, 0);
  const teamAvgBookedPerDay = totalDaysReportingTeam > 0 ? totalBookedYesterday / totalDaysReportingTeam : 0;
  const teamCapacityPct = TARGET_CALLS_PER_DAY > 0 ? (teamAvgBookedPerDay / TARGET_CALLS_PER_DAY) * 100 : 0;

  // ── 4. Organic leads (yesterday + last 7 days, by source) ──────────────
  type LeadRow = { id: string; source: string | null; date: string; name: string | null; email: string | null };
  const leadRows = (t01_7d.data ?? []) as LeadRow[];
  const leadsByDay = new Map<string, Map<string, number>>();
  for (const l of leadRows) {
    const src = canonSource(l.source);
    if (!ORGANIC_SOURCES.has(src)) continue;
    const date = l.date.slice(0, 10);
    if (!leadsByDay.has(date)) leadsByDay.set(date, new Map());
    const inner = leadsByDay.get(date)!;
    inner.set(src, (inner.get(src) ?? 0) + 1);
  }
  const organicYesterday = new Map<string, number>();
  const organic7d = new Map<string, number>();
  let organicYesterdayTotal = 0;
  let organic7dTotal = 0;
  for (const [date, counts] of leadsByDay) {
    for (const [src, n] of counts) {
      organic7d.set(src, (organic7d.get(src) ?? 0) + n);
      organic7dTotal += n;
      if (date === yesterday) {
        organicYesterday.set(src, (organicYesterday.get(src) ?? 0) + n);
        organicYesterdayTotal += n;
      }
    }
  }
  const organicByPlatform = Array.from(new Set([...organicYesterday.keys(), ...organic7d.keys()]))
    .map((src) => ({
      source: src,
      yesterday: organicYesterday.get(src) ?? 0,
      last7d: organic7d.get(src) ?? 0,
    }))
    .sort((a, b) => b.last7d - a.last7d);

  // ── 5. Sales performance (3-day + 7-day rolling) ───────────────────────
  const eod7d = (t05_7d.data ?? []) as EodRow[];
  type DealRow = { date_closed: string; closer: string | null; cash_collected: number | string | null; contracted_revenue: number | string | null; deal_type: string | null };
  const deals7d = (t06_7d.data ?? []) as DealRow[];

  function rollupRange(fromDate: string) {
    const inRange = eod7d.filter((e) => e.date && e.date >= fromDate);
    const booked = inRange.reduce((s, e) => s + Number(e.calls_booked ?? 0), 0);
    const showed = inRange.reduce((s, e) => s + Number(e.calls_shown ?? 0), 0);
    const noShows = inRange.reduce((s, e) => s + Number(e.no_shows ?? 0), 0);
    const cancelled = inRange.reduce((s, e) => s + Number(e.calls_cancelled ?? 0), 0);
    const closed = inRange.reduce((s, e) => s + Number(e.calls_closed ?? 0), 0);
    const cashFromDeals = deals7d.filter((d) => d.date_closed >= fromDate).reduce((s, d) => s + Number(d.cash_collected ?? 0), 0);
    // Show rate per the spec 2026-04-30: shown / (booked - cancelled).
    const trueBooked = booked - cancelled;
    const showRate = trueBooked > 0 ? (showed / trueBooked) * 100 : 0;
    const closeRate = showed > 0 ? (closed / showed) * 100 : 0;
    return { showed, noShows, cancelled, closed, cashCollected: cashFromDeals, showRate, closeRate };
  }
  const last3d = rollupRange(threeAgo);
  const last7d = rollupRange(sevenAgo);

  // Per-closer Cash/Call across the last 7 days — flags underperformers.
  // Names normalised through the same first-name canonicaliser so Closer Three +
  // Closer Three merge into the roster's canonical "Closer Three" entry.
  const perCloser = new Map<string, { showed: number; cash: number }>();
  for (const e of eod7d) {
    const name = canonName(e.closer_name);
    if (!name) continue;
    if (!perCloser.has(name)) perCloser.set(name, { showed: 0, cash: 0 });
    const ent = perCloser.get(name)!;
    ent.showed += Number(e.calls_shown ?? 0);
  }
  for (const d of deals7d) {
    const name = canonName(d.closer);
    if (!name) continue;
    if (!perCloser.has(name)) perCloser.set(name, { showed: 0, cash: 0 });
    perCloser.get(name)!.cash += Number(d.cash_collected ?? 0);
  }
  const perCloserCashCall = Array.from(perCloser.entries())
    .map(([closer, v]) => ({
      closer,
      showed: v.showed,
      cash: v.cash,
      cashPerCall: v.showed > 0 ? Math.round(v.cash / v.showed) : 0,
    }))
    .sort((a, b) => b.cashPerCall - a.cashPerCall);

  // ── Response ──────────────────────────────────────────────────────────
  return NextResponse.json(
    {
      configured: true,
      yesterday,
      sevenAgo,
      threeAgo,
      yesterdayIncome: {
        newCash, ar, upsellRenewal, mastermind, uncategorized, refunds,
        grossIncome, netIncome,
        // 14-day trajectory + comparisons (the operator 2026-04-30: "I need to
        // know if yesterday was on track or off track at a glance"):
        last14Days,
        trailing7dAvg,
        dailyTarget,
        monthlyRevTarget,
        yesterdayVsTarget,
        yesterdayVs7d,
        paceStatus,
      },
      yesterdayExpenses: {
        total: expenseTotal,
        rowCount: expRows.length,
        flaggedCount: flagged.length,
        flagged,
        all: expRows.map((r) => ({
          id: r.id,
          vendor: r.transaction_name,
          amount: Number(r.amount ?? 0),
          type: r.expense_type,
          card: r.card_name,
        })),
        // 14-day trajectory (the operator 2026-04-30 option C):
        last14Days: last14DaysExpenses,
        trailing7dAvg: trailing7dAvgExpense,
        dailyTarget: dailyExpenseTarget,
        monthlyExpenseCap,
        yesterdayVsTarget: yesterdayVsTargetExp,
        yesterdayVs7d: yesterdayVs7dExp,
        paceStatus: expensePaceStatus,
      },
      bookingCapacity: {
        threshold: MIN_BOOKED_PER_DAY,                              // 7 calls/day = 100% capacity
        emergencyThresholdPct: EMERGENCY_CAPACITY_THRESHOLD_PCT,    // ≤ 70% triggers protocol
        windowDays: WINDOW_DAYS,
        windowFrom: fourAgoIso,
        windowTo: yesterday,
        closersBelowCapacity,
        totalBooked: totalBookedYesterday,
        totalShowed: totalShowedYesterday,
        teamAvgBookedPerDay,
        teamCapacityPct,
        closers: closersYesterday,
      },
      organicLeads: {
        yesterdayTotal: organicYesterdayTotal,
        last7dTotal: organic7dTotal,
        byPlatform: organicByPlatform,
      },
      salesPerformance: {
        last3d,
        last7d,
        perCloserCashCall,
      },
    },
    {
      headers: { 'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate' },
    }
  );
}
