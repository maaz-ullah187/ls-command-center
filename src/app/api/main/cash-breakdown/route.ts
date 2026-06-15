import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const revalidate = 60;
export const dynamic = 'force-dynamic';

// Cached t06 fetch for cash-breakdown. Cache key: (from, to).
type CashRow = {
  cash_collected: number | string | null;
  source: string | null;
  offer: string | null;
};

const fetchCashRows = unstable_cache(
  async (from: string, to: string): Promise<CashRow[]> => {
    const supa = await getServerSupabaseAsync();
    if (!supa) return [];
    const { data, error } = await supa
      .from('t06_deals_closed')
      .select('cash_collected, source, offer')
      .gte('date_closed', from)
      .lte('date_closed', to)
      .limit(10000);
    if (error) throw new Error(error.message ?? 'query_failed');
    return (data ?? []) as CashRow[];
  },
  ['main:cash-breakdown:t06'],
  { revalidate: 60, tags: ['t06'] },
);

/**
 * GET /api/main/cash-breakdown — "Cash by Source" + "Cash by Offer" donuts.
 *
 * Architecture B (the operator 2026-04-29): every revenue card on the main
 * dashboard reads from t07_income_processors so they reconcile to one
 * source of truth.
 *
 * Filter: payment_type IN ('new_client', 'new') AND status='paid'.
 * the operator explicitly wants NEW client cash only (segmented by source/
 * offer) — recurring AR / renewals are tracked separately under
 * Backend Revenue. The card subtitle reflects this.
 *
 * To get an accurate new-client total, the income sync now defaults
 * Whop billing_reason='initial' / 'one_time' to 'new_client' (used to
 * dump them into 'other' which left $170k+ of new cash uncategorised).
 * Plus a one-time backfill swept existing 'other' rows that link to a
 * t06 deal with deal_type='new'. Together these two changes brought
 * April new_client cash from $131k → $304k (matches t06's $383k closer
 * after accounting for cash-not-yet-received).
 *
 * Source attribution chain:
 *   1. t07.deal_id → t06 row → t01.source via lead_id/email
 *   2. t01.source by direct t07.email match
 *   3. t06.source via deal_id (fallback when t01 has no row)
 *   4. 'Unknown' (last resort)
 *
 * Offer attribution:
 *   1. t07.offer (manual queue edit) when canonical
 *   2. t06.offer via deal_id (canonicalised)
 *   3. 'Unknown'
 */

// the operator 2026-04-30: defensive fallback — if a stale browser bundle
// passes a future-looking month (toISOString-bug), fall back to ET-now.
import { monthYM_ET } from '@/lib/timeframe';

function monthBounds(monthParam: string | null): { from: string; to: string } {
  const currentET = monthYM_ET();
  let resolved = currentET;
  if (monthParam) {
    const m = /^(\d{4})-(\d{2})$/.exec(monthParam);
    if (m) {
      const requested = `${m[1]}-${m[2]}`;
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
  };
}

/**
 * Canonicalise lead-source strings so casing / spelling variants don't
 * fragment the donut. Also detects obvious bad-data cases (e.g. someone
 * typed the customer's first name into the source field) and routes them
 * to 'Unknown' so the team can fix them upstream rather than seeing
 * "Team Member" or "John" appear as a "source".
 */
function canonSource(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return 'Unknown';
  const k = s.toLowerCase();
  if (k === 'unknown') return 'Unknown';
  if (k === 'twitter' || k === 'x' || k === 'x.com' || k === 'twitter/x') return 'X';
  if (k === 'fb' || k === 'facebook' || k === 'meta' || k === 'facebook ads' || k === 'facebook ad' || k === 'paid' || k === 'paid ads') return 'Facebook Ads';
  if (k === 'yt' || k === 'youtube' || k === 'youtube ads') return 'YouTube';
  if (k === 'ig' || k === 'instagram') return 'Instagram';
  if (k === 'li' || k === 'linkedin') return 'LinkedIn';
  if (k === 'organic' || k === 'seo') return 'Organic';
  if (k === 'referral' || k === 'ref' || k === 'referred') return 'Referral';
  if (k === 'webinar' || k === 'webinars') return 'Webinar';
  // Heuristic: a single-word value that's likely a person's name (e.g.
  // closers often type the referrer's first name into t06.source —
  // "Team Member" means Team Member referred this customer). Treat all such
  // values as Referral. the operator 2026-04-29.
  if (/^[a-z]+$/i.test(s) && !['email','sms','dm','outbound','inbound','website','direct','affiliate','partner'].includes(k)) {
    return 'Referral';
  }
  return s;
}

function canonOffer(raw: string | null | undefined): string {
  const o = (raw || '').trim().toLowerCase();
  if (!o) return 'Unknown';
  if (o.includes('program a')) return 'Program A';
  if (o.includes('program b')) return 'Program B';
  if (o.includes('program c') || /\bai\b/.test(o) || o.includes('agent build')) return 'Program C';
  // Anything else (incl. Whop's "Payment Plan" productName which is just a
  // structure tag, not a real offer) falls through to Unknown so we don't
  // get phantom slices in the donut.
  return 'Unknown';
}

// Pick the most-canonical offer between t07 and t06. If t07.offer is set to
// a canonical bucket (Program A / Program B / Program C),
// trust it (could be a manual queue edit). Otherwise prefer t06.offer.
function bestOffer(t07Offer: string | null, t06Offer: string | null): string {
  const t07c = canonOffer(t07Offer);
  if (t07c !== 'Unknown') return t07c;
  return canonOffer(t06Offer);
}

/**
 * Exported response-builder so /api/main/dashboard-data can call this logic
 * directly without an HTTP round-trip. GET handler is now a thin re-export.
 */
export async function buildCashBreakdownResponse(req: NextRequest) {
  const url = new URL(req.url);
  // the operator 2026-05-01: Cash by Source / Offer pass `?from=&to=` from the
  // global timeframe filter. Honor those first; only fall back to month=
  // (and ET-default) if neither is provided.
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const { from, to } = (fromParam && toParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam))
    ? { from: fromParam, to: toParam }
    : monthBounds(url.searchParams.get('month'));

  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ bySource: [], byOffer: [], window: { from, to }, configured: false });
  }

  // the operator 2026-04-29 (final): Cash by Source + Cash by Offer pull
  // EXCLUSIVELY from t06_deals_closed for the month. Cash = sum of
  // cash_collected. Source = canonSource(t06.source). Offer =
  // canonOffer(t06.offer). No t07 lookup, no t01 lookup, no fuzzy
  // matching. Closer-announced cash, closer-announced source — done.
  //
  // This means Cash by Source/Offer total will diverge from Revenue
  // Composition newCash (which is t07-driven). That's intentional:
  // Cash by Source/Offer answers "what did closers report in
  // #new-clients", Revenue Composition answers "what hit the
  // payment processors".
  // t06 reads are cached for 60s per (from,to) via unstable_cache.
  type T06Row = CashRow;
  let deals: T06Row[];
  try {
    deals = await fetchCashRows(from, to);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'query_failed';
    return NextResponse.json({ error: message, window: { from, to } }, { status: 502 });
  }

  type Slice = { key: string; amount: number; count: number };
  const bySourceMap = new Map<string, Slice>();
  const byOfferMap = new Map<string, Slice>();
  let total = 0;
  let unattributedCount = 0;

  for (const d of (deals ?? []) as T06Row[]) {
    const cash = Number(d.cash_collected ?? 0);
    if (cash <= 0) continue;
    total += cash;

    const src = canonSource(d.source);
    const off = canonOffer(d.offer);
    if (src === 'Unknown') unattributedCount += 1;

    const sSlice = bySourceMap.get(src) ?? { key: src, amount: 0, count: 0 };
    sSlice.amount += cash;
    sSlice.count += 1;
    bySourceMap.set(src, sSlice);

    const oSlice = byOfferMap.get(off) ?? { key: off, amount: 0, count: 0 };
    oSlice.amount += cash;
    oSlice.count += 1;
    byOfferMap.set(off, oSlice);
  }

  const bySource = Array.from(bySourceMap.values()).sort((a, b) => b.amount - a.amount);
  const byOffer = Array.from(byOfferMap.values()).sort((a, b) => b.amount - a.amount);

  return NextResponse.json({
    window: { from, to },
    configured: true,
    source: 't06_deals_closed (cash_collected + source + offer for the month)',
    bySource,
    byOffer,
    total,
    debug: {
      dealCount: deals?.length ?? 0,
      unattributedCount,
    },
  });
}


export const GET = buildCashBreakdownResponse;
