'use client';

import { DailyMetrics } from '@/lib/types';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, parseISO } from 'date-fns';

interface TrendChartProps {
  data: DailyMetrics[];
  metric: 'spend' | 'leads' | 'callsBooked' | 'callsShown' | 'callsClosed' | 'revenue';
  label: string;
  color?: string;
}

export default function TrendChart({ data, metric, label, color = '#3b82f6' }: TrendChartProps) {
  const chartData = data.map(d => ({
    date: d.date,
    value: d[metric],
    label: format(parseISO(d.date), 'MMM d'),
  }));

  return (
    <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4">
      <h3 className="text-sm font-medium text-gray-400 mb-3">{label}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id={`gradient-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.15} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2d35" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} interval={6} stroke="#2a2d35" />
          <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} width={50} stroke="#2a2d35" />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #374151', backgroundColor: '#1a1d23', color: '#e5e7eb' }}
            formatter={(value: number) => [
              metric === 'spend' || metric === 'revenue' ? `$${value.toLocaleString()}` : value,
              label,
            ]}
          />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#gradient-${metric})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
