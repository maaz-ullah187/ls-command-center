'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import HeadlineKPIs from '@/components/main/HeadlineKPIs';
import PaceVsProjection from '@/components/main/PaceVsProjection';
import RevenueTrajectory from '@/components/main/RevenueTrajectory';
import TimeframeFilter from '@/components/main/TimeframeFilter';
import CloserLeaderboardCard from '@/components/main/CloserLeaderboardCard';
import SalesFunnelBySource from '@/components/main/SalesFunnelBySource';
import RevenueComposition from '@/components/main/RevenueComposition';
import CashBySource from '@/components/main/CashBySource';
import CashByOffer from '@/components/main/CashByOffer';
import ExpenseBreakdown from '@/components/main/ExpenseBreakdown';
import LTVByProgram from '@/components/main/LTVByProgram';
import ReviewQueueBanner from '@/components/ReviewQueueBanner';
import { useTimeframe } from '@/lib/useTimeframe';
import type { Lead } from '@/lib/types';

// Aggregated dashboard payload shape — keys match RESPONSE_KEY in
// /api/main/dashboard-data/route.ts.
interface AggregatedDashboardData {
  headline?: unknown;
  revenueBuckets?: unknown;
  revenueComposition?: unknown;
  revenueTrajectory?: unknown;
  cashBreakdown?: unknown;
  ltvCac?: unknown;
  closerLeaderboard?: unknown;
  salesFunnel?: unknown;
  expenseBreakdown?: unknown;
  window?: { from?: string | null; to?: string | null; month?: string | null };
  errors?: Record<string, unknown>;
}

/**
 * Main Dashboard — `/`. Migrates Metabase board 133 into our app shell.
 * Phase 1 sections (top → bottom):
 *   1. Header strip — title + universal timeframe filter
 *   2. Daily Review Queue banner
 *   3. Headline KPIs (6 cards)
 *   4. MTD Pace vs Projection (interactive — writes to t21_monthly_projections)
 *   5. Closer Leaderboard
 *   6. CSM Performance               [scaffolded]
 *   7. Sales Funnel by Source
 *   8. Revenue Composition + Cash by Source + Cash by Offer (3 donuts)
 *   9. LTV by Program + CAC→LTGP    [scaffolded]
 *  10. AR / Backend Collection      [scaffolded]
 *  11. Expense Breakdown
 *  12. Mirrors (Recent Leads / Calls / Sales) — collapsed by default
 */
interface MainDashboardClientProps {
  initialAgg: AggregatedDashboardData | null;
  initialLeads: Lead[];
}

export default function MainDashboardClient({ initialAgg, initialLeads }: MainDashboardClientProps) {
  const tf = useTimeframe();

  // ── Lightweight leads fetch (replaces useDashboardData) ────────────
  // ReviewQueueBanner is the only consumer of `leads` on this page.
  // The previous useDashboardData() call fired 10 sibling fetches we
  // don't need here — main-dashboard data comes from the aggregated
  // endpoint below.
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [leadsTick, setLeadsTick] = useState(0);
  const firstLeadsFetchSkipped = useRef(initialLeads.length > 0);
  useEffect(() => {
    if (firstLeadsFetchSkipped.current) {
      firstLeadsFetchSkipped.current = false;
      return;
    }
    let cancelled = false;
    fetch('/api/data/leads', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setLeads(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setLeads([]); });
    return () => { cancelled = true; };
  }, [leadsTick]);
  const refresh = () => setLeadsTick((t) => t + 1);

  // ── Single aggregated dashboard fetch ──────────────────────────────
  // Hits /api/main/dashboard-data which fans out to all 8 sub-routes in
  // parallel server-side. Pre-warms every unstable_cache entry; payload is
  // passed to components as `initialData` so they skip their first fetch.
  // Re-runs on timeframe change so children get the fresh window.
  const [agg, setAgg] = useState<AggregatedDashboardData | null>(initialAgg);
  const initialWindowKey = `${initialAgg?.window?.from ?? ''}:${initialAgg?.window?.to ?? ''}`;
  const firstAggFetchSkipped = useRef(false);
  useEffect(() => {
    const currentWindowKey = `${tf.from ?? ''}:${tf.to ?? ''}`;
    if (!firstAggFetchSkipped.current && initialAgg && currentWindowKey === initialWindowKey) {
      firstAggFetchSkipped.current = true;
      return;
    }
    firstAggFetchSkipped.current = true;
    let cancelled = false;
    const qs = new URLSearchParams();
    if (tf.from) qs.set('from', tf.from);
    if (tf.to) qs.set('to', tf.to);
    fetch(`/api/main/dashboard-data?${qs.toString()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setAgg(d as AggregatedDashboardData); })
      .catch(() => { if (!cancelled) setAgg(null); });
    return () => { cancelled = true; };
  }, [tf.from, tf.to]);

  // Persist Unknown-Source assignments (and any other lead-field edits from
  // the Daily Review Queue) to t16_overrides so they survive a page refresh.
  // Previously this was just `() => refresh()`, which threw away the updates
  // — meaning the Unknown Source dropdown looked like it worked but the
  // assignment was lost on next reload. Bug fixed 2026-04-30.
  async function handleUpdateLead(leadId: string, updates: Partial<import('@/lib/types').Lead>) {
    try {
      await Promise.all(
        Object.entries(updates).map(([field, value]) =>
          fetch('/api/overrides', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              table_name: 't01_leads',
              row_id: leadId,
              field,
              corrected: value,
              edited_by: 'dashboard',
            }),
          })
        )
      );
    } finally {
      refresh();
    }
  }

  return (
    <div className="px-6 py-5 space-y-5 max-w-400 mx-auto">
      {/* 1. Header strip — sticky so the timeframe filter stays accessible
          while scrolling through the dashboard (the operator 2026-04-30) */}
      <div className="sticky top-0 z-30 -mx-6 px-6 py-3 bg-[#0a0c0f]/95 backdrop-blur supports-backdrop-filter:bg-[#0a0c0f]/75 border-b border-gray-800/50">
        <div className="flex items-center justify-between flex-wrap gap-3 max-w-400 mx-auto">
          <div>
            <h1 className="text-white font-bold text-xl">Main Dashboard</h1>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Migrated from Metabase board 133 · live data from Supabase
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TimeframeFilter />
            <button
              onClick={refresh}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#1a1d23] border border-gray-700 hover:border-gray-500 text-gray-300 text-[11px] transition-colors"
              title="Refresh data"
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* 2. Daily Review Queue banner */}
      <ReviewQueueBanner leads={leads} onUpdateLead={handleUpdateLead} />

      {/* 3. Headline KPIs */}
      <HeadlineKPIs
        initialRevBuckets={agg?.revenueBuckets as never}
      />

      {/* 4. Revenue Trajectory — MTD cumulative pace chart (sits above the
          numerical Pace vs Projection table so the visual story comes first) */}
      <RevenueTrajectory initialData={agg?.revenueTrajectory as never} />

      {/* 5. Pace vs Projection (numerical detail) */}
      <PaceVsProjection />

      {/* 5. Combined Closer + CSM Leaderboard */}
      <CloserLeaderboardCard initialData={agg?.closerLeaderboard as never} />

      {/* 7. Sales Funnel by Source */}
      <SalesFunnelBySource initialData={agg?.salesFunnel as never} />

      {/* 8. Three donuts row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <RevenueComposition initialData={agg?.revenueBuckets as never} />
        <CashBySource initialData={agg?.cashBreakdown as never} />
        <CashByOffer initialData={agg?.cashBreakdown as never} />
      </div>

      {/* 9. LTV by Program */}
      <LTVByProgram initialData={agg?.ltvCac as never} />

      {/* 10. Expenses */}
      <ExpenseBreakdown />
    </div>
  );
}
