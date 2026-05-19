import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/week/checklist?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Powers the simplified weekly CEO checklist at /week. the operator's weekly
 * non-negotiables PDF + earlier dashboard discussions narrowed the
 * scope to 5 sections that the dashboard can actually answer (the
 * personal/admin sections like "inbox", "calendar planning",
 * "workouts" stay out — those aren't dashboard data).
 *
 * Sections returned (matches the Google Doc spec dated 2026-04-30):
 *   1. revenueCheck     — this week vs last week vs target (cash, profit,
 *                         margin, WoW delta) — "Did we win the week?"
 *   2. trends           — 4-week rolling rollup: show rate, close rate,
 *                         lead-volume-by-source per week. "Is the engine
 *                         speeding up or slowing down?"
 *   3. leaks            — refund rate, cancel-rate offenders, organic
 *                         channels under 14/wk, categorization debt,
 *                         lowest-cash/call streak. "Where's the leak?"
 *   4. people           — top performer, lowest performer, at-risk client
 *                         placeholder. "Three names."
 *   5. salesTeam        — kept for backward-compat: full closer/CSM/setter
 *                         leaderboard + combined Show%/Close% pills
 *   6. organicChannels  — kept for backward-compat: per-channel actual
 *                         vs 14/wk target
 *
 * Strategic-reflection prose answers ("the one decision") live entirely
 * client-side in localStorage — no API endpoint needed for v1.
 */

// the operator 2026-04-30: use ET helpers — server is UTC and was rolling
// "today" into tomorrow during evening ET, breaking the week boundary.
import { daysAgoET } from '@/lib/timeframe';

function lastFullWeek(): { from: string; to: string } {
  // the operator's mental model: "the 7 days ending yesterday" in ET.
  return { from: daysAgoET(7), to: daysAgoET(1) };
}

function priorWeek(thisFrom: string, thisTo: string): { from: string; to: string } {
  // Anchor at noon UTC so DST shifts don't flip the day.
  const f = new Date(thisFrom + 'T12:00:00Z');
  f.setUTCDate(f.getUTCDate() - 7);
  const t = new Date(thisTo + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() - 7);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return {
    from: `${f.getUTCFullYear()}-${pad(f.getUTCMonth() + 1)}-${pad(f.getUTCDate())}`,
    to: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
  };
}

// Same canonSource used in Cash by Source / Sales Funnel / Today.
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

// the operator's organic channel targets per his daily non-negotiables PDF +
// weekly PDF: 2 bookings/day per channel = 14/week.
const ORGANIC_CHANNELS: Array<{ source: string; weeklyTarget: number }> = [
  { source: 'Instagram', weeklyTarget: 14 },
  { source: 'YouTube',   weeklyTarget: 14 },
  { source: 'LinkedIn',  weeklyTarget: 14 }, // LI + X combined target was 2/day
  { source: 'X',         weeklyTarget: 14 },
  { source: 'Webinar',   weeklyTarget: 0  }, // no specific weekly target
  { source: 'Referral',  weeklyTarget: 0  },
  { source: 'Organic',   weeklyTarget: 0  },
];

// Combined-team weekly targets from the daily PDF (3+7 day rolling).
const COMBINED_CLOSE_RATE_TARGET = 25; // percent — ProgB threshold
const COMBINED_SHOW_RATE_TARGET = 70;  // percent

// Leak thresholds (defaults from the Google-Doc spec — the operator didn't
// override, so accept the defaults).
const REFUND_RATE_RED_PCT = 5;        // percent of gross
const CANCEL_RATE_RED_PCT = 30;       // percent of booked
const WOW_DROP_ALERT_PCT = 30;        // percent — flag any source with WoW drop ≥ this
const LOWEST_STREAK_TRIGGER = 2;      // weeks — flag if same closer is lowest cash/call N weeks running
const TREND_WINDOW_WEEKS = 4;         // 4-week rolling for the trend section

// Helper — produce N week-windows ending at `to`, oldest first.
function rollingWeeks(to: string, weeks: number): Array<{ from: string; to: string; label: string }> {
  const out: Array<{ from: string; to: string; label: string }> = [];
  // Anchor at noon UTC so DST shifts don't bump the day boundary.
  const toDate = new Date(to + 'T12:00:00Z');
  const pad = (n: number) => n.toString().padStart(2, '0');
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const t = new Date(toDate);
    t.setUTCDate(t.getUTCDate() - 7 * i);
    const f = new Date(t);
    f.setUTCDate(f.getUTCDate() - 6); // 7-day inclusive window
    out.push({
      from: fmt(f),
      to: fmt(t),
      label: i === 0 ? 'this' : i === 1 ? 'prior' : `−${i}w`,
    });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const def = lastFullWeek();
  const from = fromParam || def.from;
  const to = toParam || def.to;
  const prior = priorWeek(from, to);

  const supa = await getServerSupabaseAsync();
  if (!supa) return NextResponse.json({ configured: false }, { status: 500 });

  // Pull roster for closer/CSM/setter classification + Closer Three canon.
  const { data: rosterRows } = await supa
    .from('t90_team_roster')
    .select('name, role, active')
    .eq('active', true);
  const firstWord = (s: string) => s.trim().toLowerCase().split(/\s+/)[0] || '';
  const firstToFull = new Map<string, { name: string; role: string }>();
  const ambig = new Set<string>();
  for (const r of (rosterRows ?? []) as Array<{ name: string | null; role: string | null }>) {
    const full = (r.name ?? '').trim();
    if (!full) continue;
    const fn = firstWord(full);
    const role = (r.role ?? 'closer').toLowerCase();
    if (firstToFull.has(fn) && firstToFull.get(fn)!.name !== full) ambig.add(fn);
    else firstToFull.set(fn, { name: full, role });
  }
  for (const fn of ambig) firstToFull.delete(fn);
  const canonName = (raw: string | null | undefined): { name: string; role: 'closer' | 'csm' | 'setter' } => {
    const s = (raw ?? '').trim();
    if (!s) return { name: '', role: 'closer' };
    const e = firstToFull.get(firstWord(s));
    if (e) {
      const role = e.role === 'account_manager' ? 'csm' : e.role === 'setter' ? 'setter' : 'closer';
      return { name: e.name, role };
    }
    return { name: s, role: 'closer' };
  };

  // Build the 28-day window so the 4-week trend section gets a single
  // round-trip per table and we bucket client-side.
  const weeks = rollingWeeks(to, TREND_WINDOW_WEEKS);
  const trendFrom = weeks[0].from;

  // Parallel queries for current + prior week + 4-week trend window.
  const [t07This, t07Prior, t08This, t08Prior, t05Trend, t06Trend, t01Trend, t21Targets] = await Promise.all([
    supa.from('t07_income_processors').select('date, payment_type, status, final_amount, amount').gte('date', from).lte('date', to).limit(20000),
    supa.from('t07_income_processors').select('date, payment_type, status, final_amount, amount').gte('date', prior.from).lte('date', prior.to).limit(20000),
    supa.from('t08_expenses').select('id, date, amount, expense_type, transaction_name, card_name, card_last_four, notes').gte('date', from).lte('date', to).limit(20000),
    supa.from('t08_expenses').select('date, amount, expense_type').gte('date', prior.from).lte('date', prior.to).limit(20000),
    // Trend queries cover the full 28-day window — bucketed client-side
    // so we don't hit Supabase 4× for what's essentially one timespan.
    supa.from('t05_eod_reports').select('date, closer_name, calls_booked, calls_shown, calls_closed, no_shows, calls_cancelled, cash_collected').gte('date', trendFrom).lte('date', to).limit(20000),
    supa.from('t06_deals_closed').select('date_closed, closer, cash_collected, contracted_revenue, deal_type, source').gte('date_closed', trendFrom).lte('date_closed', to).limit(20000),
    supa.from('t01_leads').select('source, date').gte('date', trendFrom).lte('date', to).limit(50000),
    supa.from('t21_monthly_projections').select('section, metric, target_value').eq('month', from.slice(0, 7)),
  ]);

  // Slice trend queries down to current + prior week for the existing
  // section logic (keeps backwards-compat with revenueCheck/salesTeam).
  type EodRow0 = { date: string; closer_name: string | null; calls_booked: number | null; calls_shown: number | null; calls_closed: number | null; no_shows: number | null; calls_cancelled: number | null; cash_collected: number | string | null };
  type DealRow0 = { date_closed: string; closer: string | null; cash_collected: number | string | null; contracted_revenue: number | string | null; deal_type: string | null; source: string | null };
  type LeadRow0 = { source: string | null; date: string };
  const allEod = (t05Trend.data ?? []) as EodRow0[];
  const allDeals = (t06Trend.data ?? []) as DealRow0[];
  const allLeads = (t01Trend.data ?? []) as LeadRow0[];
  const inWindow = (d: string, f: string, t: string) => d >= f && d <= t;
  const t05This = { data: allEod.filter((r) => inWindow(r.date, from, to)) };
  const t05Prior = { data: allEod.filter((r) => inWindow(r.date, prior.from, prior.to)) };
  const t06This = { data: allDeals.filter((r) => inWindow(r.date_closed, from, to)) };
  const t06Prior = { data: allDeals.filter((r) => inWindow(r.date_closed, prior.from, prior.to)) };
  const t01This = { data: allLeads.filter((r) => inWindow(r.date, from, to)) };
  const t01Prior = { data: allLeads.filter((r) => inWindow(r.date, prior.from, prior.to)) };

  // ── Helper: aggregate t07 net revenue ─────────────────────────────────
  type IncRow = { date: string; payment_type: string | null; status: string | null; final_amount: number | string | null; amount: number | string | null };
  function aggIncome(rows: IncRow[]) {
    let newCash = 0, ar = 0, upsellRenewal = 0, mastermind = 0, refunds = 0, uncategorized = 0;
    let uncategorizedCount = 0;
    for (const r of rows) {
      const ptype = (r.payment_type ?? '').toLowerCase();
      const status = (r.status ?? '').toLowerCase();
      if (ptype === 'excluded') continue;
      const amt = Number(r.final_amount ?? r.amount ?? 0);
      if (status === 'refunded' || ptype === 'refund') { refunds += Math.abs(amt); continue; }
      if (status !== 'paid') continue;
      if (ptype === 'new_client' || ptype === 'new') newCash += amt;
      else if (ptype === 'account_receivable') ar += amt;
      else if (ptype === 'upsell_renewal') upsellRenewal += amt;
      else if (ptype === 'mastermind') mastermind += amt;
      else { uncategorized += amt; uncategorizedCount += 1; }
    }
    const gross = newCash + ar + upsellRenewal + mastermind + uncategorized;
    return { newCash, ar, upsellRenewal, mastermind, refunds, uncategorized, uncategorizedCount, gross, net: gross - refunds };
  }

  function aggExpense(rows: Array<{ amount: number | string | null; expense_type: string | null }>) {
    let total = 0;
    let uncategorizedCount = 0;
    const byCategory: Record<string, number> = {};
    for (const r of rows) {
      const cat = (r.expense_type ?? '').toLowerCase();
      if (!cat || cat === 'unknown' || cat === 'other') { uncategorizedCount += 1; continue; }
      if (cat === 'personal' || cat === "personal (shouldn't be there)") continue;
      const amt = Number(r.amount ?? 0);
      total += amt;
      // Bucket by t21 expense category names: marketing, labour, overhead, coaching.
      // Map t08's "labour" to t21's "Labor / Program Coaches" and t08's
      // category names to t21 sections so the per-category-vs-target
      // check aligns. Done by lowercasing both sides and remapping.
      const key = cat === 'labour' ? 'labour'
        : cat === 'marketing' ? 'marketing'
        : cat === 'overhead' ? 'overhead'
        : cat === 'coaching' ? 'coaching'
        : 'other';
      byCategory[key] = (byCategory[key] ?? 0) + amt;
    }
    return { total, uncategorizedCount, byCategory };
  }

  const incomeThis = aggIncome((t07This.data ?? []) as IncRow[]);
  const incomePrior = aggIncome((t07Prior.data ?? []) as IncRow[]);
  const expenseThisAgg = aggExpense((t08This.data ?? []) as Array<{ amount: number | string | null; expense_type: string | null }>);
  const expensePriorAgg = aggExpense((t08Prior.data ?? []) as Array<{ amount: number | string | null; expense_type: string | null }>);
  const expenseThis = expenseThisAgg.total;
  const expensePrior = expensePriorAgg.total;

  // ── Targets (from t21) — split by section so we can flag the
  //                        constraint (cash vs AR) per the operator's spec.
  let monthlyCashTarget = 0;
  let monthlyArTarget = 0;
  let monthlyRefundOffset = 0;
  let monthlyExpenseCap = 0;
  const monthlyExpenseByCategory: Record<string, number> = {};
  for (const r of (t21Targets.data ?? []) as Array<{ section: string | null; metric: string | null; target_value: number | string | null }>) {
    const sec = (r.section ?? '').toLowerCase();
    const v = Number(r.target_value ?? 0);
    if (sec === 'cash_collected') monthlyCashTarget += v;
    else if (sec === 'receivables') monthlyArTarget += v;
    else if (sec === 'refunds') monthlyRefundOffset += v;
    else if (sec === 'expenses') {
      monthlyExpenseCap += v;
      // Map t21 metric → t08 expense_type bucket so we can compare apples-to-apples.
      const m = (r.metric ?? '').toLowerCase();
      const bucket = m.includes('labor') || m.includes('labour') ? 'labour'
        : m.includes('marketing') ? 'marketing'
        : m.includes('overhead') ? 'overhead'
        : m.includes('coaching') ? 'coaching'
        : 'other';
      monthlyExpenseByCategory[bucket] = (monthlyExpenseByCategory[bucket] ?? 0) + v;
    }
  }
  const monthlyRevTarget = monthlyCashTarget + monthlyArTarget - monthlyRefundOffset;
  // Weekly targets = monthly / 4.33 (avg weeks per month)
  const weeklyCashTarget = monthlyCashTarget / 4.33;
  const weeklyArTarget = monthlyArTarget / 4.33;
  const weeklyRevTarget = monthlyRevTarget / 4.33;
  const weeklyExpenseTarget = monthlyExpenseCap / 4.33;
  const weeklyProfitTarget = (monthlyRevTarget - monthlyExpenseCap) / 4.33;
  const weeklyExpenseByCategory: Record<string, number> = Object.fromEntries(
    Object.entries(monthlyExpenseByCategory).map(([k, v]) => [k, v / 4.33])
  );

  const profitThis = incomeThis.net - expenseThis;
  const profitPrior = incomePrior.net - expensePrior;

  // ── Sales team performance ───────────────────────────────────────────
  type EodRow = { date: string; closer_name: string | null; calls_booked: number | null; calls_shown: number | null; calls_closed: number | null; no_shows: number | null; calls_cancelled: number | null; cash_collected: number | string | null };
  type DealRow = { date_closed: string; closer: string | null; cash_collected: number | string | null; contracted_revenue: number | string | null; deal_type: string | null; source: string | null };
  const eodThis = (t05This.data ?? []) as EodRow[];
  const dealsThis = (t06This.data ?? []) as DealRow[];

  // Per-closer rollup (canon-merged)
  const closerMap = new Map<string, { role: 'closer' | 'csm' | 'setter'; booked: number; showed: number; closed: number; noShows: number; cancelled: number; cash: number; contracted: number; upsells: number }>();
  for (const e of eodThis) {
    const { name, role } = canonName(e.closer_name);
    if (!name) continue;
    if (!closerMap.has(name)) closerMap.set(name, { role, booked: 0, showed: 0, closed: 0, noShows: 0, cancelled: 0, cash: 0, contracted: 0, upsells: 0 });
    const ent = closerMap.get(name)!;
    ent.booked += Number(e.calls_booked ?? 0);
    ent.showed += Number(e.calls_shown ?? 0);
    ent.closed += Number(e.calls_closed ?? 0);
    ent.noShows += Number(e.no_shows ?? 0);
    ent.cancelled += Number(e.calls_cancelled ?? 0);
  }
  for (const d of dealsThis) {
    const { name, role } = canonName(d.closer);
    if (!name) continue;
    if (!closerMap.has(name)) closerMap.set(name, { role, booked: 0, showed: 0, closed: 0, noShows: 0, cancelled: 0, cash: 0, contracted: 0, upsells: 0 });
    const ent = closerMap.get(name)!;
    ent.cash += Number(d.cash_collected ?? 0);
    ent.contracted += Number(d.contracted_revenue ?? 0);
    if ((d.deal_type ?? '').toLowerCase() === 'upsell' || (d.deal_type ?? '').toLowerCase() === 'renewal' || (d.deal_type ?? '').toLowerCase() === 'upgrade') ent.upsells += 1;
  }
  // Show Rate formula per the spec 2026-04-30:
  //   trueBooked = booked - cancelled  (cancellations don't count against the rep)
  //   showRate   = shown / trueBooked
  // (Previous formula counted cancellations in the denominator — under-stated rate.)
  const teamRows = Array.from(closerMap.entries())
    // Drop names not on the roster — The Operator (CEO) was bleeding
    // into the closers list because t06 had deals attributed to him.
    // canonName falls through to role='closer' for unknown names; we
    // need the stricter "must exist in firstToFull" check.
    .filter(([name]) => firstToFull.has(firstWord(name)))
    .map(([name, v]) => {
      const trueBooked = v.booked - v.cancelled;
      return {
        name,
        role: v.role,
        booked: v.booked,
        showed: v.showed,
        closed: v.closed,
        noShows: v.noShows,
        cancelled: v.cancelled,
        cash: v.cash,
        contracted: v.contracted,
        upsells: v.upsells,
        trueBooked,
        showRate: trueBooked > 0 ? (v.showed / trueBooked) * 100 : 0,
        closeRate: v.showed > 0 ? (v.closed / v.showed) * 100 : 0,
        cashPerCall: v.showed > 0 ? Math.round(v.cash / v.showed) : 0,
      };
    });
  // Combined team show/close rates this week
  const totalBooked = teamRows.reduce((s, r) => s + r.booked, 0);
  const totalShowed = teamRows.reduce((s, r) => s + r.showed, 0);
  const totalCancelled = teamRows.reduce((s, r) => s + r.cancelled, 0);
  const totalClosed = teamRows.reduce((s, r) => s + r.closed, 0);
  const combinedTrueBooked = totalBooked - totalCancelled;
  const combinedShowRate = combinedTrueBooked > 0
    ? (totalShowed / combinedTrueBooked) * 100
    : 0;
  const combinedCloseRate = totalShowed > 0 ? (totalClosed / totalShowed) * 100 : 0;

  // ── Organic channel targets ──────────────────────────────────────────
  type LeadRow = { source: string | null; date: string };
  const leadsThis = (t01This.data ?? []) as LeadRow[];
  const leadsByChannel = new Map<string, number>();
  for (const l of leadsThis) {
    const src = canonSource(l.source);
    leadsByChannel.set(src, (leadsByChannel.get(src) ?? 0) + 1);
  }
  const organicCheck = ORGANIC_CHANNELS.map((c) => ({
    source: c.source,
    weeklyTarget: c.weeklyTarget,
    actual: leadsByChannel.get(c.source) ?? 0,
    pctOfTarget: c.weeklyTarget > 0 ? ((leadsByChannel.get(c.source) ?? 0) / c.weeklyTarget) * 100 : null,
  }));

  // ── Organic per-platform revenue ─────────────────────────────────────
  // the operator's checklist: for each organic platform we want bookings
  // (lead count) AND $ generated (cash collected from deals attributed
  // to that source). YouTube / IG / LI / X / Webinar / Referral / Organic.
  const cashBySource = new Map<string, number>();
  const dealsBySource = new Map<string, number>();
  for (const d of dealsThis) {
    const src = canonSource(d.source);
    cashBySource.set(src, (cashBySource.get(src) ?? 0) + Number(d.cash_collected ?? 0));
    dealsBySource.set(src, (dealsBySource.get(src) ?? 0) + 1);
  }
  // Same for prior week so we can show direction.
  const cashBySourcePrior = new Map<string, number>();
  for (const d of (t06Prior.data ?? []) as DealRow0[]) {
    const src = canonSource(d.source);
    cashBySourcePrior.set(src, (cashBySourcePrior.get(src) ?? 0) + Number(d.cash_collected ?? 0));
  }
  const ORGANIC_PLATFORMS_WITH_REVENUE = ['YouTube', 'Instagram', 'LinkedIn', 'X', 'Webinar', 'Referral', 'Organic'];
  const organicByPlatform = ORGANIC_PLATFORMS_WITH_REVENUE.map((p) => {
    const bookings = leadsByChannel.get(p) ?? 0;
    const cash = cashBySource.get(p) ?? 0;
    const cashPrior = cashBySourcePrior.get(p) ?? 0;
    const deals = dealsBySource.get(p) ?? 0;
    return {
      platform: p,
      bookings,
      bookingsTarget: 14,
      bookingsOnTarget: bookings >= 14,
      cash,
      cashPrior,
      cashWoWDelta: cash - cashPrior,
      deals,
    };
  });

  // ── 4-week rolling trends ────────────────────────────────────────────
  // For each of the 4 windows: show rate, close rate, total leads,
  // and per-source lead counts. Bucketed client-side from the 28-day pulls.
  type TrendWeek = {
    from: string; to: string; label: string;
    showed: number; noShows: number; cancelled: number;
    closed: number; showRate: number; closeRate: number;
    leadTotal: number;
    leadBySource: Record<string, number>;
    netCash: number;
  };
  const trendWeeks: TrendWeek[] = weeks.map((w) => {
    let booked = 0, showed = 0, noShows = 0, cancelled = 0, closed = 0;
    for (const e of allEod) {
      if (!inWindow(e.date, w.from, w.to)) continue;
      booked += Number(e.calls_booked ?? 0);
      showed += Number(e.calls_shown ?? 0);
      noShows += Number(e.no_shows ?? 0);
      cancelled += Number(e.calls_cancelled ?? 0);
      closed += Number(e.calls_closed ?? 0);
    }
    // the operator 2026-04-30: show rate is shown / (booked − cancelled).
    const trueBooked = booked - cancelled;
    const showRate = trueBooked > 0 ? (showed / trueBooked) * 100 : 0;
    const closeRate = showed > 0 ? (closed / showed) * 100 : 0;

    let leadTotal = 0;
    const leadBySource: Record<string, number> = {};
    for (const l of allLeads) {
      if (!inWindow(l.date, w.from, w.to)) continue;
      leadTotal += 1;
      const src = canonSource(l.source);
      leadBySource[src] = (leadBySource[src] ?? 0) + 1;
    }

    // Net cash per week — useful for the headline sparkline.
    let weekNet = 0;
    if (w.label === 'this') weekNet = incomeThis.net;
    else if (w.label === 'prior') weekNet = incomePrior.net;
    else {
      // Re-derive from the t07 query for older weeks isn't free — we
      // skipped pulling 4 weeks of t07 to keep the query budget bounded.
      // Headline sparkline is only this+prior; older bars stay 0 in v1.
      weekNet = 0;
    }

    return {
      from: w.from, to: w.to, label: w.label,
      showed, noShows, cancelled, closed,
      showRate, closeRate,
      leadTotal, leadBySource,
      netCash: weekNet,
    };
  });

  // WoW source drops worth flagging — compare last week (index -1) to
  // the week before it (index -2).
  const sourceDrops: Array<{ source: string; thisWeek: number; priorWeek: number; dropPct: number }> = [];
  if (trendWeeks.length >= 2) {
    const cur = trendWeeks[trendWeeks.length - 1];
    const prv = trendWeeks[trendWeeks.length - 2];
    const allSources = new Set([...Object.keys(cur.leadBySource), ...Object.keys(prv.leadBySource)]);
    for (const s of allSources) {
      const a = prv.leadBySource[s] ?? 0;
      const b = cur.leadBySource[s] ?? 0;
      if (a < 3) continue; // ignore noise — need ≥3 prior-week leads to flag a drop
      const dropPct = ((a - b) / a) * 100;
      if (dropPct >= WOW_DROP_ALERT_PCT) sourceDrops.push({ source: s, thisWeek: b, priorWeek: a, dropPct });
    }
    sourceDrops.sort((x, y) => y.dropPct - x.dropPct);
  }

  // ── Leak diagnosis ───────────────────────────────────────────────────
  // Cancel-rate offenders: any closer with cancel rate > 30% AND ≥ 5 booked.
  const cancelOffenders = teamRows
    .filter((r) => r.role === 'closer' && r.booked >= 5 && (r.cancelled / r.booked) * 100 > CANCEL_RATE_RED_PCT)
    .map((r) => ({ name: r.name, booked: r.booked, cancelled: r.cancelled, cancelRate: (r.cancelled / r.booked) * 100 }))
    .sort((a, b) => b.cancelRate - a.cancelRate);

  // Refund-rate flag.
  const refundRatePct = incomeThis.gross > 0 ? (incomeThis.refunds / incomeThis.gross) * 100 : 0;
  const refundFlag = refundRatePct > REFUND_RATE_RED_PCT;

  // Organic channels under target (only the ones with a goal).
  const channelsUnderTarget = organicCheck
    .filter((c) => c.weeklyTarget > 0 && c.actual < c.weeklyTarget)
    .map((c) => ({ source: c.source, actual: c.actual, target: c.weeklyTarget, pct: (c.pctOfTarget ?? 0) }));

  // Categorization debt — uncategorized rev rows + uncategorized expense
  // rows this week vs prior week. Growing = a problem.
  const uncatRevThis = incomeThis.uncategorizedCount;
  const uncatRevPrior = incomePrior.uncategorizedCount;
  const uncatExpThis = expenseThisAgg.uncategorizedCount;
  const uncatExpPrior = expensePriorAgg.uncategorizedCount;
  const totalUncatThis = uncatRevThis + uncatExpThis;
  const totalUncatPrior = uncatRevPrior + uncatExpPrior;
  const categorizationDebt = {
    uncategorizedRevenueRows: uncatRevThis,
    uncategorizedExpenseRows: uncatExpThis,
    priorWeekTotal: totalUncatPrior,
    thisWeekTotal: totalUncatThis,
    growing: totalUncatThis > totalUncatPrior,
  };

  // Lowest cash/call streak — same closer was lowest this week AND last.
  const closersOnly = (rows: TeamRow[]) => rows.filter((r) => r.role === 'closer' && r.showed >= 3);
  type TeamRow = (typeof teamRows)[number];
  const sortedThisCloser = closersOnly(teamRows).sort((a, b) => a.cashPerCall - b.cashPerCall);
  const lowestThis = sortedThisCloser[0]?.name ?? null;
  const topThis = sortedThisCloser.length > 0
    ? [...closersOnly(teamRows)].sort((a, b) => b.cashPerCall - a.cashPerCall)[0]
    : null;

  // Build per-closer rollup for the prior week to detect the streak.
  const priorCloserMap = new Map<string, { showed: number; cash: number }>();
  for (const e of (t05Prior.data ?? []) as EodRow0[]) {
    const { name, role } = canonName(e.closer_name);
    if (!name || role !== 'closer') continue;
    const ent = priorCloserMap.get(name) ?? { showed: 0, cash: 0 };
    ent.showed += Number(e.calls_shown ?? 0);
    priorCloserMap.set(name, ent);
  }
  for (const d of (t06Prior.data ?? []) as DealRow0[]) {
    const { name, role } = canonName(d.closer);
    if (!name || role !== 'closer') continue;
    const ent = priorCloserMap.get(name) ?? { showed: 0, cash: 0 };
    ent.cash += Number(d.cash_collected ?? 0);
    priorCloserMap.set(name, ent);
  }
  const priorRanked = Array.from(priorCloserMap.entries())
    .filter(([, v]) => v.showed >= 3)
    .map(([name, v]) => ({ name, cashPerCall: v.showed > 0 ? Math.round(v.cash / v.showed) : 0 }))
    .sort((a, b) => a.cashPerCall - b.cashPerCall);
  const lowestPrior = priorRanked[0]?.name ?? null;
  const lowestStreak = lowestThis && lowestThis === lowestPrior
    ? { name: lowestThis, weeksRunning: LOWEST_STREAK_TRIGGER }
    : null;

  // ── People — 3 names ─────────────────────────────────────────────────
  const topPerformer = topThis
    ? { name: topThis.name, cashPerCall: topThis.cashPerCall, cash: topThis.cash, showed: topThis.showed }
    : null;
  const lowestPerformer = sortedThisCloser[0]
    ? { name: sortedThisCloser[0].name, cashPerCall: sortedThisCloser[0].cashPerCall, cash: sortedThisCloser[0].cash, showed: sortedThisCloser[0].showed, streakWeeks: lowestStreak ? LOWEST_STREAK_TRIGGER : 1 }
    : null;
  // At-risk client placeholder — Pillar 4.5 will populate.
  const atRiskClient = null;

  // ── Income Check — cash + AR vs split targets ────────────────────────
  // the operator's checklist Q1: did we hit our new cash + AR targets this week?
  // If no → which one is the constraint? We answer that explicitly.
  const cashVsTarget = incomeThis.newCash - weeklyCashTarget;
  const arVsTarget = incomeThis.ar - weeklyArTarget;
  const cashHit = weeklyCashTarget > 0 ? cashVsTarget >= 0 : null;
  const arHit = weeklyArTarget > 0 ? arVsTarget >= 0 : null;
  // Constraint = whichever is further behind (more negative). If both
  // green, no constraint. If both red, the larger gap is THE constraint.
  let incomeConstraint: 'cash' | 'ar' | null = null;
  if (cashHit === false || arHit === false) {
    if (cashHit === false && arHit !== false) incomeConstraint = 'cash';
    else if (arHit === false && cashHit !== false) incomeConstraint = 'ar';
    else incomeConstraint = cashVsTarget < arVsTarget ? 'cash' : 'ar';
  }
  const incomeCheck = {
    cash: incomeThis.newCash,
    cashTarget: weeklyCashTarget,
    cashVsTarget,
    cashHit,
    ar: incomeThis.ar,
    arTarget: weeklyArTarget,
    arVsTarget,
    arHit,
    constraint: incomeConstraint,
    bothOnTarget: cashHit === true && arHit === true,
  };

  // ── Expense Check — total + per-category vs target ───────────────────
  // the operator's checklist Q2: did we hit our expense targets to maintain
  // our profit margin target? If no → where did we overspend?
  const byCat = expenseThisAgg.byCategory ?? {};
  const expenseCategories = ['marketing', 'labour', 'overhead', 'coaching']
    .map((k) => {
      const actual = byCat[k] ?? 0;
      const weeklyTarget = weeklyExpenseByCategory[k] ?? 0;
      const overBy = actual - weeklyTarget;
      return {
        category: k,
        actual,
        weeklyTarget,
        overBy,
        overBudget: weeklyTarget > 0 && overBy > 0,
        pctOfTarget: weeklyTarget > 0 ? (actual / weeklyTarget) * 100 : null,
      };
    })
    .sort((a, b) => b.overBy - a.overBy);
  // Per-row transactions for the drop-down, with red-flag reasons on
  // the rows worth eyeballing. the operator 2026-04-30: wants to be able to
  // open the card and scan all 7 days of charges.
  type ExpRowFull = { id: string; date: string; amount: number | string | null; expense_type: string | null; transaction_name: string | null; card_name: string | null; card_last_four: string | null; notes: string | null };
  const BIG_TICKET_THRESHOLD = 1000;
  const expenseTransactions = ((t08This.data ?? []) as ExpRowFull[])
    .map((r) => {
      const amt = Number(r.amount ?? 0);
      const cat = (r.expense_type ?? '').toLowerCase();
      let flag: 'big-ticket' | 'uncategorized' | 'personal' | null = null;
      let flagLabel: string | null = null;
      if (cat.includes('personal')) {
        flag = 'personal';
        flagLabel = "Marked personal — shouldn't be on business card";
      } else if (!cat || cat === 'unknown' || cat === 'other') {
        flag = 'uncategorized';
        flagLabel = 'Needs a category';
      } else if (amt >= BIG_TICKET_THRESHOLD) {
        flag = 'big-ticket';
        flagLabel = `Big-ticket charge ≥ ${BIG_TICKET_THRESHOLD.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`;
      }
      return {
        id: r.id,
        date: r.date,
        vendor: r.transaction_name ?? '?',
        amount: amt,
        type: r.expense_type ?? null,
        card: r.card_name ? `${r.card_name}${r.card_last_four ? ` ··${r.card_last_four}` : ''}` : null,
        notes: r.notes ?? null,
        flag,
        flagLabel,
      };
    })
    .filter((t) => Math.abs(t.amount) > 0.01) // drop $0 rows
    .sort((a, b) => b.amount - a.amount);

  const expenseCheck = {
    actual: expenseThis,
    weeklyTarget: weeklyExpenseTarget,
    overBy: expenseThis - weeklyExpenseTarget,
    onTarget: weeklyExpenseTarget > 0 ? expenseThis <= weeklyExpenseTarget : null,
    biggestOverspendCategory: expenseCategories[0] && expenseCategories[0].overBy > 0
      ? expenseCategories[0]
      : null,
    categories: expenseCategories,
    transactions: expenseTransactions,
    flaggedCount: expenseTransactions.filter((t) => t.flag).length,
    bigTicketThreshold: BIG_TICKET_THRESHOLD,
  };

  // ── Last Week Comparison — define the red-flag metric set per
  //                          the operator's checklist Q3: have RED FLAG
  //                          metrics got BETTER or WORSE since last week?
  // Direction: 'good' if metric moved in favorable direction.
  // For inverse metrics (refunds, cancels, expenses) lower = good.
  type DirHint = 'higherIsBetter' | 'lowerIsBetter';
  function dirOf(hint: DirHint, current: number, prior: number): 'better' | 'worse' | 'same' {
    const eps = 0.01;
    if (Math.abs(current - prior) < eps) return 'same';
    if (hint === 'higherIsBetter') return current > prior ? 'better' : 'worse';
    return current < prior ? 'better' : 'worse';
  }
  const lastWeekRedFlags: Array<{ metric: string; hint: DirHint; current: number; prior: number; direction: 'better' | 'worse' | 'same'; format: 'currency' | 'percent' | 'count' }> = [
    { metric: 'Net Cash',       hint: 'higherIsBetter', current: incomeThis.net, prior: incomePrior.net, direction: dirOf('higherIsBetter', incomeThis.net, incomePrior.net), format: 'currency' },
    { metric: 'New Cash',       hint: 'higherIsBetter', current: incomeThis.newCash, prior: incomePrior.newCash, direction: dirOf('higherIsBetter', incomeThis.newCash, incomePrior.newCash), format: 'currency' },
    { metric: 'AR Collected',   hint: 'higherIsBetter', current: incomeThis.ar, prior: incomePrior.ar, direction: dirOf('higherIsBetter', incomeThis.ar, incomePrior.ar), format: 'currency' },
    { metric: 'Expenses',       hint: 'lowerIsBetter',  current: expenseThis, prior: expensePrior, direction: dirOf('lowerIsBetter', expenseThis, expensePrior), format: 'currency' },
    { metric: 'Profit',         hint: 'higherIsBetter', current: profitThis, prior: profitPrior, direction: dirOf('higherIsBetter', profitThis, profitPrior), format: 'currency' },
    { metric: 'Refund Rate',    hint: 'lowerIsBetter',  current: refundRatePct, prior: incomePrior.gross > 0 ? (incomePrior.refunds / incomePrior.gross) * 100 : 0, direction: dirOf('lowerIsBetter', refundRatePct, incomePrior.gross > 0 ? (incomePrior.refunds / incomePrior.gross) * 100 : 0), format: 'percent' },
    { metric: 'Show Rate',      hint: 'higherIsBetter', current: combinedShowRate, prior: trendWeeks[trendWeeks.length - 2]?.showRate ?? 0, direction: dirOf('higherIsBetter', combinedShowRate, trendWeeks[trendWeeks.length - 2]?.showRate ?? 0), format: 'percent' },
    { metric: 'Close Rate',     hint: 'higherIsBetter', current: combinedCloseRate, prior: trendWeeks[trendWeeks.length - 2]?.closeRate ?? 0, direction: dirOf('higherIsBetter', combinedCloseRate, trendWeeks[trendWeeks.length - 2]?.closeRate ?? 0), format: 'percent' },
    { metric: 'Lead Volume',    hint: 'higherIsBetter', current: trendWeeks[trendWeeks.length - 1]?.leadTotal ?? 0, prior: trendWeeks[trendWeeks.length - 2]?.leadTotal ?? 0, direction: dirOf('higherIsBetter', trendWeeks[trendWeeks.length - 1]?.leadTotal ?? 0, trendWeeks[trendWeeks.length - 2]?.leadTotal ?? 0), format: 'count' },
  ];
  const lastWeekComparison = {
    summary: {
      better: lastWeekRedFlags.filter((m) => m.direction === 'better').length,
      worse: lastWeekRedFlags.filter((m) => m.direction === 'worse').length,
      same: lastWeekRedFlags.filter((m) => m.direction === 'same').length,
    },
    metrics: lastWeekRedFlags,
  };

  // ── CSM upsell check — the operator's checklist: ≥2 upsells per CSM ───────
  const CSM_UPSELL_TARGET = 2;
  const csmRows = teamRows.filter((r) => r.role === 'csm');
  const csmUpsellCheck = {
    target: CSM_UPSELL_TARGET,
    rows: csmRows.map((c) => ({
      name: c.name,
      upsells: c.upsells,
      cash: c.cash,
      hitTarget: c.upsells >= CSM_UPSELL_TARGET,
    })),
    allHit: csmRows.length > 0 && csmRows.every((c) => c.upsells >= CSM_UPSELL_TARGET),
  };

  return NextResponse.json(
    {
      configured: true,
      window: { from, to },
      priorWindow: prior,
      revenueCheck: {
        target: weeklyRevTarget,
        thisWeek: incomeThis,
        priorWeek: incomePrior,
        delta: incomeThis.net - incomePrior.net,
        netVsTarget: incomeThis.net - weeklyRevTarget,
        expenseThis,
        expensePrior,
        weeklyExpenseTarget,
        profitThis,
        profitPrior,
        weeklyProfitTarget,
        profitDelta: profitThis - profitPrior,
        profitVsTarget: profitThis - weeklyProfitTarget,
        refundRatePct: incomeThis.gross > 0 ? (incomeThis.refunds / incomeThis.gross) * 100 : 0,
      },
      salesTeam: {
        combinedShowRate,
        combinedCloseRate,
        showRateTarget: COMBINED_SHOW_RATE_TARGET,
        closeRateTarget: COMBINED_CLOSE_RATE_TARGET,
        showRateOk: combinedShowRate >= COMBINED_SHOW_RATE_TARGET,
        closeRateOk: combinedCloseRate >= COMBINED_CLOSE_RATE_TARGET,
        rows: teamRows.sort((a, b) => b.cashPerCall - a.cashPerCall),
      },
      organicChannels: {
        rows: organicCheck,
      },
      // ── New sections per Google-Doc spec ──────────────────────────
      trends: {
        weeks: trendWeeks.map((w) => ({
          from: w.from, to: w.to, label: w.label,
          showRate: w.showRate,
          closeRate: w.closeRate,
          leadTotal: w.leadTotal,
          leadBySource: w.leadBySource,
          netCash: w.netCash,
        })),
        showRateTarget: COMBINED_SHOW_RATE_TARGET,
        closeRateTarget: COMBINED_CLOSE_RATE_TARGET,
        showRateMonotonicDecline: trendWeeks.length === TREND_WINDOW_WEEKS && trendWeeks.every((w, i) => i === 0 || w.showRate <= trendWeeks[i - 1].showRate),
        closeRateMonotonicDecline: trendWeeks.length === TREND_WINDOW_WEEKS && trendWeeks.every((w, i) => i === 0 || w.closeRate <= trendWeeks[i - 1].closeRate),
        sourceDrops,           // sources that dropped ≥30% WoW
        wowDropAlertPct: WOW_DROP_ALERT_PCT,
      },
      leaks: {
        refundRatePct,
        refundFlag,
        refundRedThresholdPct: REFUND_RATE_RED_PCT,
        cancelOffenders,
        cancelRedThresholdPct: CANCEL_RATE_RED_PCT,
        channelsUnderTarget,
        categorizationDebt,
        lowestStreak,
      },
      people: {
        topPerformer,
        lowestPerformer,
        atRiskClient,
      },
      // ── New sections aligned with the operator's 2026-04-30 finalized checklist ─
      incomeCheck,
      expenseCheck,
      lastWeekComparison,
      organicByPlatform,
      csmUpsellCheck,
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate' } }
  );
}
