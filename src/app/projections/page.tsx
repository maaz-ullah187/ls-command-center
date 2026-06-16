'use client';

/**
 * /projections — Sales Funnel Financial Model (actuals vs projections).
 *
 * Standalone page wrapper around <ProjectionsTab/>. Wires the same data
 * sources that Dashboard.tsx feeds into the embedded version:
 *   - leads + ads: useDashboardData, date-filtered to the selected window
 *   - sheetRevenue: useDashboardData (driven by /api/main/revenue-buckets)
 *   - dateRange: local state with a TimeframeSelector to change it
 *
 * Routed via Sidebar → "Projections" (pink Target icon).
 */

import { useMemo, useState } from 'react';
import type { DateRange } from '@/components/TimeframeSelector';
import TimeframeSelector from '@/components/TimeframeSelector';
import { useDashboardData } from '@/hooks/useDashboardData';
import { filterByDateRange } from '@/lib/calculations';
import ProjectionsTab from '@/components/tabs/ProjectionsTab';

export default function ProjectionsPage() {
  // Default to "This Month" (same default Dashboard.tsx uses).
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const today = now.toISOString().split('T')[0];
    return { start: monthStart, end: today, label: 'This Month' };
  });

  const { leads: rawLeads, ads: rawAds, sheetRevenue, loading } =
    useDashboardData({
      dateRange,
      sources: ['leads', 'ads', 'sheetRevenue'],
    });

  // Date-scope leads + ads the same way Dashboard.tsx does. Ads without a
  // `date` field (aggregate rows) pass through since we can't time-bound them.
  const filteredLeads = useMemo(
    () => filterByDateRange(rawLeads, dateRange.start, dateRange.end),
    [rawLeads, dateRange.start, dateRange.end],
  );
  const filteredAds = useMemo(
    () =>
      rawAds.filter((a) => {
        if (a.date) return a.date >= dateRange.start && a.date <= dateRange.end;
        return true;
      }),
    [rawAds, dateRange.start, dateRange.end],
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Projections</h1>
          <p className="text-xs text-gray-400 mt-1">
            Sales Funnel Financial Model — actuals vs projections.
            Edit any target inline; saved per metric per month.
          </p>
        </div>
        <TimeframeSelector value={dateRange} onChange={setDateRange} />
      </div>

      {loading && filteredLeads.length === 0 && filteredAds.length === 0 ? (
        <div className="text-center text-gray-500 py-12 text-sm">Loading…</div>
      ) : (
        <ProjectionsTab
          leads={filteredLeads}
          ads={filteredAds}
          sheetRevenue={sheetRevenue}
          dateRange={dateRange}
        />
      )}
    </div>
  );
}
