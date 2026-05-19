// Sync health monitor
//
// Checks MAX(updated_at) for each critical sync table and compares against
// the expected cron frequency. Returns { healthy, stale, tables } so you
// can see at a glance which syncs are current.
//
// Staleness thresholds (based on vercel.json cron schedules):
//   t01_leads          — every 5 min  → stale after 15 min
//   t02_ads            — daily 6 AM   → stale after 26 hours
//   t03_bookings       — every 2 hr   → stale after 4 hours
//   t04_call_recordings — daily 8 PM  → stale after 26 hours

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

interface TableHealth {
  table: string;
  lastUpdated: string | null;
  minutesAgo: number | null;
  staleThresholdMin: number;
  stale: boolean;
}

const TABLES: { name: string; staleMinutes: number; timeCol: string }[] = [
  { name: 't01_leads', staleMinutes: 15, timeCol: 'updated_at' },
  { name: 't02_ads', staleMinutes: 26 * 60, timeCol: 'updated_at' },
  { name: 't03_bookings', staleMinutes: 4 * 60, timeCol: 'updated_at' },
  { name: 't04_call_recordings', staleMinutes: 26 * 60, timeCol: 'call_date' },
];

export async function GET() {
  const supabase = await getServerSupabaseAsync();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const now = Date.now();
  const tables: TableHealth[] = [];
  const stale: string[] = [];

  for (const { name, staleMinutes, timeCol } of TABLES) {
    const { data, error } = await supabase
      .from(name)
      .select(timeCol)
      .order(timeCol, { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      tables.push({
        table: name,
        lastUpdated: null,
        minutesAgo: null,
        staleThresholdMin: staleMinutes,
        stale: true,
      });
      stale.push(name);
      continue;
    }

    const lastUpdated = data?.[timeCol] ?? null;
    let minutesAgo: number | null = null;
    let isStale = true;

    if (lastUpdated) {
      minutesAgo = Math.round((now - new Date(lastUpdated).getTime()) / 60000);
      isStale = minutesAgo > staleMinutes;
    }

    if (isStale) stale.push(name);

    tables.push({
      table: name,
      lastUpdated,
      minutesAgo,
      staleThresholdMin: staleMinutes,
      stale: isStale,
    });
  }

  const healthy = stale.length === 0;

  return NextResponse.json({ healthy, stale, tables });
}
