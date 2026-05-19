// Browser-side Supabase client (anon key).
//
// Safe to import from React components. Used for realtime subscriptions
// (so dashboard cards can live-update when sync workers write new data)
// and read-only queries that don't need server-side filtering.
//
// Uses a runtime dynamic import for `@supabase/supabase-js` so the dashboard
// keeps building before `npm install @supabase/supabase-js` has been run.
// Returns null until the package is installed AND env vars are present.

export type BrowserSupabase = {
  from: (table: string) => any;
  channel: (name: string) => any;
};

let cached: BrowserSupabase | null | undefined;
let initPromise: Promise<BrowserSupabase | null> | null = null;

async function init(): Promise<BrowserSupabase | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  try {
    const mod = await import('@supabase/supabase-js').catch(() => null);
    if (!mod) return null;
    return mod.createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as BrowserSupabase;
  } catch {
    return null;
  }
}

export async function getBrowserSupabaseAsync(): Promise<BrowserSupabase | null> {
  if (cached !== undefined) return cached;
  if (!initPromise) initPromise = init();
  cached = await initPromise;
  return cached;
}
