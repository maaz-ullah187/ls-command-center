import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { monthYM_ET } from '@/lib/timeframe';

export const revalidate = 60;
export const dynamic = 'force-dynamic';

// Cached t07 fetch for the revenue-buckets route. Paginates internally so
// the entire month's rows arrive in a single cache entry. Cache key: (from,to).
type BucketsRow = {
  final_amount: number | string | null;
  amount: number | string | null;
  status: string | null;
  payment_type: string | null;
  offer: string | null;
  processor: string | null;
};

const fetchBucketsRows = unstable_cache(
  async (from: string, to: string): Promise<BucketsRow[]> => {
    const supa = await getServerSupabaseAsync();
    if (!supa) return [];
    const all: BucketsRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supa
        .from('t07_income_processors')
        .select('final_amount, amount, status, payment_type, offer, processor')
        .eq('review_status', 'approved')  // ← Payment Review Queue gate
        .gte('date', from)
        .lte('date', to)
        .range(offset, offset + 999);
      if (error) throw new Error(error.message ?? 'query_failed');
      if (!data || data.length === 0) break;
      all.push(...(data as BucketsRow[]));
      if (data.length < 1000) break;
    }
    return all;
  },
  ['main:revenue-buckets:t07'],
  { revalidate: 60, tags: ['t07'] },
);

/**
 * GET /api/main/revenue-buckets?from=YYYY-MM-DD&to=YYYY-MM-DD
 * GET /api/main/revenue-buckets?month=YYYY-MM   (legacy, equivalent to month-bounds)
 *
 * Architecture B (per the spec 2026-04-30):
 *   t07_income_processors is the SINGLE source of truth for revenue.
 *   Team categorizes rows in the Uncategorized Billing queue.
 *   This endpoint groups t07 cash by payment_type bucket.
 *   The "Uncategorized" slice surfaces the work-still-to-do directly in
 *   the Revenue Composition donut.
 *
 * Net Revenue = sum of all incoming buckets - refunds. Total stays constant
 * as team works the queue — money just shifts from Uncategorized into the
 * proper bucket.
 *
 * Excluded rows (Remove button on the queue) are filtered out entirely —
 * they exist in t07 only as audit trail.
 *
 * the operator 2026-05-03: added explicit from/to so the headline KPI cards can
 * answer "Last 7 Days" / "Last 30 Days" instead of being month-locked. The
 * month= form is kept so older clients (and the Revenue Composition donut)
 * keep working until they're migrated.
 */

function monthBounds(monthParam: string | null): { from: string; to: string; label: string } {
  // the operator 2026-04-30: defensive fallback for the timezone bug.
  // Old browser JS was passing month=YYYY-MM computed via toISOString()
  // (UTC), so at evening ET it asked for "next month" and got an empty
  // response. If the requested month is in the FUTURE relative to ET,
  // silently fall back to the current ET month — old cached clients
  // get the right answer regardless.
  const currentET = monthYM_ET(); // e.g. "2026-04"
  let resolved = currentET;
  if (monthParam) {
    const m = /^(\d{4})-(\d{2})$/.exec(monthParam);
    if (m) {
      const requested = `${m[1]}-${m[2]}`;
      // String compare works because YYYY-MM is sortable.
      resolved = requested > currentET ? currentET : requested;
    }
  }
  const [yStr, mStr] = resolved.split('-');
  const year = Number(yStr);
  const mon = Number(mStr);
  const last = new Date(year, mon, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    from: `${year}-${pad(mon)}-01`,
    to: `${year}-${pad(mon)}-${pad(last)}`,
    label: new Date(year, mon - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }),
  };
}

function isYMD(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  // Range mode wins when both endpoints are valid YYYY-MM-DD. Otherwise fall
  // back to month-bounds (legacy callers + month-level dashboards).
  let from: string;
  let to: string;
  let label: string;
  if (isYMD(fromParam) && isYMD(toParam)) {
    from = fromParam;
    to = toParam;
    const fmt = (iso: string) =>
      new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    label = from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
  } else {
    ({ from, to, label } = monthBounds(url.searchParams.get('month')));
  }

  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ error: 'supabase_not_configured', configured: false }, { status: 500 });
  }

  // Pull every t07 row in the month. Backed by unstable_cache (60s TTL) so
  // repeat requests for the same (from,to) skip Supabase entirely.
  let all: BucketsRow[];
  try {
    all = await fetchBucketsRows(from, to);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'query_failed';
    return NextResponse.json({ error: message, monthYear: label }, { status: 502 });
  }

  let newCash = 0;
  let ar = 0;
  let upsellRenewal = 0;
  let mastermind = 0;
  let uncategorized = 0;
  let refunds = 0;
  // depositRevenue is a separate slice of newCash — payment_type='new_client'
  // AND offer ILIKE '%deposit%'. Reported alongside newCash (not subtracted)
  // so the headline KPIs can surface deposit cash separately.
  let depositRevenue = 0;
  let excludedCount = 0;
  let pendingSkipped = 0;

  for (const r of all) {
    const amt = Number(r.final_amount ?? r.amount ?? 0);
    if (amt === 0) continue;

    const status = String(r.status ?? '').toLowerCase();
    const ptype = String(r.payment_type ?? '').toLowerCase();

    // Excluded = "Remove" via queue. Audit only, never counts toward revenue.
    if (ptype === 'excluded') {
      excludedCount += 1;
      continue;
    }

    // Refunds — caught either by status or by payment_type (legacy rows).
    if (status === 'refunded' || ptype === 'refund') {
      refunds += Math.abs(amt);
      continue;
    }

    // Skip non-paid rows (pending, failed) — they're not revenue yet.
    if (status !== 'paid') {
      pendingSkipped += 1;
      continue;
    }

    // Stripe is currently used only for deposit collection. Route every
    // Stripe row to depositRevenue and skip the other buckets so it isn't
    // double-counted in newCash / AR / etc.
    const processor = String(r.processor ?? '').toLowerCase();
    if (processor === 'stripe') {
      depositRevenue += amt;
      continue;
    }

    if (ptype === 'new_client' || ptype === 'new') {
      newCash += amt;
      // Deposit slice — paid new_client rows whose offer mentions "deposit".
      // Overlaps newCash on purpose; surfaced separately on the headline.
      const offer = String(r.offer ?? '').toLowerCase();
      if (offer.includes('deposit')) {
        depositRevenue += amt;
      }
    } else if (ptype === 'account_receivable') {
      ar += amt;
    } else if (ptype === 'upsell_renewal' || ptype === 'renewal' || ptype === 'upgrade') {
      upsellRenewal += amt;
    } else if (ptype === 'mastermind') {
      mastermind += amt;
    } else {
      // 'other' or NULL or anything not in the canonical set → Uncategorized
      uncategorized += amt;
    }
  }

  const grossInflow = newCash + ar + upsellRenewal + mastermind + uncategorized;
  const netRevenue = grossInflow - refunds;

  return NextResponse.json({
    monthYear: label,
    configured: true,
    source: 't07_income_processors',
    newCash,
    ar,
    upsellRenewal,
    mastermind,
    uncategorized,
    refunds,
    depositRevenue,
    grossInflow,
    netRevenue,
    debug: {
      rowsScanned: all.length,
      excludedCount,
      pendingSkipped,
    },
  });
}
