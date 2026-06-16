'use client';

import SystemHealthTab from '@/components/SystemHealthTab';
import { useDashboardData } from '@/hooks/useDashboardData';

export default function SystemHealthPage() {
  const { leads, loading } = useDashboardData({ sources: ['leads'] });
  return (
    <div className="px-6 py-6">
      {loading && leads.length === 0 ? (
        <div className="text-gray-400 text-sm">Loading…</div>
      ) : (
        <SystemHealthTab leads={leads} />
      )}
    </div>
  );
}
