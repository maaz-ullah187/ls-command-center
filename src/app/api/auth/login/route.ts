import { NextRequest, NextResponse } from 'next/server';
import { buildAuthCookie } from '@/lib/auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login   { password }
 *
 * Server-side password check. On success, sets a signed HttpOnly cookie
 * that middleware verifies on every subsequent request. On failure,
 * returns 401 with a generic error message (no enumeration leak).
 */
export async function POST(req: NextRequest) {
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  // Trim env vars defensively — Vercel's env-var paste flow occasionally
  // captures trailing newlines / spaces, which would otherwise make the
  // comparison fail silently with no diagnostic. (the operator 2026-04-30 hit
  // this exact bug — typed the right password, server said "Wrong password".)
  const expected = (process.env.DASHBOARD_AUTH_PASS ?? '').trim();
  const secret = ((process.env.DASHBOARD_AUTH_SECRET ?? '').trim()) || expected;
  if (!expected || !secret) {
    return NextResponse.json({ ok: false, error: 'server not configured' }, { status: 503 });
  }

  const provided = (body.password ?? '').trim();
  if (!provided || provided !== expected) {
    // Generic failure message — don't disclose whether the username (n/a)
    // or password was wrong.
    return NextResponse.json({ ok: false, error: 'Wrong password' }, { status: 401 });
  }

  const cookie = await buildAuthCookie(expected, secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: cookie.name,
    value: cookie.value,
    maxAge: cookie.maxAge,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  return res;
}
