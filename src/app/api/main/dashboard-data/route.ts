// GET /api/main/dashboard-data?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Aggregator endpoint: fans out to the 8 main-dashboard sub-routes in
// parallel and returns one combined payload. The point isn't just to save
// roundtrips on the client — every sub-route is wrapped in unstable_cache
// (60s TTL), so fanning out concurrently pre-warms ALL eight caches in
// parallel. After this one call, individual component fetches hit warm
// cache and respond in <50ms.
//
// Used by src/app/page.tsx to hydrate the Main Dashboard in a single
// roundtrip; the response is passed down to components as `initialData`
// so they can skip their own initial fetch.

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SUB_ROUTES = [
  'headline',
  'revenue-buckets',
  'revenue-composition',
  'revenue-trajectory',
  'cash-breakdown',
  'ltv-cac',
  'closers',           // a.k.a. closer-leaderboard
  'funnel-by-source',  // a.k.a. sales-funnel
] as const;

// Map sub-route → key in the aggregated response. The page + components
// look these names up so the contract is explicit.
const RESPONSE_KEY: Record<typeof SUB_ROUTES[number], string> = {
  'headline':            'headline',
  'revenue-buckets':     'revenueBuckets',
  'revenue-composition': 'revenueComposition',
  'revenue-trajectory':  'revenueTrajectory',
  'cash-breakdown':      'cashBreakdown',
  'ltv-cac':             'ltvCac',
  'closers':             'closerLeaderboard',
  'funnel-by-source':    'salesFunnel',
};

// revenue-trajectory takes `?month=YYYY-MM` not `?from=&to=`. We derive
// month from the `from` date when present.
function buildSubRouteUrl(base: URL, sub: string, qs: URLSearchParams): URL {
  const url = new URL(`/api/main/${sub}`, base);
  if (sub === 'revenue-trajectory') {
    const from = qs.get('from');
    if (from && /^\d{4}-\d{2}/.test(from)) {
      url.searchParams.set('month', from.slice(0, 7));
    }
    return url;
  }
  // Propagate from/to/preset/month to every other sub-route — each one
  // either uses them or ignores them harmlessly.
  for (const key of ['from', 'to', 'preset', 'month']) {
    const v = qs.get(key);
    if (v) url.searchParams.set(key, v);
  }
  return url;
}

export async function GET(req: NextRequest) {
  // Build an absolute base URL from the request's host header.
  // `new URL(req.url)` works locally but on Vercel `req.url` can carry the
  // wrong host (e.g. the function's internal hostname), which is why the
  // sub-fetches were 401-ing — they were being routed somewhere that the
  // dashboard's auth cookie didn't apply to.
  const host = req.headers.get('host');
  const xfProto = req.headers.get('x-forwarded-proto');
  const protocol = xfProto || (host?.startsWith('localhost') ? 'http' : 'https');
  const base = host
    ? new URL(`${protocol}://${host}`)
    : new URL(req.url);  // fallback
  // Carry the search params from the original request.
  const qs = new URL(req.url).searchParams;

  // Forward the incoming request's cookies so each sub-route sees the same
  // authenticated session. Without this, sub-routes that gate on the
  // dashboard's auth cookie 401.
  const cookieHeader = req.headers.get('cookie');

  // Fan out — Promise.all so a slow sub-route doesn't block the others.
  // Each sub-route's body is returned even if it 5xx'd, so the client can
  // render whatever did succeed.
  const results = await Promise.all(
    SUB_ROUTES.map(async (sub) => {
      const url = buildSubRouteUrl(base, sub, qs);
      try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (cookieHeader) headers.Cookie = cookieHeader;
        const res = await fetch(url.toString(), {
          headers,
          // Important: do NOT pass `cache: 'no-store'` here. We WANT to
          // hit the unstable_cache layer the sub-routes are wrapped in.
        });
        const body = await res.json().catch(() => ({ error: 'invalid_json' }));
        return { sub, ok: res.ok, status: res.status, body };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'fetch_failed';
        return { sub, ok: false, status: 0, body: { error: message } };
      }
    }),
  );

  const data: Record<string, unknown> = {};
  const errors: Record<string, { status: number; error: unknown }> = {};
  for (const r of results) {
    const key = RESPONSE_KEY[r.sub];
    data[key] = r.body;
    if (!r.ok) {
      errors[key] = { status: r.status, error: (r.body as { error?: unknown })?.error ?? 'sub_route_failed' };
    }
  }

  return NextResponse.json({
    ...data,
    // Echo the window so the client can render the same period label.
    window: { from: qs.get('from'), to: qs.get('to'), month: qs.get('month') },
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  });
}
