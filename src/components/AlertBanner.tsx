'use client';

import { TrendAlert } from '@/lib/trends';
import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';

interface AlertBannerProps {
  alerts: TrendAlert[];
}

export default function AlertBanner({ alerts }: AlertBannerProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = alerts.filter(a => !dismissed.has(a.metric));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2 mb-6">
      {visible.map(alert => (
        <div
          key={alert.metric}
          className={`flex items-center justify-between px-4 py-3 rounded-lg text-sm ${
            alert.severity === 'critical'
              ? 'bg-red-950/50 text-red-300 border border-red-800/50'
              : 'bg-amber-950/30 text-amber-300 border border-amber-800/30'
          }`}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} />
            <span className="font-medium">{alert.label}</span>
            <span>is {alert.direction} {Math.abs(alert.changePercent)}% week-over-week</span>
          </div>
          <button onClick={() => setDismissed(prev => new Set(prev).add(alert.metric))} className="p-1 hover:bg-white/5 rounded">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
