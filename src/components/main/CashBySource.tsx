'use client';

import { useEffect, useState } from 'react';
import { useTimeframe } from '@/lib/useTimeframe';
import CardShell from './CardShell';
import Donut, { type DonutSlice } from './Donut';

interface CashBreakdownResp {
  bySource?: { key: string; amount: number; count: number }[];
  byOffer?: { key: string; amount: number; count: number }[];
}

export default function CashBySource() {
  const { from, to } = useTimeframe();
  const [data, setData] = useState<DonutSlice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/main/cash-breakdown?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d: CashBreakdownResp) => {
        const slices = (d.bySource ?? []).map((r) => ({ label: r.key, value: r.amount }));
        setData(slices);
      })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [from, to]);

  return (
    <CardShell
      title="Cash by Source"
      subtitle="New cash collected, segmented by lead source"
      cardId="main:cash-by-source"
    >
      {loading ? <div className="text-gray-500 text-xs py-8 text-center">Loading…</div> : <Donut data={data} />}
    </CardShell>
  );
}
