'use client';

import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

export interface DonutSlice {
  label: string;
  value: number;
}

interface DonutProps {
  data: DonutSlice[];
  format?: (n: number) => string;
  empty?: string;
  /** Hide built-in legend — caller renders its own (e.g. ExpenseBreakdown). */
  hideLegend?: boolean;
  /** Total label override (default "Total"). */
  totalLabel?: string;
}

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * Recharts donut wrapper. Hover state is tracked at the legend-row + cell
 * level — we deliberately avoid Pie's `activeIndex`/`activeShape` props
 * because they changed signature in recharts v3 and cause client-side
 * exceptions when fed undefined.
 *
 * Visual: bold white center total, emerald-green dollar values in the legend,
 * 12% rounded corners on slices, light gap between segments to feel like
 * Metabase / Stripe.
 */
export default function Donut({
  data,
  format = fmtUSD,
  empty = 'No data',
  hideLegend = false,
  totalLabel = 'Total',
}: DonutProps) {
  const [hover, setHover] = useState<number | null>(null);
  const filtered = useMemo(() => data.filter((d) => d.value > 0), [data]);
  const total = useMemo(() => filtered.reduce((s, d) => s + d.value, 0), [filtered]);

  if (filtered.length === 0) {
    return <div className="h-48 flex items-center justify-center text-gray-600 text-xs">{empty}</div>;
  }

  const activeLabel = hover !== null ? filtered[hover]?.label : totalLabel;
  const activeValue = hover !== null ? filtered[hover]?.value ?? 0 : total;
  const activePct = hover !== null && total > 0 ? (filtered[hover].value / total) * 100 : null;

  return (
    <div className={hideLegend ? 'flex items-center justify-center' : 'flex items-center gap-5'}>
      <div className="w-44 h-44 flex-shrink-0 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={filtered}
              dataKey="value"
              nameKey="label"
              innerRadius={56}
              outerRadius={80}
              paddingAngle={3}
              cornerRadius={4}
              startAngle={90}
              endAngle={-270}
              isAnimationActive
              animationDuration={400}
            >
              {filtered.map((_, i) => (
                <Cell
                  key={i}
                  fill={COLORS[i % COLORS.length]}
                  stroke="#1a1d23"
                  strokeWidth={2}
                  fillOpacity={hover === null || hover === i ? 1 : 0.35}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-[10px] text-gray-500 uppercase font-semibold tracking-wider">
            {activeLabel}
          </div>
          <div className="text-lg font-bold text-white mt-0.5">{format(activeValue)}</div>
          {activePct !== null && (
            <div className="text-[10px] text-emerald-400 font-semibold mt-0.5">
              {activePct.toFixed(1)}%
            </div>
          )}
        </div>
      </div>

      {!hideLegend && (
        <div className="flex-1 min-w-0 space-y-1.5">
          {filtered.map((d, i) => {
            const pct = total ? (d.value / total) * 100 : 0;
            const isActive = hover === i;
            return (
              <div
                key={d.label}
                className={`flex items-center justify-between gap-2 px-2 py-1 rounded-md transition-colors cursor-default ${
                  isActive ? 'bg-gray-800/60' : 'hover:bg-gray-800/30'
                }`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: COLORS[i % COLORS.length] }}
                  />
                  <span className="text-gray-200 text-xs truncate">{d.label}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-gray-500 text-[11px] tabular-nums w-10 text-right">
                    {pct.toFixed(0)}%
                  </span>
                  <span className="text-emerald-400 text-xs font-semibold tabular-nums w-20 text-right">
                    {format(d.value)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
