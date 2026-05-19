'use client';

import BackEndTab from '@/components/BackEndTab';
import { useDashboardData } from '@/hooks/useDashboardData';

export default function BackEndPage() {
  const { mondayClients, loading } = useDashboardData();
  return (
    <div className="px-6 py-6">
      {loading && mondayClients.length === 0 ? (
        <div className="text-gray-400 text-sm">Loading…</div>
      ) : (
        <BackEndTab mondayClients={mondayClients} />
      )}
    </div>
  );
}
