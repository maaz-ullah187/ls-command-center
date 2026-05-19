'use client';

import { isWithinKPI, formatMetric, getKPITarget } from '@/lib/kpi-config';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: number;
  kpiKey: string;
  format?: 'currency' | 'percentage' | 'multiplier' | 'number';
  previousValue?: number;
  onClick?: () => void;
  subtitle?: string;
}

export default function MetricCard({ label, value, kpiKey, format, previousValue, onClick, subtitle }: MetricCardProps) {
  const target = getKPITarget(kpiKey);
  const withinKPI = target ? isWithinKPI(kpiKey, value) : true;
  const displayFormat = target?.format ?? format ?? 'number';
  const formatted = formatMetric(value, displayFormat);

  const change = previousValue && previousValue > 0
    ? ((value - previousValue) / previousValue) * 100
    : null;

  const changeIsGood = target
    ? (target.direction === 'higher' ? (change ?? 0) > 0 : (change ?? 0) < 0)
    : (change ?? 0) > 0;

  return (
    <button
      onClick={onClick}
      className={`
        relative p-4 rounded-xl border text-left transition-all duration-200 w-full
        hover:shadow-lg hover:scale-[1.02]
        ${onClick ? 'cursor-pointer' : 'cursor-default'}
        ${withinKPI
          ? 'bg-[#1a1d23] border-gray-700 hover:border-gray-500'
          : 'bg-red-950/30 border-red-800/50 hover:border-red-600'
        }
      `}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">{label}</span>
        {!withinKPI && <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
      </div>
      <div className={`text-xl font-bold ${withinKPI ? 'text-white' : 'text-red-400'}`}>
        {formatted}
      </div>
      {subtitle && (
        <div className="text-[11px] text-gray-500 mt-0.5">{subtitle}</div>
      )}
      {change !== null && (
        <div className={`flex items-center gap-1 mt-1.5 text-[11px] font-medium ${changeIsGood ? 'text-emerald-400' : 'text-red-400'}`}>
          {change > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          <span>{change > 0 ? '+' : ''}{change.toFixed(1)}% vs prior</span>
        </div>
      )}
      {target && (
        <div className="mt-1 text-[10px] text-gray-600">
          Target: {formatMetric(target.target, target.format)}
        </div>
      )}
    </button>
  );
}
