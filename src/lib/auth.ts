/**
 * Dashboard auth helper — Edge-runtime-compatible HMAC signing for the
 * cookie-based password-only auth scheme. the operator 2026-04-30: didn't want
 * the Basic Auth username field, so we ship a custom /login page that
 * sets a signed cookie on success.
 *
 * Cookie format:  `${expiryEpochSeconds}:${hmacHex}`
 * HMAC payload:   `${expiryEpochSeconds}:${dashboardPassword}`
 *
 * Verification computes the expected HMAC server-side and compares; the
 * password itself is never written into the cookie. Expiry is baked into
 * the signed payload so a stolen cookie can't be replayed forever.
 */

const COOKIE_NAME = 'ls_dash_auth';
const SESSION_DAYS = 30;

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildAuthCookie(password: string, secret: string): Promise<{ name: string; value: string; maxAge: number }> {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60;
  const sig = await hmacSign(`${expiry}:${password}`, secret);
  return { name: COOKIE_NAME, value: `${expiry}:${sig}`, maxAge: SESSION_DAYS * 24 * 60 * 60 };
}

export async function isCookieValid(cookieValue: string | undefined, password: string, secret: string): Promise<boolean> {
  if (!cookieValue) return false;
  const colonIdx = cookieValue.indexOf(':');
  if (colonIdx <= 0) return false;
  const expiryStr = cookieValue.slice(0, colonIdx);
  const sig = cookieValue.slice(colonIdx + 1);
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry)) return false;
  if (expiry < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacSign(`${expiry}:${password}`, secret);
  // Constant-time-ish compare. Edge runtime has no constant-time helper
  // built-in; for short hex strings the difference is negligible vs the
  // network jitter on each request.
  if (expected.length !== sig.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return mismatch === 0;
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;
