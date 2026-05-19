'use client';

import { useMemo } from 'react';
import { Lead, Ad, DailyMetrics } from '@/lib/types';

interface WeeklyComparisonProps {
  leads: Lead[];
  ads: Ad[];
  dailyMetrics: DailyMetrics[];
}

interface WeekBucket {
  label: string;
  startDate: string;
  endDate: string;
  leads: Lead[];
  dailyMetrics: DailyMetrics[];
  ads: Ad[];
}

interface WeekMetrics {
  label: string;
  totalLeads: number;
  callsBooked: number;
  showRate: number;
  callsShowed: number;
  closeRate: number;
  dealsClosed: number;
  cashCollected: number;
  contractedRevenue: number;
  spend: number;
  cpl: number;
  cpa: number;
  roas: number;
}

type MetricKey = keyof Omit<WeekMetrics, 'label'>;

interface MetricConfig {
  key: MetricKey;
  label: string;
  format: 'number' | 'percent' | 'currency' | 'multiplier';
  higherIsBetter: boolean;
}

const METRIC_CONFIGS: MetricConfig[] = [
  { key: 'totalLeads', label: 'Total Leads', format: 'number', higherIsBetter: true },
  { key: 'callsBooked', label: 'Calls Booked', format: 'number', higherIsBetter: true },
  { key: 'showRate', label: 'Show Rate', format: 'percent', higherIsBetter: true },
  { key: 'callsShowed', label: 'Calls Showed', format: 'number', higherIsBetter: true },
  { key: 'closeRate', label: 'Close Rate', format: 'percent', higherIsBetter: true },
  { key: 'dealsClosed', label: 'Deals Closed', format: 'number', higherIsBetter: true },
  { key: 'cashCollected', label: 'Cash Collected', format: 'currency', higherIsBetter: true },
  { key: 'contractedRevenue', label: 'Contracted Revenue', format: 'currency', higherIsBetter: true },
  { key: 'spend', label: 'Spend', format: 'currency', higherIsBetter: false },
  { key: 'cpl', label: 'CPL', format: 'currency', higherIsBetter: false },
  { key: 'cpa', label: 'Cost for Acquisition', format: 'currency', higherIsBetter: false },
  { key: 'roas', label: 'ROAS', format: 'multiplier', higherIsBetter: true },
];

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function formatValue(value: number, format: MetricConfig['format']): string {
  if (!isFinite(value) || isNaN(value)) {
    return format === 'percent' ? '0%' : format === 'currency' ? '$0' : format === 'multiplier' ? '0.0x' : '0';
  }
  switch (format) {
    case 'currency':
      if (value >= 1000) {
        return `$${(value / 1000).toFixed(1)}k`;
      }
      return `$${Math.round(value).toLocaleString()}`;
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'multiplier':
      return `${value.toFixed(2)}x`;
    case 'number':
      return value.toLocaleString();
    default:
      return String(value);
  }
}

function computePercentChange(current: number, previous: number): number | null {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return current > 0 ? 100 : -100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export default function WeeklyComparison({ leads, ads, dailyMetrics }: WeeklyComparisonProps) {
  const weeks = useMemo(() => {
    if (dailyMetrics.length === 0) return [];

    // Find the date range from dailyMetrics
    const allDates = dailyMetrics.map(d => d.date).sort();
    const latestDate = new Date(allDates[allDates.length - 1] + 'T00:00:00');
    const sixtyDaysAgo = new Date(latestDate);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 59);

    // Generate week buckets from Monday-Sunday
    const buckets: WeekBucket[] = [];
    let currentMonday = getMonday(latestDate);

    while (currentMonday >= getMonday(sixtyDaysAgo) && buckets.length < 8) {
      const sunday = new Date(currentMonday);
      sunday.setDate(sunday.getDate() + 6);

      const startStr = currentMonday.toISOString().split('T')[0];
      const endStr = sunday.toISOString().split('T')[0];

      buckets.push({
        label: `${formatShortDate(startStr)} - ${formatShortDate(endStr)}`,
        startDate: startStr,
        endDate: endStr,
        leads: leads.filter(l => l.date >= startStr && l.date <= endStr),
        dailyMetrics: dailyMetrics.filter(d => d.date >= startStr && d.date <= endStr),
        ads: ads,
      });

      // Move to previous Monday
      currentMonday = new Date(currentMonday);
      currentMonday.setDate(currentMonday.getDate() - 7);
    }

    return buckets; // Most recent first
  }, [leads, ads, dailyMetrics]);

  const weekMetrics: WeekMetrics[] = useMemo(() => {
    return weeks.map(week => {
      const totalLeads = week.leads.length;
      const callsBooked = week.leads.filter(l => l.demoBooked).length;
      const callsShowed = week.leads.filter(l => l.showStatus === 'Showed').length;
      const dealsClosed = week.leads.filter(l => l.callOutcome === 'Closed Won').length;
      const cashCollected = week.leads.reduce((sum, l) => sum + l.cashCollected, 0);
      const contractedRevenue = week.leads.reduce((sum, l) => sum + l.contractedRevenue, 0);
      const spend = week.dailyMetrics.reduce((sum, d) => sum + d.spend, 0);

      const showRate = callsBooked > 0 ? (callsShowed / callsBooked) * 100 : 0;
      const closeRate = callsShowed > 0 ? (dealsClosed / callsShowed) * 100 : 0;
      const cpl = totalLeads > 0 ? spend / totalLeads : 0;
      const cpa = dealsClosed > 0 ? spend / dealsClosed : 0;
      const roas = spend > 0 ? contractedRevenue / spend : 0;

      return {
        label: week.label,
        totalLeads,
        callsBooked,
        showRate,
        callsShowed,
        closeRate,
        dealsClosed,
        cashCollected,
        contractedRevenue,
        spend,
        cpl,
        cpa,
        roas,
      };
    });
  }, [weeks]);

  if (weekMetrics.length === 0) {
    return null;
  }

  const wowChange = (metricKey: MetricKey): number | null => {
    if (weekMetrics.length < 2) return null;
    return computePercentChange(weekMetrics[0][metricKey], weekMetrics[1][metricKey]);
  };

  const getCellColor = (
    currentIdx: number,
    metricKey: MetricKey,
    higherIsBetter: boolean
  ): string => {
    if (currentIdx >= weekMetrics.length - 1) return '';
    const current = weekMetrics[currentIdx][metricKey];
    const previous = weekMetrics[currentIdx + 1][metricKey];
    if (current === previous) return '';
    const improved = higherIsBetter ? current > previous : current < previous;
    return improved ? 'text-emerald-400' : 'text-red-400';
  };

  const getArrow = (
    currentIdx: number,
    metricKey: MetricKey,
    higherIsBetter: boolean
  ): string => {
    if (currentIdx >= weekMetrics.length - 1) return '';
    const current = weekMetrics[currentIdx][metricKey];
    const previous = weekMetrics[currentIdx + 1][metricKey];
    if (current === previous) return '';
    const improved = higherIsBetter ? current > previous : current < previous;
    return improved ? '▲' : '▼';
  };

  return (
    <div className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-white">Weekly Comparison</h3>
        <p className="text-xs text-gray-500 mt-0.5">Week-over-week performance across key metrics</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="sticky left-0 z-10 bg-[#1a1d23] text-left px-4 py-3 text-gray-400 font-medium min-w-[160px]">
                Metric
              </th>
              {weekMetrics.map((wm, idx) => (
                <th
                  key={idx}
                  className={`px-3 py-3 text-center font-medium min-w-[110px] ${
                    idx === 0 ? 'text-white bg-[#1e2128]' : 'text-gray-500'
                  }`}
                >
                  <span className={idx === 0 ? 'font-bold' : ''}>{wm.label}</span>
                  {idx === 0 && (
                    <span className="block text-[10px] text-blue-400 mt-0.5">Current</span>
                  )}
                </th>
              ))}
              <th className="px-3 py-3 text-center text-gray-400 font-medium min-w-[90px] border-l border-gray-700">
                WoW Change
              </th>
            </tr>
          </thead>
          <tbody>
            {METRIC_CONFIGS.map((config) => {
              const change = wowChange(config.key);
              const changeIsGood = change !== null
                ? config.higherIsBetter ? change > 0 : change < 0
                : null;

              return (
                <tr key={config.key} className="border-b border-gray-700/50 hover:bg-[#1e2128]/50">
                  <td className="sticky left-0 z-10 bg-[#1a1d23] px-4 py-2.5 text-gray-300 font-medium text-sm whitespace-nowrap">
                    {config.label}
                  </td>
                  {weekMetrics.map((wm, idx) => {
                    const color = getCellColor(idx, config.key, config.higherIsBetter);
                    const arrow = getArrow(idx, config.key, config.higherIsBetter);
                    return (
                      <td
                        key={idx}
                        className={`px-3 py-2.5 text-center whitespace-nowrap ${
                          idx === 0 ? 'text-white font-semibold bg-[#1e2128]' : 'text-gray-400'
                        }`}
                      >
                        <span>{formatValue(wm[config.key], config.format)}</span>
                        {arrow && (
                          <span className={`ml-1 text-[10px] ${color}`}>{arrow}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2.5 text-center whitespace-nowrap border-l border-gray-700">
                    {change !== null ? (
                      <span className={`text-sm font-semibold ${changeIsGood ? 'text-emerald-400' : 'text-red-400'}`}>
                        {change > 0 ? '+' : ''}{change.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
