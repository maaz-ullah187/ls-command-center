import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getLeads } from '@/lib/dataSources';

export const revalidate = 60;
export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Allow up to 2 min for full GHL pull

// Cached at the data layer via unstable_cache (60s TTL). Replaces the prior
// per-instance in-memory cache: that one was scoped to a single serverless
// instance and didn't survive cold starts; unstable_cache is shared across
// the deployment and tag-invalidatable.
//
// getLeads takes no args, so the cache key is just the module-level array
// part. The 60s revalidate matches the main-dashboard sub-routes.
const getLeadsCached = unstable_cache(
  async () => getLeads(),
  ['data:leads'],
  { revalidate: 60, tags: ['leads'] },
);

export async function GET() {
  try {
    const leads = await getLeadsCached();
    return NextResponse.json(leads);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load leads';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
