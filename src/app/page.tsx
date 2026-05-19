'use client';

import { Suspense, useState } from 'react';
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
import { useDashboardData } from '@/hooks/useDashboardData';

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
function MainDashboardInner() {
  const { leads, refresh } = useDashboardData();

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
    <div className="px-6 py-5 space-y-5 max-w-[1600px] mx-auto">
      {/* 1. Header strip — sticky so the timeframe filter stays accessible
          while scrolling through the dashboard (the operator 2026-04-30) */}
      <div className="sticky top-0 z-30 -mx-6 px-6 py-3 bg-[#0a0c0f]/95 backdrop-blur supports-[backdrop-filter]:bg-[#0a0c0f]/75 border-b border-gray-800/50">
        <div className="flex items-center justify-between flex-wrap gap-3 max-w-[1600px] mx-auto">
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
      <HeadlineKPIs />

      {/* 4. Revenue Trajectory — MTD cumulative pace chart (sits above the
          numerical Pace vs Projection table so the visual story comes first) */}
      <RevenueTrajectory />

      {/* 5. Pace vs Projection (numerical detail) */}
      <PaceVsProjection />

      {/* 5. Combined Closer + CSM Leaderboard */}
      <CloserLeaderboardCard />

      {/* 7. Sales Funnel by Source */}
      <SalesFunnelBySource />

      {/* 8. Three donuts row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <RevenueComposition />
        <CashBySource />
        <CashByOffer />
      </div>

      {/* 9. LTV by Program */}
      <LTVByProgram />

      {/* 10. Expenses */}
      <ExpenseBreakdown />
    </div>
  );
}

export default function MainDashboard() {
  return (
    <Suspense fallback={<div className="px-6 py-6 text-gray-400 text-sm">Loading…</div>}>
      <MainDashboardInner />
    </Suspense>
  );
}
