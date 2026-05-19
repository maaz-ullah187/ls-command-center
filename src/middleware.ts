import { NextResponse, type NextRequest } from 'next/server';
import { isCookieValid, AUTH_COOKIE_NAME } from '@/lib/auth';

/**
 * Dashboard auth middleware — gates the entire app behind a single
 * password. the operator 2026-04-30: switched from HTTP Basic Auth (which
 * forces a username field) to a custom /login page (password only).
 *
 * Flow:
 *   1. Public paths (assets, /login, webhooks, sync crons) → pass through
 *   2. Cookie present + valid → pass through
 *   3. Otherwise: page request → redirect to /login?redirect=<path>
 *                 API request → return 401 JSON (so fetches don't redirect)
 *
 * Credentials:
 *   DASHBOARD_AUTH_PASS    — the shared password (REQUIRED in production)
 *   DASHBOARD_AUTH_SECRET  — HMAC signing secret (REQUIRED in production)
 *
 * If either env is missing we fail open with a 503 banner so a forgotten
 * env doesn't lock the team out without warning.
 */

const PUBLIC_PATHS = [
  // Slack + GoHighLevel webhooks — third-party callers can't send our
  // cookies, so these MUST stay open. They're authenticated via their
  // own signing-secret checks.
  '/api/webhooks',
  // Vercel cron / sync routes — Vercel cron pings these without our
  // cookies. The cron-secret header is the auth signal there.
  '/api/sync',
  // The login flow itself
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
];

function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith('/_next')) return true;
  if (pathname.startsWith('/static')) return true;
  if (pathname === '/favicon.ico') return true;
  for (const p of PUBLIC_PATHS) {
    if (pathname === p || pathname.startsWith(p + '/')) return true;
  }
  return false;
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  if (isPublicPath(pathname)) return NextResponse.next();

  // Trim — same fix as /api/auth/login. A trailing newline in the Vercel
  // env-var would otherwise break the comparison silently.
  const password = (process.env.DASHBOARD_AUTH_PASS ?? '').trim();
  const secret = ((process.env.DASHBOARD_AUTH_SECRET ?? '').trim()) || password; // fall back so legacy deploys without the secret env still work
  if (!password || !secret) {
    return new NextResponse(
      'Dashboard auth not configured. Set DASHBOARD_AUTH_PASS + DASHBOARD_AUTH_SECRET in Vercel env vars.',
      { status: 503 }
    );
  }

  const cookieValue = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const ok = await isCookieValid(cookieValue, password, secret);
  if (ok) return NextResponse.next();

  // For API routes return JSON 401 so fetches see a clean error rather
  // than getting an HTML redirect. Page routes get bounced to /login.
  if (pathname.startsWith('/api/')) {
    return new NextResponse(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('redirect', pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
