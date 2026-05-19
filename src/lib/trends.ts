import { DailyMetrics } from './types';
import { KPI_TARGETS } from './kpi-config';

export interface TrendAlert {
  metric: string;
  label: string;
  currentValue: number;
  previousValue: number;
  changePercent: number;
  direction: 'up' | 'down';
  severity: 'warning' | 'critical';
}

export function detectTrends(dailyMetrics: DailyMetrics[]): TrendAlert[] {
  const alerts: TrendAlert[] = [];
  if (dailyMetrics.length < 14) return alerts;

  const currentWeek = dailyMetrics.slice(-7);
  const previousWeek = dailyMetrics.slice(-14, -7);

  const sum = (arr: DailyMetrics[], key: keyof DailyMetrics) =>
    arr.reduce((s, d) => s + (d[key] as number), 0);

  const checks = [
    {
      key: 'spend',
      label: 'Weekly Spend',
      current: sum(currentWeek, 'spend'),
      previous: sum(previousWeek, 'spend'),
      direction: 'lower' as const,
    },
    {
      key: 'leads',
      label: 'Weekly Leads',
      current: sum(currentWeek, 'leads'),
      previous: sum(previousWeek, 'leads'),
      direction: 'higher' as const,
    },
    {
      key: 'callsBooked',
      label: 'Calls Booked',
      current: sum(currentWeek, 'callsBooked'),
      previous: sum(previousWeek, 'callsBooked'),
      direction: 'higher' as const,
    },
    {
      key: 'showRate',
      label: 'Show Rate',
      current: sum(currentWeek, 'callsBooked') > 0
        ? (sum(currentWeek, 'callsShown') / sum(currentWeek, 'callsBooked')) * 100 : 0,
      previous: sum(previousWeek, 'callsBooked') > 0
        ? (sum(previousWeek, 'callsShown') / sum(previousWeek, 'callsBooked')) * 100 : 0,
      direction: 'higher' as const,
    },
    {
      key: 'closeRate',
      label: 'Close Rate',
      current: sum(currentWeek, 'callsShown') > 0
        ? (sum(currentWeek, 'callsClosed') / sum(currentWeek, 'callsShown')) * 100 : 0,
      previous: sum(previousWeek, 'callsShown') > 0
        ? (sum(previousWeek, 'callsClosed') / sum(previousWeek, 'callsShown')) * 100 : 0,
      direction: 'higher' as const,
    },
    {
      key: 'revenue',
      label: 'Weekly Revenue',
      current: sum(currentWeek, 'revenue'),
      previous: sum(previousWeek, 'revenue'),
      direction: 'higher' as const,
    },
  ];

  for (const check of checks) {
    if (check.previous === 0) continue;
    const change = ((check.current - check.previous) / check.previous) * 100;
    const threshold = KPI_TARGETS.find(k => k.key === check.key)?.alertThreshold ?? 10;

    const isBad =
      (check.direction === 'higher' && change < -threshold) ||
      (check.direction === 'lower' && change > threshold);

    if (isBad) {
      alerts.push({
        metric: check.key,
        label: check.label,
        currentValue: check.current,
        previousValue: check.previous,
        changePercent: Math.round(change * 10) / 10,
        direction: change > 0 ? 'up' : 'down',
        severity: Math.abs(change) > threshold * 2 ? 'critical' : 'warning',
      });
    }
  }

  return alerts;
}
