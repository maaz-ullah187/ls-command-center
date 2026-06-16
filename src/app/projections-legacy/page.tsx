'use client';

import ProjectionsTab from '@/components/ProjectionsTab';
import { useDashboardData } from '@/hooks/useDashboardData';

export default function ProjectionsLegacyPage() {
  const { leads, loading } = useDashboardData({ sources: ['leads'] });
  return (
    <div className="px-6 py-6">
      {loading && leads.length === 0 ? (
        <div className="text-gray-400 text-sm">Loading…</div>
      ) : (
        <ProjectionsTab leads={leads} />
      )}
    </div>
  );
}
