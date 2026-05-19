import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/logout — clears the dashboard auth cookie. Useful for
 * "force log out everyone" by rotating the secret + redeploying, but
 * also for letting an individual browser drop its session.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: '',
    maxAge: 0,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  return res;
}
