// GET /api/main/dashboard-data?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Aggregator endpoint: imports each sub-route's exported response-builder
// and calls them all in parallel server-side. NO HTTP round-trips — that
// pattern was tripping the auth middleware on the internal fetch.
//
// Each builder returns either a plain object or a NextResponse (depending
// on whether I cleanly refactored it). We normalize both into the same
// `{ key: value }` shape in the response.
//
// All sub-routes use unstable_cache (60s TTL), so fanning out in parallel
// pre-warms every cache simultaneously.

import { NextRequest, NextResponse } from 'next/server';
import { buildHeadlineResponse } from '../headline/route';
import { buildRevenueCompositionResponse } from '../revenue-composition/route';
import { buildRevenueBucketsResponse } from '../revenue-buckets/route';
import { buildRevenueTrajectoryResponse } from '../revenue-trajectory/route';
import { buildCashBreakdownResponse } from '../cash-breakdown/route';
import { buildLtvCacResponse } from '../ltv-cac/route';
import { buildClosersResponse } from '../closers/route';
import { buildFunnelBySourceResponse } from '../funnel-by-source/route';

export const dynamic = 'force-dynamic';

/**
 * Build a synthetic NextRequest for one of the sub-routes. Sub-routes that
 * still parse `req.url` directly need this; the URL just needs to be a
 * valid absolute string with the right query params.
 */
function synthReq(base: URL, path: string, qs: URLSearchParams): NextRequest {
  const url = new URL(path, base);
  for (const [k, v] of qs) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
}

/** Coerce a builder result (plain object OR NextResponse) into a plain object. */
async function unwrap<T>(input: T | NextResponse): Promise<T | { error: string }> {
  if (input instanceof NextResponse) {
    try {
      return (await input.json()) as T;
    } catch {
      return { error: 'invalid_json' } as { error: string };
    }
  }
  return input;
}

export async function GET(req: NextRequest) {
  const base = new URL(req.url);
  const qs = base.searchParams;

  // revenue-trajectory expects `?month=YYYY-MM`. Derive it from `from`
  // when present so a single ?from/?to call drives all 8 sub-routes.
  const trajQs = new URLSearchParams(qs);
  const from = qs.get('from');
  if (from && /^\d{4}-\d{2}/.test(from) && !trajQs.get('month')) {
    trajQs.set('month', from.slice(0, 7));
  }

  // Fan out — Promise.all so a slow sub-route doesn't block the others.
  // Use Promise.allSettled-style local try/catch so one failure doesn't
  // sink the whole response: components render whatever did succeed.
  const tasks = [
    ['headline',           () => buildHeadlineResponse(qs)],
    ['revenueComposition', () => buildRevenueCompositionResponse(qs)],
    ['revenueBuckets',     () => buildRevenueBucketsResponse(synthReq(base, '/api/main/revenue-buckets', qs))],
    ['revenueTrajectory',  () => buildRevenueTrajectoryResponse(synthReq(base, '/api/main/revenue-trajectory', trajQs))],
    ['cashBreakdown',      () => buildCashBreakdownResponse(synthReq(base, '/api/main/cash-breakdown', qs))],
    ['ltvCac',             () => buildLtvCacResponse(synthReq(base, '/api/main/ltv-cac', qs))],
    ['closerLeaderboard',  () => buildClosersResponse(synthReq(base, '/api/main/closers', qs))],
    ['salesFunnel',        () => buildFunnelBySourceResponse(synthReq(base, '/api/main/funnel-by-source', qs))],
  ] as const;

  const results = await Promise.all(
    tasks.map(async ([key, fn]) => {
      try {
        const out = await fn();
        const body = await unwrap(out as never);
        return { key, body, error: null as unknown };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'builder_failed';
        return { key, body: { error: message }, error: message };
      }
    }),
  );

  const data: Record<string, unknown> = {};
  const errors: Record<string, unknown> = {};
  for (const r of results) {
    data[r.key] = r.body;
    if (r.error) errors[r.key] = r.error;
  }

  return NextResponse.json({
    ...data,
    window: { from: qs.get('from'), to: qs.get('to'), month: qs.get('month') },
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  });
}
