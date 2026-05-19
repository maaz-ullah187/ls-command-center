import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { timeframeFromSearchParams } from '@/lib/timeframe';
import type { CloserLeaderboardRow } from '@/lib/reports/main';

// Always fetch fresh — the leaderboard reads t05 EODs + t06 deals which change
// constantly. Without this, Vercel was serving cached responses indefinitely
// and code changes (e.g. Closer Three/Closer Three merge) didn't appear live.
export const dynamic = 'force-dynamic';

/**
 * GET /api/main/closers — combined Closer + CSM leaderboard for Main Dashboard.
 *
 * Closers (sales reps): activity counts from t05_eod_reports
 *   (booked / shown / no_shows / cancelled / closed) + per-deal_type
 *   cash/contracted from t06_deals_closed. Show% uses (shown + no_shows
 *   + cancelled) as denominator so it penalizes both flake types.
 *
 * CSMs (account managers, e.g. CSM One, CSM Two): per the spec, only
 *   show cash + contracted + # upsells. They don't own pipeline activity, so
 *   booked/showed/closed counts are skipped on the UI side.
 *
 * Role inference: anyone in CSM_NAMES is tagged 'csm'; everyone else is 'closer'.
 */

// Fallback CSM names — only consulted when the person isn't in t90_team_roster.
// The roster (role='account_manager') is the canonical source of truth.
// Add lowercase 'firstname lastname' entries for your CSMs.
const CSM_NAMES_FALLBACK = new Set<string>([]);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const window = timeframeFromSearchParams(url.searchParams);

  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ rows: [], window, configured: false });
  }

  // Pull the roster — it's the canonical source for both:
  //   1. Name canonicalisation (collapses "Closer Three" + "Closer Three" → one row,
  //      and "CSM One" + "CSM One" → one row)
  //   2. Role assignment (account_manager → csm, everything else → closer)
  // If two roster members share a first name we drop that mapping entirely
  // to avoid wrong merges.
  const { data: roster } = await supa
    .from('t90_team_roster')
    .select('name, role, active')
    .eq('active', true);

  type RosterEntry = { name: string; role: 'closer' | 'csm' | 'setter' };
  const firstWord = (s: string) => s.trim().toLowerCase().split(/\s+/)[0] || '';
  const mapRole = (r: string | null): RosterEntry['role'] =>
    r === 'account_manager' ? 'csm' : r === 'setter' ? 'setter' : 'closer';

  const firstToEntry = new Map<string, RosterEntry>();
  const ambiguousFirst = new Set<string>();
  for (const r of (roster ?? []) as Array<{ name: string | null; role: string | null }>) {
    const full = (r.name ?? '').trim();
    if (!full) continue;
    const fn = firstWord(full);
    if (!fn) continue;
    const role = mapRole(r.role);
    if (firstToEntry.has(fn) && firstToEntry.get(fn)!.name !== full) {
      ambiguousFirst.add(fn);
    } else {
      firstToEntry.set(fn, { name: full, role });
    }
  }
  for (const fn of ambiguousFirst) firstToEntry.delete(fn);

  // Resolve an incoming closer name → canonical roster name (or fall back to
  // raw input). e.g. EODs say "Closer Three", deals say "Closer Three" → both
  // resolve to roster's "Closer Three" and merge into one leaderboard row.
  const canon = (raw: string | null | undefined): string => {
    const s = (raw ?? '').trim();
    if (!s) return '';
    return firstToEntry.get(firstWord(s))?.name ?? s;
  };

  const roleFor = (canonicalName: string): RosterEntry['role'] => {
    const entry = firstToEntry.get(firstWord(canonicalName));
    if (entry) return entry.role;
    return CSM_NAMES_FALLBACK.has(canonicalName.toLowerCase()) ? 'csm' : 'closer';
  };

  // PostgREST hard-caps a single response at 1000 rows. Page through the
  // EOD table so longer windows don't silently truncate.
  type EodRow = {
    closer_name: string | null;
    calls_booked: number | null;
    calls_shown: number | null;
    calls_closed: number | null;
    no_shows: number | null;
    calls_cancelled: number | null;
    date: string | null;
  };
  const PAGE = 1000;
  const eodRows: EodRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supa
      .from('t05_eod_reports')
      .select('closer_name, calls_booked, calls_shown, calls_closed, no_shows, calls_cancelled, date')
      .gte('date', window.from)
      .lte('date', window.to)
      .range(offset, offset + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: error.message, window }, { status: 502 });
    }
    const batch = (data ?? []) as EodRow[];
    eodRows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const dealsRes = await supa
    .from('t06_deals_closed')
    .select('closer, cash_collected, contracted_revenue, deal_type, date_closed')
    .gte('date_closed', window.from)
    .lte('date_closed', window.to)
    .limit(5000);

  if (dealsRes.error) {
    return NextResponse.json({ error: dealsRes.error.message, window }, { status: 502 });
  }

  const byKey = new Map<string, CloserLeaderboardRow>();
  const ensure = (name: string): CloserLeaderboardRow => {
    const key = name.trim();
    let r = byKey.get(key);
    if (!r) {
      // Map roster role → leaderboard role:
      //   account_manager → csm
      //   setter          → setter (their own section, e.g. DM setters
      //                     the Instagram DM setter)
      //   closer / unknown → closer
      const rosterRole = roleFor(key);
      r = {
        closer: key,
        role: rosterRole, // 'closer' | 'csm' | 'setter'
        booked: 0,
        showed: 0,
        noShows: 0,
        cancelled: 0,
        closed: 0,
        showPct: 0,
        cancelPct: 0,
        closePct: 0,
        cash: 0,
        contracted: 0,
        newDeals: 0,
        renewals: 0,
        upsells: 0,
        cashPerCall: 0,
      };
      byKey.set(key, r);
    }
    return r;
  };

  // EOD activity counts — meaningful for closers AND setters (a setter's
  // EODs show how many appointments they booked + showed). Skip CSMs.
  for (const e of eodRows) {
    const name = canon(e.closer_name);
    if (!name) continue;
    const row = ensure(name);
    if (row.role === 'csm') continue;
    row.booked += Number(e.calls_booked) || 0;
    row.showed += Number(e.calls_shown) || 0;
    row.noShows += Number(e.no_shows) || 0;
    row.cancelled += Number(e.calls_cancelled) || 0;
    row.closed += Number(e.calls_closed) || 0;
  }

  // Deal-level cash/contracted with deal_type counts.
  for (const d of dealsRes.data ?? []) {
    const name = canon(d.closer);
    if (!name) continue;
    const row = ensure(name);
    const cash = Number(d.cash_collected) || 0;
    const contracted = Number(d.contracted_revenue) || 0;
    const dtype = String(d.deal_type ?? '').toLowerCase();

    row.cash += cash;
    row.contracted += contracted;

    if (dtype === 'new') row.newDeals += 1;
    else if (dtype === 'renewal') row.renewals += 1;
    else if (dtype === 'upsell' || dtype === 'upgrade') row.upsells += 1;
  }

  for (const r of byKey.values()) {
    // Show% = shown / (booked - cancelled). the operator 2026-04-30:
    // cancellations are removed from the denominator entirely — they're
    // protected calls that never had a chance to show. Only no-shows
    // count against the rep. (Previous formula, which counted cancellations
    // in the denominator, produced unrealistically low show rates.)
    const trueBooked = r.booked - r.cancelled;
    r.showPct = trueBooked > 0 ? (r.showed / trueBooked) * 100 : 0;
    r.cancelPct = r.booked > 0 ? (r.cancelled / r.booked) * 100 : 0;
    r.closePct = r.showed > 0 ? (r.closed / r.showed) * 100 : 0;
    // Cash Per Call = total cash / total demos shown. the operator 2026-04-30:
    // "the number one indicator of who our best closer is — for every
    // showed call, how much money do they generate." Round to nearest $.
    r.cashPerCall = r.showed > 0 ? Math.round(r.cash / r.showed) : 0;
  }

  // the operator 2026-04-30: filter to roster-confirmed names ONLY. Without
  // this, anyone listed as `closer` on a t06 deal (e.g. "The Operator"
  // for deals he closed himself, or other non-roster names) bleeds into
  // the leaderboard with $0/call and gets flagged as "dropping the ball."
  // Roster is the authoritative list of who's a real rep.
  // CSM_NAMES_FALLBACK is also accepted so CSM One/Alex don't drop if
  // they're missing from the roster table.
  const rows = Array.from(byKey.values())
    .filter((r) => {
      const fn = firstWord(r.closer);
      if (firstToEntry.has(fn)) return true;
      if (CSM_NAMES_FALLBACK.has(r.closer.toLowerCase())) return true;
      return false;
    })
    .sort((a, b) => {
      if (b.cash !== a.cash) return b.cash - a.cash;
      if (b.contracted !== a.contracted) return b.contracted - a.contracted;
      if (b.closed !== a.closed) return b.closed - a.closed;
      return a.closer.localeCompare(b.closer);
    });
  return NextResponse.json({ rows, window, configured: true });
}
