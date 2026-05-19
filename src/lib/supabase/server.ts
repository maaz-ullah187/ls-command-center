// Server-side Supabase client (service role).
//
// Used by API routes and sync workers. NEVER imported by client components —
// the service role key bypasses RLS and must never reach the browser.
//
// IMPORTANT: this file uses a runtime dynamic import for `@supabase/supabase-js`
// so the dashboard keeps building before `npm install @supabase/supabase-js` has
// been run. Until the package is installed and SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY are present, getServerSupabase() returns null.
// Callers (dataSources.ts, sync workers) MUST handle the null case by falling
// back to mock data — this is the contract that lets every pillar ship
// independently without breaking the dashboard.

import 'server-only';

// Loose type so consumers don't need the package installed at compile time.
// Replace with `SupabaseClient` from `@supabase/supabase-js` once Pillar 0 is
// fully provisioned and the dependency is installed.
export type ServerSupabase = {
  from: (table: string) => any;
};

let cached: ServerSupabase | null | undefined;
let initPromise: Promise<ServerSupabase | null> | null = null;

async function init(): Promise<ServerSupabase | null> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  try {
    const mod = await import('@supabase/supabase-js').catch(() => null);
    if (!mod) return null;
    return mod.createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as ServerSupabase;
  } catch {
    return null;
  }
}

/**
 * Synchronous accessor that returns null until the dynamic import has resolved
 * once. The first call kicks off the import; subsequent calls (within the same
 * server process) return the cached client. Awaiting `getServerSupabaseAsync()`
 * is preferred when callers can be async.
 */
export function getServerSupabase(): ServerSupabase | null {
  return cached ?? null;
}

export async function getServerSupabaseAsync(): Promise<ServerSupabase | null> {
  if (cached !== undefined) return cached;
  if (!initPromise) initPromise = init();
  cached = await initPromise;
  return cached;
}

/** True when the server has working Supabase credentials AND the package is installed. */
export async function isSupabaseConfigured(): Promise<boolean> {
  return (await getServerSupabaseAsync()) !== null;
}
