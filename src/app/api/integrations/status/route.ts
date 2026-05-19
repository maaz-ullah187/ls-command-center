import { NextResponse } from 'next/server';

// Live-ping each connected integration so the dashboard health banner can
// distinguish between "not configured" vs "configured but broken" (e.g.
// expired token, revoked access). Results are cached for 60s so refreshing
// the dashboard doesn't hammer the APIs.
//
// For each integration:
//   - configured: env vars present
//   - ok:         API responded successfully
//   - error:      API responded with a failure
//   - message:    short explanation for the banner + fix link

export const revalidate = 60;

type Status =
  | { configured: false; ok: false }
  | { configured: true; ok: true }
  | { configured: true; ok: false; message: string; fixUrl?: string };

async function checkMeta(): Promise<Status> {
  const proxyUrl = process.env.META_PROXY_URL;
  const proxyKey = process.env.META_PROXY_API_KEY;
  const metaToken = process.env.META_ACCESS_TOKEN;
  const metaAccount = process.env.META_AD_ACCOUNT_ID;
  const useProxy = proxyUrl && proxyKey && !proxyUrl.includes('localhost');

  // Try proxy first if available
  if (useProxy) {
    try {
      const healthRes = await fetch(`${proxyUrl}/health`, { cache: 'no-store' });
      if (healthRes.ok) {
        const health = await healthRes.json().catch(() => ({}));
        if (health.has_token) {
          const testRes = await fetch(`${proxyUrl}/api/insights?date_preset=today&level=account`, {
            headers: { 'X-API-Key': proxyKey! },
            cache: 'no-store',
          });
          const json = await testRes.json().catch(() => ({}));
          if (testRes.ok && !json.error) return { configured: true, ok: true };
        }
      }
    } catch (_e) { /* proxy failed, try direct */ }
  }

  // Fallback: direct Meta Graph API
  if (metaToken && metaAccount) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/act_${metaAccount}/insights?date_preset=today&fields=spend&access_token=${metaToken}`,
        { cache: 'no-store' }
      );
      const json = await res.json().catch(() => ({}));
      if (res.ok && !json.error) return { configured: true, ok: true };
      const msg = json.error?.message ?? `HTTP ${res.status}`;
      return { configured: true, ok: false, message: msg, fixUrl: 'https://business.facebook.com/settings/system-users' };
    } catch (e) {
      return { configured: true, ok: false, message: e instanceof Error ? e.message : 'fetch failed' };
    }
  }

  if (!metaToken || !metaAccount) return { configured: false, ok: false };
  return {
    configured: true,
    ok: false,
    message: 'No proxy or direct token available',
  };
}

async function checkGHL(): Promise<Status> {
  const token = process.env.GHL_API_KEY;
  const loc = process.env.GHL_LOCATION_ID;
  if (!token || !loc) return { configured: false, ok: false };
  try {
    const res = await fetch(
      `https://services.leadconnectorhq.com/locations/${loc}`,
      {
        headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' },
        cache: 'no-store',
      },
    );
    if (res.ok) return { configured: true, ok: true };
    return {
      configured: true,
      ok: false,
      message: `HTTP ${res.status} — token invalid or revoked`,
      fixUrl: 'https://app.gohighlevel.com/v2/settings/integrations',
    };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      message: e instanceof Error ? e.message : 'unreachable',
    };
  }
}

async function checkTypeform(): Promise<Status> {
  const token = process.env.TYPEFORM_TOKEN;
  if (!token) return { configured: false, ok: false };
  try {
    const res = await fetch('https://api.typeform.com/me', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.ok) return { configured: true, ok: true };
    return { configured: true, ok: false, message: `HTTP ${res.status}`, fixUrl: 'https://admin.typeform.com/account#/section/tokens' };
  } catch (e) {
    return { configured: true, ok: false, message: e instanceof Error ? e.message : 'unreachable' };
  }
}

async function checkCalendly(): Promise<Status> {
  const token = process.env.CALENDLY_TOKEN;
  if (!token) return { configured: false, ok: false };
  try {
    const res = await fetch('https://api.calendly.com/users/me', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.ok) return { configured: true, ok: true };
    return { configured: true, ok: false, message: `HTTP ${res.status}`, fixUrl: 'https://calendly.com/integrations' };
  } catch (e) {
    return { configured: true, ok: false, message: e instanceof Error ? e.message : 'unreachable' };
  }
}

async function checkWhop(): Promise<Status> {
  const token = process.env.WHOP_API_KEY;
  if (!token) return { configured: false, ok: false };
  try {
    const res = await fetch('https://api.whop.com/api/v5/company', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.ok) return { configured: true, ok: true };
    return { configured: true, ok: false, message: `HTTP ${res.status}`, fixUrl: 'https://dash.whop.com/settings/developer' };
  } catch (e) {
    return { configured: true, ok: false, message: e instanceof Error ? e.message : 'unreachable' };
  }
}

async function checkFathom(): Promise<Status> {
  // Fathom only returns the operator's personal calls, not team calls.
  // Grain is the primary source for closer call recordings.
  // Downgrade to env-only check to avoid false "broken" alerts.
  const token = process.env.FATHOM_API_KEY;
  if (!token) return { configured: false, ok: false };
  return { configured: true, ok: true };
}

async function checkGrain(): Promise<Status> {
  const token = process.env.GRAIN_API_KEY;
  if (!token) return { configured: false, ok: false };
  try {
    const res = await fetch('https://api.grain.com/_/public-api/me', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.ok) return { configured: true, ok: true };
    return { configured: true, ok: false, message: `HTTP ${res.status}`, fixUrl: 'https://grain.com/app/settings/integrations' };
  } catch (e) {
    return { configured: true, ok: false, message: e instanceof Error ? e.message : 'unreachable' };
  }
}

async function checkScoring(): Promise<Status> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { configured: false, ok: false };
  try {
    const { getServerSupabaseAsync } = await import('@/lib/supabase/server');
    const sb = await getServerSupabaseAsync();
    if (!sb) return { configured: true, ok: false, message: 'Supabase not configured' };
    const { error } = await sb.from('lead_scores').select('lead_id', { count: 'exact', head: true });
    if (error) return { configured: true, ok: false, message: error.message };
    return { configured: true, ok: true };
  } catch (e) {
    return { configured: true, ok: false, message: e instanceof Error ? e.message : 'unknown' };
  }
}

async function checkSlack(): Promise<Status> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { configured: false, ok: false };
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const json = await res.json();
    if (json.ok) return { configured: true, ok: true };
    return { configured: true, ok: false, message: json.error || 'auth.test failed' };
  } catch (e) {
    return { configured: true, ok: false, message: e instanceof Error ? e.message : 'unreachable' };
  }
}

async function checkYouTube(): Promise<Status> {
  const key = process.env.YOUTUBE_API_KEY;
  const channel = process.env.YOUTUBE_CHANNEL_ID;
  if (!key || !channel) return { configured: false, ok: false };
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=id&id=${channel}&key=${key}`,
      { cache: 'no-store' },
    );
    if (res.ok) return { configured: true, ok: true };
    return { configured: true, ok: false, message: `HTTP ${res.status}` };
  } catch (e) {
    return { configured: true, ok: false, message: e instanceof Error ? e.message : 'unreachable' };
  }
}

async function checkSheets(): Promise<Status> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !key || !sheetId) {
    return { configured: false, ok: false };
  }
  try {
    const { fetchSheetPaymentLog } = await import('@/lib/mappers/sheets-payment-log');
    const data = await fetchSheetPaymentLog();
    return { configured: true, ok: true };
  } catch (e: any) {
    return { configured: true, ok: false, message: e?.message ?? 'Sheets API error' };
  }
}

// Lightweight checks for integrations we haven't wired yet — just env var
// presence. Upgrade to real pings as each pillar lands.
function envOnly(...vars: string[]): Status {
  const all = vars.every(v => !!process.env[v]);
  return all ? { configured: true, ok: true } : { configured: false, ok: false };
}

export async function GET() {
  const [meta, ghl, typeform, calendly, whop, fathom, grain, scoring, slack, youtube, sheets] = await Promise.all([checkMeta(), checkGHL(), checkTypeform(), checkCalendly(), checkWhop(), checkFathom(), checkGrain(), checkScoring(), checkSlack(), checkYouTube(), checkSheets()]);

  return NextResponse.json({
    meta,
    ghl,
    youtube,
    typeform,
    calendly,
    instagram: envOnly('INSTAGRAM_ACCESS_TOKEN'),
    twitter: await (async (): Promise<Status> => {
      const token = process.env.TWITTER_BEARER_TOKEN;
      const username = process.env.TWITTER_USERNAME;
      if (!token || !username) return { configured: false, ok: false };
      try {
        const res = await fetch(`https://api.x.com/2/users/by/username/${username}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (res.ok) return { configured: true, ok: true };
        return { configured: true, ok: false, message: `HTTP ${res.status}` };
      } catch (e) {
        return { configured: true, ok: false, message: e instanceof Error ? e.message : 'unreachable' };
      }
    })(),
    linkedin: envOnly('LINKEDIN_ACCESS_TOKEN'),
    grain,
    fathom,
    whop,
    scoring,
    slack,
    fanbasis: await (async (): Promise<Status> => {
      const key = process.env.FANBASIS_API_KEY;
      if (!key) return { configured: false, ok: false };
      try {
        const res = await fetch('https://www.fanbasis.com/public-api/subscribers?per_page=1&page=1', {
          headers: { 'x-api-key': key, Accept: 'application/json' },
          cache: 'no-store',
        });
        if (res.ok) return { configured: true, ok: true };
        return { configured: true, ok: false, message: `HTTP ${res.status}` };
      } catch (e) {
        return { configured: true, ok: false, message: e instanceof Error ? e.message : 'unreachable' };
      }
    })(),
    hyros: envOnly('HYROS_API_KEY'),
    googleSheets: sheets,
    monday: await (async (): Promise<Status> => {
      const key = process.env.MONDAY_API_KEY;
      if (!key) return { configured: false, ok: false };
      try {
        const res = await fetch('https://api.monday.com/v2', {
          method: 'POST',
          headers: { Authorization: key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ me { name } }' }),
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.data?.me?.name) return { configured: true, ok: true };
        }
        return { configured: true, ok: false, message: `HTTP ${res.status}` };
      } catch (e) {
        return { configured: true, ok: false, message: e instanceof Error ? e.message : 'unreachable' };
      }
    })(),
  });
}
