import { KPITarget } from './types';

export const KPI_TARGETS: KPITarget[] = [
  { label: 'CPC', key: 'cpc', target: 250, format: 'currency', direction: 'lower', alertThreshold: 15 },
  { label: 'CPL', key: 'cpl', target: 80, format: 'currency', direction: 'lower', alertThreshold: 15 },
  { label: 'Cost Per Schedule', key: 'costPerSchedule', target: 150, format: 'currency', direction: 'lower', alertThreshold: 15 },
  { label: 'CPQC', key: 'cpqc', target: 300, format: 'currency', direction: 'lower', alertThreshold: 15 },
  { label: 'Cost for Acquisition', key: 'costPerPurchase', target: 400, format: 'currency', direction: 'lower', alertThreshold: 15 },
  { label: 'ROAS', key: 'roas', target: 2.0, format: 'multiplier', direction: 'higher', alertThreshold: 15 },
  { label: 'Close Rate', key: 'closeRate', target: 30, format: 'percentage', direction: 'higher', alertThreshold: 10 },
  { label: 'Show Rate', key: 'showRate', target: 70, format: 'percentage', direction: 'higher', alertThreshold: 10 },
  { label: '$ Per Call', key: 'dollarPerCall', target: 500, format: 'currency', direction: 'higher', alertThreshold: 15 },
];

export function getKPITarget(key: string): KPITarget | undefined {
  return KPI_TARGETS.find(k => k.key === key);
}

export function isWithinKPI(key: string, value: number): boolean {
  const target = getKPITarget(key);
  if (!target) return true;
  if (target.direction === 'lower') return value <= target.target;
  return value >= target.target;
}

export function formatMetric(value: number, format: KPITarget['format']): string {
  switch (format) {
    case 'currency': return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'percentage': return `${value.toFixed(1)}%`;
    case 'multiplier': return `${value.toFixed(2)}x`;
    case 'number': return value.toLocaleString();
  }
}
